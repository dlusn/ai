// completeObject and stream, on the stub and on a recorded vendor response.

import { afterEach, describe, expect, it } from 'vitest';

import { completeObject, stream } from '../src/index.ts';
import { resetStub, setStubFixtures, stubCalls } from '../src/stub.ts';
import { clearEnv, setEnv } from './env.ts';
import { RECORDED_TEXT, fakeFetch, jsonResponse } from './recorded.ts';

const SCHEMA = {
  type: 'object',
  properties: { food: { type: 'string' }, grams: { type: 'number' } },
  required: ['food', 'grams'],
  additionalProperties: false,
};

const REQUEST = {
  role: 'extract' as const,
  system: 'Extract the food.',
  messages: [{ role: 'user' as const, content: '120g of oats' }],
  maxTokens: 128,
};

let restore: (() => void) | undefined;

afterEach(() => {
  restore?.();
  restore = undefined;
  resetStub();
  clearEnv();
});

const EXPECTED = { food: 'oats', grams: 120 };
const AS_JSON = JSON.stringify(EXPECTED);

// One fixture, every adapter, one parsed object. Each vendor answers a
// structured request in its own shape and no call site ever sees which.
const ADAPTERS: { name: string; env: Record<string, string>; reply: unknown; model: string; provider: string }[] = [
  {
    name: 'anthropic, as a forced tool call',
    env: { LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'k' },
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    reply: {
      id: 'msg_o',
      type: 'message',
      role: 'assistant',
      model: 'claude-haiku-4-5',
      content: [{ type: 'tool_use', id: 'tu', name: 'json', input: EXPECTED }],
      stop_reason: 'tool_use',
      usage: { input_tokens: 90, output_tokens: 12 },
    },
  },
  {
    name: 'openai-compatible, as a JSON body',
    env: {
      LLM_PROVIDER: 'openai-compatible',
      LLM_BASE_URL: 'https://models.internal.test/v1',
      LLM_MODEL_EXTRACT: 'house-model-1',
    },
    provider: 'openai-compatible',
    model: 'house-model-1',
    reply: {
      id: 'chatcmpl_o',
      object: 'chat.completion',
      created: 1_759_000_000,
      model: 'house-model-1',
      choices: [{ index: 0, message: { role: 'assistant', content: AS_JSON }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 90, completion_tokens: 12, total_tokens: 102 },
    },
  },
  {
    name: 'google, as a JSON part',
    env: { LLM_PROVIDER: 'google', GOOGLE_API_KEY: 'k' },
    provider: 'google',
    model: 'gemini-2.5-flash-lite',
    reply: {
      candidates: [{ content: { parts: [{ text: AS_JSON }], role: 'model' }, finishReason: 'STOP', index: 0 }],
      usageMetadata: { promptTokenCount: 90, candidatesTokenCount: 12, totalTokenCount: 102 },
    },
  },
  {
    name: 'gateway, brokered',
    env: { LLM_PROVIDER: 'gateway', AI_GATEWAY_API_KEY: 'gw', LLM_MODEL_EXTRACT: 'openai/gpt-6-sol' },
    provider: 'gateway',
    model: 'openai/gpt-6-sol',
    reply: {
      content: [{ type: 'text', text: AS_JSON }],
      finishReason: 'stop',
      usage: { inputTokens: 90, outputTokens: 12 },
      warnings: [],
    },
  },
];

describe('completeObject through every adapter', () => {
  for (const adapter of ADAPTERS) {
    it(adapter.name, async () => {
      setEnv(adapter.env);
      const fake = fakeFetch(() => jsonResponse(adapter.reply));
      restore = fake.restore;

      const result = await completeObject<typeof EXPECTED>(REQUEST, SCHEMA);

      expect(result.object).toEqual(EXPECTED);
      expect(result.text).toBe(AS_JSON);
      expect(result.provider).toBe(adapter.provider);
      expect(result.model).toBe(adapter.model);
      expect(result.usage).toEqual({ input: 90, output: 12, cacheRead: 0, cacheWrite: 0 });
    });
  }

  it('stub', async () => {
    setEnv({ LLM_PROVIDER: 'stub' });
    setStubFixtures({ extract: AS_JSON });
    const result = await completeObject<typeof EXPECTED>(REQUEST, SCHEMA);
    expect(result.object).toEqual(EXPECTED);
    expect(result.provider).toBe('stub');
  });
});

describe('completeObject', () => {
  it('parses the object out of a recorded vendor reply', async () => {
    setEnv({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'k' });
    const fake = fakeFetch(() =>
      jsonResponse({
        id: 'msg_recorded_object',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-4-5',
        // Structured output on this vendor comes back as a forced tool call,
        // which is exactly the sort of detail a call site must never see.
        content: [{ type: 'tool_use', id: 'tu_json', name: 'json', input: { food: 'oats', grams: 120 } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 90, output_tokens: 12 },
      }),
    );
    restore = fake.restore;

    const result = await completeObject<{ food: string; grams: number }>(REQUEST, SCHEMA);

    expect(result.object).toEqual({ food: 'oats', grams: 120 });
    expect(result.text).toBe('{"food":"oats","grams":120}');
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-haiku-4-5');
    expect(result.usage).toEqual({ input: 90, output: 12, cacheRead: 0, cacheWrite: 0 });
  });

  it('parses the stub fixture', async () => {
    setEnv({ LLM_PROVIDER: 'stub' });
    setStubFixtures({ extract: '{"food":"oats","grams":120}' });

    const result = await completeObject<{ food: string }>(REQUEST, SCHEMA);

    expect(result.object.food).toBe('oats');
    expect(stubCalls()[0]?.kind).toBe('object');
  });

  it('says so when the stub fixture is not JSON', async () => {
    setEnv({ LLM_PROVIDER: 'stub' });
    setStubFixtures({ extract: 'not json' });
    await expect(completeObject(REQUEST, SCHEMA)).rejects.toThrowError(/not JSON/);
  });
});

describe('stream', () => {
  it('yields text then one done chunk carrying the LlmResult', async () => {
    setEnv({ LLM_PROVIDER: 'stub' });
    setStubFixtures({ chat: { text: RECORDED_TEXT, usage: { input: 5, output: 7 } } });

    const chunks = [];
    for await (const chunk of stream({ ...REQUEST, role: 'chat' })) chunks.push(chunk);

    expect(chunks[0]).toEqual({ type: 'text', text: RECORDED_TEXT });
    expect(chunks.at(-1)).toMatchObject({
      type: 'done',
      result: { text: RECORDED_TEXT, provider: 'stub', stopReason: 'end', usage: { input: 5, output: 7 } },
    });
    expect(stubCalls()[0]?.kind).toBe('stream');
  });
});

describe('tools', () => {
  it('returns tool uses in the contract shape', async () => {
    setEnv({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'k' });
    const fake = fakeFetch(() =>
      jsonResponse({
        id: 'msg_recorded_tool',
        type: 'message',
        role: 'assistant',
        model: 'claude-haiku-4-5',
        content: [{ type: 'tool_use', id: 'tu_1', name: 'log_food', input: { food: 'oats', grams: 120 } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 90, output_tokens: 20 },
      }),
    );
    restore = fake.restore;

    const result = await (await import('../src/index.ts')).complete({
      ...REQUEST,
      tools: [{ name: 'log_food', description: 'Log a food', inputSchema: SCHEMA }],
      toolChoice: { name: 'log_food' },
    });

    expect(result.stopReason).toBe('tool_use');
    expect(result.toolUses).toEqual([{ name: 'log_food', input: { food: 'oats', grams: 120 } }]);
    const sent = JSON.parse(fake.calls[0]?.body ?? '{}');
    expect(sent.tool_choice).toEqual({ type: 'tool', name: 'log_food' });
  });
});
