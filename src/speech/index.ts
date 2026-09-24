// The speech seam. Same principle as the text seam: the call site passes audio
// or text, the provider and the voice id are configuration.

import { env } from '../env.ts';
import { LlmError } from '../errors.ts';
import * as cartesia from './cartesia.ts';
import * as deepgram from './deepgram.ts';
import * as elevenlabs from './elevenlabs.ts';
import { stubSynthesize, stubTranscribe } from './stub.ts';
import type { SpeechAudio, SpeechProvider, Synthesis, TranscribeOptions, Transcript, Voice } from './types.ts';

export * from './types.ts';
export { LlmError } from '../errors.ts';

const PROVIDERS: readonly SpeechProvider[] = ['deepgram', 'elevenlabs', 'cartesia', 'stub'];

function pick(raw: string | undefined, fallback: SpeechProvider, varName: string): SpeechProvider {
  const value = raw ?? fallback;
  if (!PROVIDERS.includes(value as SpeechProvider)) {
    throw new LlmError(`Unknown ${varName} "${value}". Expected one of ${PROVIDERS.join(', ')}.`, {
      kind: 'bad_request',
      provider: value,
    });
  }
  return value as SpeechProvider;
}

export function sttProvider(override?: SpeechProvider): SpeechProvider {
  return pick(override ?? env('SPEECH_STT_PROVIDER'), 'deepgram', 'SPEECH_STT_PROVIDER');
}

export function ttsProvider(override?: SpeechProvider): SpeechProvider {
  return pick(override ?? env('SPEECH_TTS_PROVIDER'), 'elevenlabs', 'SPEECH_TTS_PROVIDER');
}

/** Speech to text. Keyterms and language are always caller supplied. */
export async function transcribe(audio: SpeechAudio, opts: TranscribeOptions = {}): Promise<Transcript> {
  switch (sttProvider(opts.provider)) {
    case 'deepgram':
      return deepgram.transcribe(audio, opts);
    case 'elevenlabs':
      return elevenlabs.transcribe(audio, opts);
    case 'cartesia':
      return cartesia.transcribe(audio, opts);
    case 'stub':
      return stubTranscribe(audio, opts);
  }
}

/** Text to speech. The voice id is config, never a constant in this package. */
export async function synthesize(text: string, voice: Voice): Promise<Synthesis> {
  const override = typeof voice === 'object' ? voice.provider : undefined;
  switch (ttsProvider(override)) {
    case 'deepgram':
      return deepgram.synthesize(text, voice);
    case 'elevenlabs':
      return elevenlabs.synthesize(text, voice);
    case 'cartesia':
      return cartesia.synthesize(text, voice);
    case 'stub':
      return stubSynthesize(text, voice);
  }
}
