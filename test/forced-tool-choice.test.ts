// The 5.x anthropic models 400 on a forced tool_choice. The seam sends auto and
// names the tool in the system prompt; rows that accept a forced choice keep it.

import { afterEach, describe, expect, it } from 'vitest';

import { complete } from '../src/index.ts';
import { clearEnv, setEnv } from './env.ts';
import { fakeFetch, jsonResponse } from './recorded.ts';

const SCHEMA = { type: 'object', properties: { food: { type: 'string' } }, required: ['food'] };

const REQUEST = {
  role: 'extract' as const,
  system: 'Extract the food.',
  messages: [{ role: 'user' as const, content: '120g of oats' }],
  maxTokens: 128,
  tools: [{ name: 'log_food', description: 'Log a food', inputSchema: SCHEMA }],
};

const TOOL_REPLY = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'tool_use', id: 'tu_1', name: 'log_food', input: { food: 'oats' } }],
  stop_reason: 'tool_use',
  usage: { input_tokens: 9, output_tokens: 2 },
};

let restore: (() => void) | undefined;

afterEach(() => {
  restore?.();
  restore = undefined;
  clearEnv();
});

async function sendAnthropic(model: string, toolChoice: NonNullable<Parameters<typeof complete>[0]['toolChoice']>) {
  setEnv({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'k', LLM_MODEL_EXTRACT: model });
  const fake = fakeFetch(() => jsonResponse({ ...TOOL_REPLY, model }));
  restore = fake.restore;
  await complete({ ...REQUEST, toolChoice });
  return JSON.parse(fake.calls[0]?.body ?? '{}');
}

describe('forced tool_choice', () => {
  it('downgrades { name } to auto plus a system line on claude-sonnet-5-5', async () => {
    const sent = await sendAnthropic('claude-sonnet-5-5', { name: 'log_food' });
    expect(sent.tool_choice).toEqual({ type: 'auto' });
    expect(JSON.stringify(sent.system)).toContain('Extract the food.');
    expect(JSON.stringify(sent.system)).toContain('Answer by calling the log_food tool.');
    expect(sent.thinking).toBeUndefined();
  });

  it('downgrades required to auto plus a system line on opus and fable', async () => {
    for (const model of ['claude-opus-5-5', 'claude-fable-5-1']) {
      const sent = await sendAnthropic(model, 'required');
      expect(sent.tool_choice).toEqual({ type: 'auto' });
      expect(JSON.stringify(sent.system)).toContain('Answer by calling one of the provided tools.');
      restore?.();
    }
  });

  it('keeps auto and none unchanged, with no extra system line', async () => {
    const sent = await sendAnthropic('claude-sonnet-5-5', 'auto');
    expect(sent.tool_choice).toEqual({ type: 'auto' });
    expect(JSON.stringify(sent.system)).not.toContain('Answer by calling');
  });

  it('keeps the forced choice on claude-haiku-4-5', async () => {
    const sent = await sendAnthropic('claude-haiku-4-5', { name: 'log_food' });
    expect(sent.tool_choice).toEqual({ type: 'tool', name: 'log_food' });
    expect(JSON.stringify(sent.system)).not.toContain('Answer by calling');
  });

  it('keeps the forced choice on a model the registry has never seen', async () => {
    const sent = await sendAnthropic('claude-mystery-9', { name: 'log_food' });
    expect(sent.tool_choice).toEqual({ type: 'tool', name: 'log_food' });
  });

  it('downgrades through the gateway too', async () => {
    setEnv({ LLM_PROVIDER: 'gateway', AI_GATEWAY_API_KEY: 'gw', LLM_MODEL_EXTRACT: 'anthropic/claude-sonnet-5-5' });
    const fake = fakeFetch(() =>
      jsonResponse({
        content: [{ type: 'tool-call', toolCallId: 'tu_1', toolName: 'log_food', input: '{"food":"oats"}' }],
        finishReason: 'tool-calls',
        usage: { inputTokens: 9, outputTokens: 2 },
        warnings: [],
      }),
    );
    restore = fake.restore;

    await complete({ ...REQUEST, toolChoice: { name: 'log_food' } });

    const sent = JSON.parse(fake.calls[0]?.body ?? '{}');
    expect(sent.toolChoice).toEqual({ type: 'auto' });
    expect(JSON.stringify(sent.prompt)).toContain('Answer by calling the log_food tool.');
  });
});
