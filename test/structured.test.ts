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
