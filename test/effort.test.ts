// 5.x anthropic models think by default at effort high and the thinking tokens
// eat max_tokens. The seam sends effort low unless the caller asks for thinking.

import { afterEach, describe, expect, it } from 'vitest';

import { complete } from '../src/index.ts';
import { clearEnv, setEnv } from './env.ts';
import { fakeFetch, jsonResponse } from './recorded.ts';

const REQUEST = {
  role: 'chat' as const,
  system: 'Be brief.',
  messages: [{ role: 'user' as const, content: 'hi' }],
  maxTokens: 512,
};

const REPLY = {
  id: 'msg_1',
  type: 'message',
  role: 'assistant',
  content: [{ type: 'text', text: 'hello' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 5, output_tokens: 2 },
};

let restore: (() => void) | undefined;

afterEach(() => {
  restore?.();
  restore = undefined;
  clearEnv();
});

async function sent(model: string, extra: Partial<Parameters<typeof complete>[0]> = {}, gateway = false) {
  setEnv(
    gateway
      ? { LLM_PROVIDER: 'gateway', AI_GATEWAY_API_KEY: 'gw', LLM_MODEL_CHAT: model }
      : { LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'k', LLM_MODEL_CHAT: model },
  );
  const fake = fakeFetch(() => jsonResponse(REPLY));
  restore = fake.restore;
  await complete({ ...REQUEST, ...extra });
  return JSON.parse(fake.calls[0]?.body ?? '{}');
}

describe.each([
  ['direct', 'claude-sonnet-5-5', false],
  ['gateway', 'anthropic/claude-sonnet-5-5', true],
])('effort default on %s sonnet-5-5', (_name, model, gateway) => {
  const effortOf = (body: any) => (gateway ? body.providerOptions?.anthropic?.effort : body.output_config?.effort);

  it('sends low when thinking is not asked for', async () => {
    const body = await sent(model, {}, gateway);
    expect(effortOf(body)).toBe('low');
    expect(JSON.stringify(body)).not.toContain('"disabled"');
    expect(JSON.stringify(body)).not.toContain('budget_tokens');
  });

  it('sends low for thinking: false', async () => {
    expect(effortOf(await sent(model, { thinking: false }, gateway))).toBe('low');
  });

  it('sends no effort when thinking is asked for', async () => {
    expect(effortOf(await sent(model, { thinking: true }, gateway))).toBeUndefined();
  });

  it('lets an explicit effort win', async () => {
    expect(effortOf(await sent(model, { effort: 'high' }, gateway))).toBe('high');
    expect(effortOf(await sent(model, { thinking: true, effort: 'max' }, gateway))).toBe('max');
  });
});

describe('effort on rows without the capability', () => {
  it('sends nothing on claude-haiku-4-5', async () => {
    const body = await sent('claude-haiku-4-5');
    expect(body.output_config).toBeUndefined();
    expect((await sent('claude-haiku-4-5', { effort: 'high' })).output_config).toBeUndefined();
  });
});
