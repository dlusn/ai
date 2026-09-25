// The Vercel AI Gateway is a registry target like any other. It is never a
// default: a health adjacent role pins anthropic direct, and this file proves
// both halves of that.

import { afterEach, describe, expect, it } from 'vitest';

import { complete, resolveModel } from '../src/index.ts';
import { clearEnv, setEnv } from './env.ts';
import { RECORDED_TEXT, fakeFetch, jsonResponse } from './recorded.ts';

const REQUEST = {
  role: 'chat' as const,
  system: 'test',
  messages: [{ role: 'user' as const, content: 'hi' }],
  maxTokens: 64,
  cache: true,
};

// The gateway forwards a language model call and answers with the provider
// neutral body the AI SDK's own model interface uses.
const GATEWAY_REPLY = {
  content: [{ type: 'text', text: RECORDED_TEXT }],
  finishReason: 'stop',
  usage: { inputTokens: 120, outputTokens: 18, cachedInputTokens: 40 },
  warnings: [],
};

let restore: (() => void) | undefined;

afterEach(() => {
  restore?.();
  restore = undefined;
  clearEnv();
});

describe('gateway provider', () => {
  it('resolves gateway plus a vendor/model id', () => {
    setEnv({ LLM_PROVIDER: 'gateway', AI_GATEWAY_API_KEY: 'gw', LLM_MODEL_CHAT: 'anthropic/claude-sonnet-5' });

    const resolved = resolveModel('chat');

    expect(resolved.provider).toBe('gateway');
    expect(resolved.model).toBe('anthropic/claude-sonnet-5');
    expect(resolved.apiKey).toBe('gw');
    expect(resolved.capabilities.caching).toBe(true);
  });

  it('answers in the contract shape, same as every direct adapter', async () => {
    setEnv({ LLM_PROVIDER: 'gateway', AI_GATEWAY_API_KEY: 'gw', LLM_MODEL_CHAT: 'anthropic/claude-sonnet-5' });
    const fake = fakeFetch(() => jsonResponse(GATEWAY_REPLY));
    restore = fake.restore;

    const result = await complete(REQUEST);

    expect(result).toMatchObject({
      text: RECORDED_TEXT,
      toolUses: [],
      stopReason: 'end',
      provider: 'gateway',
      model: 'anthropic/claude-sonnet-5',
    });
    expect(result.usage).toEqual({ input: 120, output: 18, cacheRead: 40, cacheWrite: 0 });

    const call = fake.calls[0];
    expect(call?.url).toContain('/language-model');
    expect(call?.init?.headers).toMatchObject({ 'ai-language-model-id': 'anthropic/claude-sonnet-5' });
    // The vendor knob still reaches the vendor, namespaced, through the broker.
    expect(JSON.parse(call?.body ?? '{}').providerOptions).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral' } },
    });
  });

  it('lets a health adjacent role pin anthropic direct while another role brokers', () => {
    setEnv({
      LLM_PROVIDER: 'gateway',
      AI_GATEWAY_API_KEY: 'gw',
      ANTHROPIC_API_KEY: 'direct',
      LLM_MODEL_CHAT: 'anthropic/claude-sonnet-5',
      LLM_MODELS_DRAFT: 'anthropic/claude-sonnet-5',
    });

    expect(resolveModel('chat').provider).toBe('gateway');
    // The chain entry names the provider, so the coach never touches a broker.
    expect(resolveModel('draft').provider).toBe('anthropic');
  });

  it('turns a gateway error into an LlmError with a kind and a status', async () => {
    setEnv({ LLM_PROVIDER: 'gateway', AI_GATEWAY_API_KEY: 'gw', LLM_MODEL_CHAT: 'anthropic/claude-sonnet-5' });
    const fake = fakeFetch(() => jsonResponse({ error: { message: 'slow down', type: 'rate_limit_exceeded' } }, 429));
    restore = fake.restore;

    await expect(complete(REQUEST)).rejects.toMatchObject({
      kind: 'rate_limit',
      status: 429,
      provider: 'gateway',
      retryable: true,
    });
  });
});
