import { env } from '../env.ts';
import { LlmError } from '../errors.ts';
import { bytes, requireKey, speechFail, toBlob } from './shared.ts';
import type { SpeechAudio, Synthesis, TranscribeOptions, Transcript, Voice } from './types.ts';

const PROVIDER = 'elevenlabs';
const DEFAULT_STT_MODEL = 'scribe_v1';
const DEFAULT_TTS_MODEL = 'eleven_multilingual_v2';

function key(): string {
  return requireKey(env('ELEVENLABS_API_KEY'), PROVIDER, 'ELEVENLABS_API_KEY');
}

export async function transcribe(audio: SpeechAudio, opts: TranscribeOptions = {}): Promise<Transcript> {
  const model = opts.model ?? env('SPEECH_STT_MODEL') ?? DEFAULT_STT_MODEL;
  const form = new FormData();
  form.append('file', toBlob(audio), 'audio');
  form.append('model_id', model);
  if (opts.language) form.append('language_code', opts.language);
  if (opts.diarize) form.append('diarize', 'true');

  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': key() },
    body: form,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (!response.ok) await speechFail(response, PROVIDER);

  const json = (await response.json()) as { text?: string; language_code?: string };
  return {
    text: json.text ?? '',
    provider: PROVIDER,
    model,
    ...(json.language_code ? { language: json.language_code } : {}),
  };
}

export async function synthesize(text: string, voice: Voice): Promise<Synthesis> {
  const spec = typeof voice === 'string' ? { id: voice } : voice;
  // Voice ids are config, so an unset id is a configuration error, not a default.
  const voiceId = spec.id || env('SPEECH_TTS_VOICE');
  if (!voiceId) {
    throw new LlmError('No voice id. Pass one to synthesize or set SPEECH_TTS_VOICE.', {
      kind: 'bad_request',
      provider: PROVIDER,
    });
  }
  const model = spec.model ?? env('SPEECH_TTS_MODEL') ?? DEFAULT_TTS_MODEL;

  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`);
  if (spec.format) url.searchParams.set('output_format', spec.format);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': key(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      model_id: model,
      ...(spec.language ? { language_code: spec.language } : {}),
      ...(spec.speed ? { voice_settings: { speed: spec.speed } } : {}),
    }),
    ...(typeof voice === 'object' && voice.signal ? { signal: voice.signal } : {}),
  });
  if (!response.ok) await speechFail(response, PROVIDER);

  return {
    audio: await bytes(response),
    mime: response.headers.get('content-type') ?? 'audio/mpeg',
    provider: PROVIDER,
    model,
    voiceId,
  };
}
