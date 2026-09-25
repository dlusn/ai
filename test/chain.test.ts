// The fallback chain, the fail fast timeouts and the circuit breaker. All three
// live in the seam once, so no route ever writes a retry.

import { afterEach, describe, expect, it } from 'vitest';

import { complete } from '../src/index.ts';
import { resolveModel } from '../src/registry.ts';
import { resetStub, setStubFixtures } from '../src/stub.ts';
import { clearEnv, collectLogs, setEnv } from './env.ts';
import { ANTHROPIC_MESSAGE, fakeFetch, jsonResponse } from './recorded.ts';

const REQUEST = {
  role: 'chat' as const,
  system: 'test',
  messages: [{ role: 'user' as const, content: 'hi' }],
  maxTokens: 64,
};

// Nothing listens on port 9, so a connect here fails immediately, the way a
// home rig that is switched off does.
const DEAD = 'http://127.0.0.1:9/v1';

let restore: (() => void) | undefined;

afterEach(() => {
  restore?.();
  restore = undefined;
  resetStub();
  clearEnv();
});

describe('chain parsing', () => {
  it('reads an ordered provider/model list out of LLM_MODELS_<ROLE>', () => {
    setEnv({
      LLM_PROVIDER: 'anthropic',
      LLM_API_KEY: 'k',
      AI_GATEWAY_API_KEY: 'g',
      LLM_MODELS_CHAT: 'anthropic/claude-sonnet-5, gateway/anthropic/claude-sonnet-5, stub/stub-best',
    });

    const resolved = resolveModel('chat');

    expect(resolved.targets.map((target) => `${target.provider} ${target.model}`)).toEqual([
      'anthropic claude-sonnet-5',
      'gateway anthropic/claude-sonnet-5',
      'stub stub-best',
    ]);
    expect(resolved.provider).toBe('anthropic');
    expect(resolved.model).toBe('claude-sonnet-5');
    expect(resolved.fallback).toBe('anthropic/claude-sonnet-5');
  });

  it('still builds the two entry chain out of LLM_MODEL and LLM_FALLBACK', () => {
    setEnv({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'k', LLM_FALLBACK_CHAT: 'backup-id' });
    const resolved = resolveModel('chat');
    expect(resolved.targets).toHaveLength(2);
    expect(resolved.targets[1]?.model).toBe('backup-id');
  });

  it('takes a per target base URL after a pipe, for a rig and the same model hosted', () => {
    setEnv({
      LLM_PROVIDER: 'openai-compatible',
      LLM_BASE_URL: DEAD,
      LLM_MODELS_EXTRACT: `openai-compatible/Qwen/Qwen3.6-27B|http://rig.local:8000/v1,openai-compatible/Qwen/Qwen3.6-27B|https://hosted.test/v1`,
    });

    const resolved = resolveModel('extract');
    expect(resolved.targets[0]?.baseURL).toBe('http://rig.local:8000/v1');
    expect(resolved.targets[1]?.baseURL).toBe('https://hosted.test/v1');
    // Both are the same model id, so the price row is the same on either hop.
    expect(resolved.targets[0]?.capabilities.contextTokens).toBe(262_000);
  });

  it('defaults timeouts to 2s to first byte and 30s total', () => {
    setEnv({ LLM_PROVIDER: 'stub' });
    const resolved = resolveModel('chat');
    expect(resolved.connectTimeoutMs).toBe(2_000);
    expect(resolved.timeoutMs).toBe(30_000);
  });
});

describe('fail over', () => {
  it('answers from the fallback when the primary base URL is dead, and logs one line', async () => {
    setEnv({
      LLM_PROVIDER: 'openai-compatible',
      LLM_BASE_URL: DEAD,
      LLM_MODELS_CHAT: `openai-compatible/rig-model|${DEAD},stub/stub-best`,
      LLM_BREAKER_FAILURES: '1',
    });
    setStubFixtures({ chat: 'from the fallback' });
    const log = collectLogs();

    const started = Date.now();
    const result = await complete(REQUEST);
    const first = Date.now() - started;

    expect(result.text).toBe('from the fallback');
    expect(result.provider).toBe('stub');
    expect(first).toBeLessThan(2_500);

    const hops = log.lines.filter((line) => line.event === 'llm.fallback');
    expect(hops).toHaveLength(1);
    expect(hops[0]).toMatchObject({
      target: `openai-compatible/rig-model@${DEAD}`,
      next: 'stub/stub-best',
    });

    // Second call: the breaker is open, so the dead primary is never dialled.
    const again = Date.now();
    const second = await complete(REQUEST);
    expect(Date.now() - again).toBeLessThan(50);
    expect(second.provider).toBe('stub');
    expect(log.lines.some((line) => line.event === 'llm.breaker_skip')).toBe(true);
  });

  it('takes the configured number of consecutive failures to open a target', async () => {
    setEnv({
      LLM_PROVIDER: 'openai-compatible',
      LLM_BASE_URL: DEAD,
      LLM_MODELS_CHAT: `openai-compatible/rig-model|${DEAD},stub/stub-best`,
    });
    setStubFixtures({ chat: 'ok' });
    const log = collectLogs();

    for (let i = 0; i < 3; i += 1) await complete(REQUEST);
    expect(log.lines.filter((line) => line.event === 'llm.fallback')).toHaveLength(3);
    expect(log.lines.filter((line) => line.event === 'llm.breaker_open')).toHaveLength(1);

    await complete(REQUEST);
    expect(log.lines.filter((line) => line.event === 'llm.breaker_skip')).toHaveLength(1);
  });

  it('half opens with one probe once the breaker window has passed', async () => {
    setEnv({
      LLM_PROVIDER: 'anthropic',
      LLM_API_KEY: 'k',
      LLM_MODELS_CHAT: 'anthropic/primary-id,anthropic/backup-id',
      LLM_BREAKER_FAILURES: '1',
      LLM_BREAKER_MS: '0',
    });
    const log = collectLogs();

    let healthy = false;
    const fake = fakeFetch((_url, init) => {
      const sent = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
      if (sent.model === 'primary-id' && !healthy) return jsonResponse({ error: { message: 'down' } }, 529);
      return jsonResponse({ ...ANTHROPIC_MESSAGE, model: sent.model });
    });
    restore = fake.restore;

    expect((await complete(REQUEST)).model).toBe('backup-id');
    healthy = true;
    // The window is zero, so the next call is the half open probe and it passes.
    expect((await complete(REQUEST)).model).toBe('primary-id');
    expect(log.lines.some((line) => line.event === 'llm.breaker_close')).toBe(true);
  });

  it('gives up on a target that never sends a first byte and moves on', async () => {
    setEnv({
      LLM_PROVIDER: 'anthropic',
      LLM_API_KEY: 'k',
      LLM_MODELS_CHAT: 'anthropic/slow-id,stub/stub-best',
      LLM_CONNECT_TIMEOUT_MS: '120',
    });
    setStubFixtures({ chat: 'from the fallback' });
    const log = collectLogs();

    const fake = fakeFetch(
      () => new Promise<Response>(() => {}), // never answers, never closes
    );
    restore = fake.restore;

    const result = await complete(REQUEST);

    expect(result.provider).toBe('stub');
    expect(log.lines.filter((line) => line.event === 'llm.fallback')).toHaveLength(1);
  });

  it('does not fail over a bad request, which the next target would fail too', async () => {
    setEnv({
      LLM_PROVIDER: 'anthropic',
      LLM_API_KEY: 'k',
      LLM_MODELS_CHAT: 'anthropic/primary-id,stub/stub-best',
    });
    setStubFixtures({ chat: 'never reached' });
    const fake = fakeFetch(() => jsonResponse({ error: { message: 'no' } }, 400));
    restore = fake.restore;

    await expect(complete(REQUEST)).rejects.toMatchObject({ kind: 'bad_request', status: 400 });
    expect(fake.calls).toHaveLength(1);
  });
});
