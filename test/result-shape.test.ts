// The contract test. One fixture, four adapters, one LlmResult shape.

import { afterEach, describe, expect, it } from 'vitest';

import { complete } from '../src/index.ts';
import { resetStub, setStubFixtures } from '../src/stub.ts';
import type { LlmRequest, LlmResult } from '../src/types.ts';
import { clearEnv, setEnv } from './env.ts';
import {
  ANTHROPIC_MESSAGE,
  GOOGLE_GENERATE_CONTENT,
  OPENAI_CHAT_COMPLETION,
  RECORDED_TEXT,
  fakeFetch,
  jsonResponse,
} from './recorded.ts';

const REQUEST: LlmRequest = {
  role: 'chat',
  system: 'You are the seam test.',
  messages: [{ role: 'user', content: 'Say the recorded line.' }],
  maxTokens: 256,
  cache: true,
};

function assertContractShape(result: LlmResult, expected: { provider: string; model: string }) {
  expect(Object.keys(result).sort()).toEqual(['model', 'provider', 'stopReason', 'text', 'toolUses', 'usage']);
  expect(result.text).toBe(RECORDED_TEXT);
  expect(result.toolUses).toEqual([]);
  expect(result.stopReason).toBe('end');
  expect(Object.keys(result.usage).sort()).toEqual(['cacheRead', 'cacheWrite', 'input', 'output']);
  expect(result.usage.input).toBe(120);
  expect(result.usage.output).toBe(18);
  expect(result.usage.cacheRead).toBe(40);
  expect(result.provider).toBe(expected.provider);
  expect(result.model).toBe(expected.model);
}

let restore: (() => void) | undefined;

afterEach(() => {
  restore?.();
  restore = undefined;
  resetStub();
  clearEnv();
});

describe('one LlmResult shape across adapters', () => {
  it('anthropic', async () => {
    setEnv({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'test-key' });
    const fake = fakeFetch(() => jsonResponse(ANTHROPIC_MESSAGE));
    restore = fake.restore;

    const result = await complete(REQUEST);

    assertContractShape(result, { provider: 'anthropic', model: 'claude-opus-5-5' });
    // Cache write tokens are vendor metadata, mapped in the adapter layer.
    expect(result.usage.cacheWrite).toBe(10);
    expect(fake.calls).toHaveLength(1);
  });

  it('openai-compatible', async () => {
    setEnv({
      LLM_PROVIDER: 'openai-compatible',
      LLM_BASE_URL: 'https://models.internal.test/v1',
      LLM_API_KEY: 'test-key',
      LLM_MODEL_CHAT: 'house-model-1',
    });
    const fake = fakeFetch(() => jsonResponse(OPENAI_CHAT_COMPLETION));
    restore = fake.restore;

    const result = await complete(REQUEST);

    assertContractShape(result, { provider: 'openai-compatible', model: 'house-model-1' });
    expect(result.usage.cacheWrite).toBe(0);
    expect(fake.calls[0]?.url).toBe('https://models.internal.test/v1/chat/completions');
  });

  it('google', async () => {
    setEnv({ LLM_PROVIDER: 'google', GOOGLE_API_KEY: 'test-key' });
    const fake = fakeFetch(() => jsonResponse(GOOGLE_GENERATE_CONTENT));
    restore = fake.restore;

    const result = await complete(REQUEST);

    assertContractShape(result, { provider: 'google', model: 'gemini-2.5-pro' });
    expect(result.usage.cacheWrite).toBe(0);
  });

  it('stub, with no vendor key set', async () => {
    setEnv({ LLM_PROVIDER: 'stub' });
    setStubFixtures({
      chat: { text: RECORDED_TEXT, usage: { input: 120, output: 18, cacheRead: 40, cacheWrite: 0 } },
    });
    const fake = fakeFetch(() => {
      throw new Error('the stub must never reach the network');
    });
    restore = fake.restore;

    const result = await complete(REQUEST);

    assertContractShape(result, { provider: 'stub', model: 'stub-best' });
    expect(fake.calls).toHaveLength(0);
  });
});

describe('vision parts', () => {
  it('sends an image part through the adapter without a call site touching a vendor field', async () => {
    setEnv({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'test-key' });
    const fake = fakeFetch(() => jsonResponse(ANTHROPIC_MESSAGE));
    restore = fake.restore;

    await complete({
      role: 'vision',
      system: 'Describe it.',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'What is this?' },
            { type: 'image', mime: 'image/png', base64: 'aGVsbG8=' },
          ],
        },
      ],
      maxTokens: 64,
    });

    const sent = JSON.parse(fake.calls[0]?.body ?? '{}');
    const parts = sent.messages[0].content;
    expect(parts[0]).toMatchObject({ type: 'text' });
    expect(parts[1]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png' } });
  });
});
