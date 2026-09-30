// The first-byte budget guards streams only. A non-streaming reply sends no
// byte until it is fully generated, so complete must not be raced against it.

import { afterEach, describe, expect, it } from 'vitest';

import { complete, stream } from '../src/index.ts';
import { clearEnv, setEnv } from './env.ts';
import { ANTHROPIC_MESSAGE, fakeFetch, jsonResponse } from './recorded.ts';

const REQUEST = {
  role: 'chat' as const,
  system: 'test',
  messages: [{ role: 'user' as const, content: 'hi' }],
  maxTokens: 64,
};

const ENV = { LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'k', LLM_MODELS_CHAT: 'anthropic/only-id' };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let restore: (() => void) | undefined;

afterEach(() => {
  restore?.();
  restore = undefined;
  clearEnv();
});

describe('connect budget', () => {
  it('lets complete answer after 3x the connect budget, inside the total budget', async () => {
    setEnv({ ...ENV, LLM_CONNECT_TIMEOUT_MS: '100', LLM_TIMEOUT_MS: '5000' });
    const fake = fakeFetch(async () => {
      await sleep(300);
      return jsonResponse(ANTHROPIC_MESSAGE);
    });
    restore = fake.restore;

    const result = await complete(REQUEST);

    expect(result.text.length).toBeGreaterThan(0);
    expect(fake.calls).toHaveLength(1);
  });

  it('still rejects complete past the total budget', async () => {
    setEnv({ ...ENV, LLM_CONNECT_TIMEOUT_MS: '100', LLM_TIMEOUT_MS: '250' });
    const fake = fakeFetch(() => new Promise<Response>(() => {}));
    restore = fake.restore;

    await expect(complete(REQUEST)).rejects.toMatchObject({ kind: 'unavailable' });
  });

  it('still rejects a stream that sends no byte inside the connect budget', async () => {
    setEnv({ ...ENV, LLM_CONNECT_TIMEOUT_MS: '100', LLM_TIMEOUT_MS: '5000' });
    const fake = fakeFetch(() => new Promise<Response>(() => {}));
    restore = fake.restore;

    const run = async () => {
      for await (const chunk of stream(REQUEST)) void chunk;
    };
    await expect(run()).rejects.toMatchObject({ kind: 'unavailable' });
  });
});
