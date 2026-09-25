import { afterEach, describe, expect, it } from 'vitest';

import { sttProvider, synthesize, transcribe, ttsProvider } from '../src/speech/index.ts';
import { resetSpeechStub, setSpeechStub, speechStubCalls } from '../src/stub.ts';
import { clearEnv, setEnv } from './env.ts';
import { fakeFetch, jsonResponse } from './recorded.ts';

const AUDIO = { data: new Uint8Array([1, 2, 3, 4]), mime: 'audio/wav' };

let restore: (() => void) | undefined;

afterEach(() => {
  restore?.();
  restore = undefined;
  resetSpeechStub();
  clearEnv();
});

describe('speech stub', () => {
  it('transcribes from a fixture with no key and no network', async () => {
    setEnv({ SPEECH_STT_PROVIDER: 'stub' });
    setSpeechStub({ transcribe: 'count nineteen units at Tuggerah' });
    const fake = fakeFetch(() => {
      throw new Error('the speech stub must never reach the network');
    });
    restore = fake.restore;

    const result = await transcribe(AUDIO, { keyterms: ['Tuggerah'] });

    expect(result).toMatchObject({ text: 'count nineteen units at Tuggerah', provider: 'stub' });
    expect(fake.calls).toHaveLength(0);
    expect(speechStubCalls()).toEqual([
      { kind: 'transcribe', mime: 'audio/wav', byteLength: 4, opts: { keyterms: ['Tuggerah'] } },
    ]);
  });

  it('synthesizes from a fixture and records the voice it was given', async () => {
    setEnv({ SPEECH_TTS_PROVIDER: 'stub' });
    setSpeechStub({ synthesize: 'fake-audio-bytes' });

    const result = await synthesize('ready', { id: 'voice-abc' });

    expect(result.provider).toBe('stub');
    expect(result.voiceId).toBe('voice-abc');
    expect(new TextDecoder().decode(result.audio)).toBe('fake-audio-bytes');
    expect(speechStubCalls()[0]).toMatchObject({ kind: 'synthesize', text: 'ready' });
  });

  it('says which fixture is missing', async () => {
    setEnv({ SPEECH_STT_PROVIDER: 'stub' });
    await expect(transcribe(AUDIO)).rejects.toThrowError(/setSpeechStub/);
  });
});

describe('provider selection', () => {
  it('defaults to deepgram for speech to text and elevenlabs for text to speech', () => {
    clearEnv();
    expect(sttProvider()).toBe('deepgram');
    expect(ttsProvider()).toBe('elevenlabs');
  });

  it('follows the env vars', () => {
    setEnv({ SPEECH_STT_PROVIDER: 'cartesia', SPEECH_TTS_PROVIDER: 'cartesia' });
    expect(sttProvider()).toBe('cartesia');
    expect(ttsProvider()).toBe('cartesia');
  });

  it('rejects an unknown provider', () => {
    setEnv({ SPEECH_STT_PROVIDER: 'whisperer' });
    expect(() => sttProvider()).toThrowError(/Unknown SPEECH_STT_PROVIDER/);
  });

  it('needs a key per provider', async () => {
    setEnv({ SPEECH_STT_PROVIDER: 'deepgram' });
    await expect(transcribe(AUDIO)).rejects.toThrowError(/DEEPGRAM_API_KEY/);
    setEnv({ SPEECH_TTS_PROVIDER: 'cartesia' });
    await expect(synthesize('hi', 'voice-abc')).rejects.toThrowError(/CARTESIA_API_KEY/);
  });
});

describe('vendor specifics stay opts, never constants', () => {
  it('sends deepgram keyterms as caller supplied query params', async () => {
    setEnv({ SPEECH_STT_PROVIDER: 'deepgram', DEEPGRAM_API_KEY: 'k' });
    const fake = fakeFetch(() =>
      jsonResponse({
        results: { channels: [{ alternatives: [{ transcript: 'nineteen at Tuggerah' }] }] },
        metadata: { duration: 3.5 },
      }),
    );
    restore = fake.restore;

    const result = await transcribe(AUDIO, { keyterms: ['Tuggerah', 'Erina Fair'], language: 'en-AU' });

    const url = new URL(fake.calls[0]?.url ?? '');
    expect(url.searchParams.getAll('keyterm')).toEqual(['Tuggerah', 'Erina Fair']);
    expect(url.searchParams.get('language')).toBe('en-AU');
    expect(result).toMatchObject({ text: 'nineteen at Tuggerah', provider: 'deepgram', durationSeconds: 3.5 });
  });

  it('sends the elevenlabs voice id from the caller, not from a constant', async () => {
    setEnv({ SPEECH_TTS_PROVIDER: 'elevenlabs', ELEVENLABS_API_KEY: 'k' });
    const fake = fakeFetch(() => new Response(new Uint8Array([9, 9]), { headers: { 'content-type': 'audio/mpeg' } }));
    restore = fake.restore;

    const result = await synthesize('ready', { id: 'voice-abc', speed: 1.1 });

    expect(fake.calls[0]?.url).toContain('/v1/text-to-speech/voice-abc');
    expect(JSON.parse(fake.calls[0]?.body ?? '{}')).toMatchObject({ text: 'ready', voice_settings: { speed: 1.1 } });
    expect(result).toMatchObject({ provider: 'elevenlabs', voiceId: 'voice-abc', mime: 'audio/mpeg' });
  });

  it('refuses to invent a voice id', async () => {
    setEnv({ SPEECH_TTS_PROVIDER: 'elevenlabs', ELEVENLABS_API_KEY: 'k' });
    await expect(synthesize('ready', '')).rejects.toThrowError(/voice id/);
  });
});
