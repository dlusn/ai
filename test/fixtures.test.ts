// Both consumer fixtures run on the stub with no vendor key set, which is the
// gate rule from the contract: LLM_PROVIDER=stub makes every gate pass.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { handler } from '../fixtures/edge-function.ts';
import { POST } from '../fixtures/next-route.ts';
import { resetSpeechStub, resetStub, setSpeechStub, setStubFixtures } from '../src/stub.ts';
import { clearEnv, setEnv } from './env.ts';
import { fakeFetch } from './recorded.ts';

let restore: (() => void) | undefined;

beforeEach(() => {
  // No LLM_API_KEY, no ANTHROPIC_API_KEY, no OPENAI_API_KEY, no GOOGLE_API_KEY.
  setEnv({ LLM_PROVIDER: 'stub', SPEECH_STT_PROVIDER: 'stub', SPEECH_TTS_PROVIDER: 'stub' });
  const fake = fakeFetch(() => {
    throw new Error('a gate must never reach the network');
  });
  restore = fake.restore;
});

afterEach(() => {
  restore?.();
  restore = undefined;
  resetStub();
  resetSpeechStub();
  clearEnv();
});

describe('Next route fixture', () => {
  it('answers from the stub and books zero cost', async () => {
    setStubFixtures({ chat: 'One sentence answer.' });

    const response = await POST(new Request('http://local.test/api/ask', {
      method: 'POST',
      body: JSON.stringify({ question: 'what is the seam' }),
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      text: 'One sentence answer.',
      model: 'stub-best',
      provider: 'stub',
      usd: 0,
    });
  });

  it('turns an LlmError into a status without the route knowing the vendor', async () => {
    // No fixture installed, so the stub refuses.
    const response = await POST(new Request('http://local.test/api/ask', {
      method: 'POST',
      body: JSON.stringify({ question: 'what is the seam' }),
    }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'bad_request', retryable: false });
  });
});

describe('Deno edge function fixture', () => {
  it('transcribes then classifies, both on the stub', async () => {
    setStubFixtures({ triage: 'count' });
    setSpeechStub({ transcribe: 'nineteen units at Tuggerah' });

    const form = new FormData();
    form.append('audio', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/m4a' }), 'clip.m4a');

    const response = await handler(new Request('http://local.test/triage', { method: 'POST', body: form }));

    expect(await response.json()).toEqual({
      said: 'nineteen units at Tuggerah',
      label: 'count',
      model: 'stub-fast',
    });
  });

  it('takes plain text too', async () => {
    setStubFixtures({ triage: 'note' });
    const form = new FormData();
    form.append('text', 'remember to order stock');

    const response = await handler(new Request('http://local.test/triage', { method: 'POST', body: form }));

    expect((await response.json()).label).toBe('note');
  });
});
