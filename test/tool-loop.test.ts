// The tool round trip contract test. One fixture, every adapter: the model
// asks for a tool, the caller answers it, and the second assistant turn sees
// that answer. A consumer replaying a tool loop (cmd's CEO chat runs up to five
// turns) loses every turn after the first if this stops holding.

import { afterEach, describe, expect, it } from 'vitest';

import { complete } from '../src/index.ts';
import { resetStub, setStubFixtures } from '../src/stub.ts';
import type { LlmRequest, LlmTool } from '../src/types.ts';
import { clearEnv, setEnv } from './env.ts';
import {
  ANTHROPIC_AFTER_TOOL,
  ANTHROPIC_TOOL_USE,
  GATEWAY_AFTER_TOOL,
  GATEWAY_TOOL_USE,
  GOOGLE_AFTER_TOOL,
  GOOGLE_TOOL_USE,
  OPENAI_AFTER_TOOL,
  OPENAI_COMPATIBLE_AFTER_TOOL,
  OPENAI_COMPATIBLE_TOOL_USE,
  OPENAI_TOOL_USE,
  RECORDED_TEXT,
  RECORDED_TOOL,
  RECORDED_TOOL_INPUT,
  RECORDED_TOOL_RESULT,
  fakeFetch,
  jsonResponse,
} from './recorded.ts';

const TOOL: LlmTool = {
  name: RECORDED_TOOL,
  description: 'Current weather for a city.',
  inputSchema: {
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
    additionalProperties: false,
  },
};

const CALL_ID = 'call_1';

/** Turn three of the loop: the tool_use and its tool_result are both replayed. */
const LOOP: LlmRequest = {
  role: 'chat',
  system: 'You are the seam test.',
  messages: [
    { role: 'user', content: 'What is the weather in Sydney?' },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Checking.' },
        { type: 'tool_use', id: CALL_ID, name: RECORDED_TOOL, input: RECORDED_TOOL_INPUT },
      ],
    },
    { role: 'user', content: [{ type: 'tool_result', toolUseId: CALL_ID, content: RECORDED_TOOL_RESULT }] },
  ],
  maxTokens: 256,
  tools: [TOOL],
};

/** Turn one of the loop: nothing replayed, the model is free to ask for a tool. */
const ASK: LlmRequest = {
  role: 'chat',
  system: 'You are the seam test.',
  messages: [{ role: 'user', content: 'What is the weather in Sydney?' }],
  maxTokens: 256,
  tools: [TOOL],
};

type Adapter = {
  name: string;
  env: Record<string, string>;
  provider: string;
  model: string;
  afterTool: unknown;
  toolUse: unknown;
  /** The id the vendor put on the call, or null where it names none. */
  toolUseId: string | null;
};

const ADAPTERS: Adapter[] = [
  {
    name: 'anthropic',
    env: { LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'test-key' },
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    afterTool: ANTHROPIC_AFTER_TOOL,
    toolUse: ANTHROPIC_TOOL_USE,
    toolUseId: 'toolu_recorded',
  },
  {
    name: 'openai',
    env: { LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'test-key', LLM_MODEL_CHAT: 'gpt-5' },
    provider: 'openai',
    model: 'gpt-5',
    afterTool: OPENAI_AFTER_TOOL,
    toolUse: OPENAI_TOOL_USE,
    toolUseId: 'call_recorded',
  },
  {
    name: 'openai-compatible',
    env: {
      LLM_PROVIDER: 'openai-compatible',
      LLM_BASE_URL: 'https://models.internal.test/v1',
      LLM_API_KEY: 'test-key',
      LLM_MODEL_CHAT: 'house-model-1',
    },
    provider: 'openai-compatible',
    model: 'house-model-1',
    afterTool: OPENAI_COMPATIBLE_AFTER_TOOL,
    toolUse: OPENAI_COMPATIBLE_TOOL_USE,
    toolUseId: 'call_recorded',
  },
  {
    name: 'google',
    env: { LLM_PROVIDER: 'google', GOOGLE_API_KEY: 'test-key' },
    provider: 'google',
    model: 'gemini-2.5-pro',
    afterTool: GOOGLE_AFTER_TOOL,
    toolUse: GOOGLE_TOOL_USE,
    toolUseId: null,
  },
  {
    name: 'gateway',
    env: { LLM_PROVIDER: 'gateway', AI_GATEWAY_API_KEY: 'gw', LLM_MODEL_CHAT: 'anthropic/claude-sonnet-5' },
    provider: 'gateway',
    model: 'anthropic/claude-sonnet-5',
    afterTool: GATEWAY_AFTER_TOOL,
    toolUse: GATEWAY_TOOL_USE,
    toolUseId: 'gw_call_recorded',
  },
];

let restore: (() => void) | undefined;

afterEach(() => {
  restore?.();
  restore = undefined;
  resetStub();
  clearEnv();
});

describe('a tool round trip survives every adapter', () => {
  for (const adapter of ADAPTERS) {
    it(`${adapter.name} carries the tool_use and the tool_result to the vendor`, async () => {
      setEnv(adapter.env);
      const fake = fakeFetch(() => jsonResponse(adapter.afterTool));
      restore = fake.restore;

      const result = await complete(LOOP);

      // The second assistant turn answered, which is the turn a v0.2 consumer
      // never reached because the loop was flattened to text on the way out.
      expect(result.text).toBe(RECORDED_TEXT);
      expect(result.provider).toBe(adapter.provider);
      expect(result.model).toBe(adapter.model);

      // The vendor body is the proof. Asserting on the wire, not on a per
      // vendor part shape, keeps one assertion honest across five adapters.
      const body = fake.calls[0]?.body ?? '';
      expect(body).toContain(CALL_ID);
      expect(body).toContain(RECORDED_TOOL);
      expect(body).toContain(RECORDED_TOOL_RESULT);
      expect(body).toContain('Sydney');
    });

    it(`${adapter.name} reports an id on every tool use`, async () => {
      setEnv(adapter.env);
      const fake = fakeFetch(() => jsonResponse(adapter.toolUse));
      restore = fake.restore;

      const result = await complete(ASK);

      expect(result.stopReason).toBe('tool_use');
      expect(result.toolUses).toHaveLength(1);
      const [use] = result.toolUses;
      expect(use?.name).toBe(RECORDED_TOOL);
      expect(use?.input).toEqual(RECORDED_TOOL_INPUT);
      // A vendor id is passed through; a vendor with none still gets an id, so
      // feeding it back as a tool_use part always round trips.
      if (adapter.toolUseId) expect(use?.id).toBe(adapter.toolUseId);
      else expect(use?.id).toBeTruthy();
    });
  }

  it('stub, with no vendor key, echoes the tool result it was handed', async () => {
    setEnv({ LLM_PROVIDER: 'stub' });
    setStubFixtures({ chat: 'Here you go.' });
    const fake = fakeFetch(() => {
      throw new Error('the stub must never reach the network');
    });
    restore = fake.restore;

    const result = await complete(LOOP);

    expect(result.text).toBe(`Here you go. tool_result ${CALL_ID}: ${RECORDED_TOOL_RESULT}`);
    expect(fake.calls).toHaveLength(0);
  });

  it('stub numbers a tool use that carries no id of its own', async () => {
    setEnv({ LLM_PROVIDER: 'stub' });
    setStubFixtures({ chat: { toolUses: [{ name: RECORDED_TOOL, input: RECORDED_TOOL_INPUT }] } });

    const result = await complete(ASK);

    expect(result.toolUses).toEqual([
      { id: 'stub_tool_1', name: RECORDED_TOOL, input: RECORDED_TOOL_INPUT },
    ]);
    expect(result.stopReason).toBe('tool_use');
  });
});

describe('tool parts a caller got wrong', () => {
  it('names the orphaned tool_result rather than dropping it', async () => {
    setEnv({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'test-key' });
    const fake = fakeFetch(() => jsonResponse(ANTHROPIC_AFTER_TOOL));
    restore = fake.restore;

    await expect(
      complete({
        ...LOOP,
        messages: [
          { role: 'user', content: [{ type: 'tool_result', toolUseId: 'nobody', content: 'x' }] },
        ],
      }),
    ).rejects.toThrowError(/no matching tool_use/);
    expect(fake.calls).toHaveLength(0);
  });

  it('flags a failed tool as an error rather than as ordinary text', async () => {
    setEnv({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'test-key' });
    const fake = fakeFetch(() => jsonResponse(ANTHROPIC_AFTER_TOOL));
    restore = fake.restore;

    await complete({
      ...LOOP,
      messages: [
        LOOP.messages[0]!,
        LOOP.messages[1]!,
        {
          role: 'user',
          content: [{ type: 'tool_result', toolUseId: CALL_ID, content: 'upstream timed out', isError: true }],
        },
      ],
    });

    const sent = JSON.parse(fake.calls[0]?.body ?? '{}');
    const blocks = sent.messages
      .flatMap((message: { content: unknown }) => (Array.isArray(message.content) ? message.content : []))
      .filter((part: { type: string }) => part.type === 'tool_result');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].is_error).toBe(true);
  });
});

describe('v0.2 shapes are untouched', () => {
  it('a text only assistant turn still goes over as a plain string', async () => {
    setEnv({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'test-key' });
    const fake = fakeFetch(() => jsonResponse(ANTHROPIC_AFTER_TOOL));
    restore = fake.restore;

    await complete({
      role: 'chat',
      system: 'test',
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
        { role: 'user', content: 'again' },
      ],
      maxTokens: 64,
    });

    const sent = JSON.parse(fake.calls[0]?.body ?? '{}');
    expect(sent.messages).toHaveLength(3);
    expect(sent.messages[1].role).toBe('assistant');
  });
});
