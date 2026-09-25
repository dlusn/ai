// The capacity fallback lives in the seam once. No route ever writes a retry.

import { afterEach, describe, expect, it } from 'vitest';

import { complete } from '../src/index.ts';
import { LlmError } from '../src/errors.ts';
import { clearEnv, setEnv } from './env.ts';
import { ANTHROPIC_MESSAGE, fakeFetch, jsonResponse } from './recorded.ts';

const REQUEST = {
  role: 'chat' as const,
  system: 'test',
  messages: [{ role: 'user' as const, content: 'hi' }],
  maxTokens: 64,
};

let restore: (() => void) | undefined;

afterEach(() => {
  restore?.();
  restore = undefined;
  clearEnv();
});

function failingThenOk(status: number) {
  let attempt = 0;
  return fakeFetch((_url, init) => {
    attempt += 1;
    if (attempt === 1) return jsonResponse({ error: { message: `status ${status}` } }, status);
    const sent = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
    return jsonResponse({ ...ANTHROPIC_MESSAGE, model: sent.model });
  });
}

describe('capacity fallback', () => {
  for (const status of [429, 503, 529, 404]) {
    it(`retries ${status} on LLM_FALLBACK_<ROLE>`, async () => {
      setEnv({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'k', LLM_FALLBACK_CHAT: 'backup-id' });
      const fake = failingThenOk(status);
      restore = fake.restore;

      const result = await complete(REQUEST);

      expect(result.model).toBe('backup-id');
      expect(fake.calls).toHaveLength(2);
      expect(JSON.parse(fake.calls[1]?.body ?? '{}').model).toBe('backup-id');
    });
  }

  it('does not retry a request error like 400', async () => {
    setEnv({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'k', LLM_FALLBACK_CHAT: 'backup-id' });
    const fake = failingThenOk(400);
    restore = fake.restore;

    await expect(complete(REQUEST)).rejects.toMatchObject({ kind: 'bad_request', status: 400, retryable: false });
    expect(fake.calls).toHaveLength(1);
  });

  it('does not retry when no fallback is configured', async () => {
    setEnv({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'k' });
    const fake = failingThenOk(529);
    restore = fake.restore;

    await expect(complete(REQUEST)).rejects.toMatchObject({ kind: 'overloaded', status: 529, retryable: true });
    expect(fake.calls).toHaveLength(1);
  });

  it('surfaces an LlmError with kind, status, provider and retryable', async () => {
    setEnv({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'k' });
    const fake = fakeFetch(() => jsonResponse({ error: { message: 'no' } }, 401));
    restore = fake.restore;

    const error = await complete(REQUEST).catch((raw: unknown) => raw);
    expect(error).toBeInstanceOf(LlmError);
    expect(error).toMatchObject({ kind: 'auth', status: 401, provider: 'anthropic', retryable: false });
  });
});
