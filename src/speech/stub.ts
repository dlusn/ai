// Speech stub. No network, no vendor key, caller supplied fixtures.

import { LlmError } from '../errors.ts';
import type { SpeechAudio, Synthesis, TranscribeOptions, Transcript, Voice } from './types.ts';

export type SpeechStubFixtures = {
  /** What transcribe returns. A bare string is the transcript text. */
  transcribe?: string | Partial<Transcript>;
  /** What synthesize returns. A bare string is encoded to bytes. */
  synthesize?: string | Uint8Array | Partial<Synthesis>;
};

export type SpeechStubCall =
  | { kind: 'transcribe'; mime: string; byteLength: number; opts: TranscribeOptions }
  | { kind: 'synthesize'; text: string; voice: Voice };

let fixtures: SpeechStubFixtures = {};
let calls: SpeechStubCall[] = [];

export function setSpeechStub(next: SpeechStubFixtures): void {
  fixtures = { ...next };
}

export function speechStubCalls(): readonly SpeechStubCall[] {
  return calls;
}

export function resetSpeechStub(): void {
  fixtures = {};
  calls = [];
}

function byteLengthOf(audio: SpeechAudio): number {
  if (audio.data instanceof Blob) return audio.data.size;
  if (audio.data instanceof ArrayBuffer) return audio.data.byteLength;
  return audio.data.byteLength;
}

export function stubTranscribe(audio: SpeechAudio, opts: TranscribeOptions = {}): Transcript {
  calls.push({ kind: 'transcribe', mime: audio.mime, byteLength: byteLengthOf(audio), opts });
  const fixture = fixtures.transcribe;
  if (fixture === undefined) {
    throw new LlmError('No speech stub for transcribe. Call setSpeechStub({ transcribe: "..." }) first.', {
      kind: 'bad_request',
      provider: 'stub',
    });
  }
  const spec = typeof fixture === 'string' ? { text: fixture } : fixture;
  return { text: spec.text ?? '', provider: 'stub', model: spec.model ?? 'stub-stt', ...spec };
}

export function stubSynthesize(text: string, voice: Voice): Synthesis {
  calls.push({ kind: 'synthesize', text, voice });
  const fixture = fixtures.synthesize;
  if (fixture === undefined) {
    throw new LlmError('No speech stub for synthesize. Call setSpeechStub({ synthesize: "..." }) first.', {
      kind: 'bad_request',
      provider: 'stub',
    });
  }
  const voiceId = typeof voice === 'string' ? voice : voice.id;
  if (typeof fixture === 'string') {
    return { audio: new TextEncoder().encode(fixture), mime: 'audio/mpeg', provider: 'stub', model: 'stub-tts', voiceId };
  }
  if (fixture instanceof Uint8Array) {
    return { audio: fixture, mime: 'audio/mpeg', provider: 'stub', model: 'stub-tts', voiceId };
  }
  return {
    audio: fixture.audio ?? new Uint8Array(0),
    mime: fixture.mime ?? 'audio/mpeg',
    provider: 'stub',
    model: fixture.model ?? 'stub-tts',
    voiceId: fixture.voiceId ?? voiceId,
  };
}
