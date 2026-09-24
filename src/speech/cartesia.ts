import { env } from '../env.ts';
import { LlmError } from '../errors.ts';
import { bytes, requireKey, speechFail, toBlob } from './shared.ts';
import type { SpeechAudio, Synthesis, TranscribeOptions, Transcript, Voice } from './types.ts';

const PROVIDER = 'cartesia';
const API_VERSION = '2025-04-16';
const DEFAULT_STT_MODEL = 'ink-whisper';
const DEFAULT_TTS_MODEL = 'sonic-2';

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${requireKey(env('CARTESIA_API_KEY'), PROVIDER, 'CARTESIA_API_KEY')}`,
    'Cartesia-Version': env('CARTESIA_VERSION') ?? API_VERSION,
  };
}

export async function transcribe(audio: SpeechAudio, opts: TranscribeOptions = {}): Promise<Transcript> {
  const model = opts.model ?? env('SPEECH_STT_MODEL') ?? DEFAULT_STT_MODEL;
  const form = new FormData();
  form.append('file', toBlob(audio), 'audio');
  form.append('model', model);
  if (opts.language) form.append('language', opts.language);

  const response = await fetch('https://api.cartesia.ai/stt', {
    method: 'POST',
    headers: headers(),
    body: form,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (!response.ok) await speechFail(response, PROVIDER);

  const json = (await response.json()) as { text?: string; duration?: number; language?: string };
  return {
    text: json.text ?? '',
    provider: PROVIDER,
    model,
    ...(json.language ? { language: json.language } : {}),
    ...(json.duration === undefined ? {} : { durationSeconds: json.duration }),
  };
}

export async function synthesize(text: string, voice: Voice): Promise<Synthesis> {
  const spec = typeof voice === 'string' ? { id: voice } : voice;
  const voiceId = spec.id || env('SPEECH_TTS_VOICE');
  if (!voiceId) {
    throw new LlmError('No voice id. Pass one to synthesize or set SPEECH_TTS_VOICE.', {
      kind: 'bad_request',
      provider: PROVIDER,
    });
  }
  const model = spec.model ?? env('SPEECH_TTS_MODEL') ?? DEFAULT_TTS_MODEL;
  const container = spec.format ?? 'mp3';

  const response = await fetch('https://api.cartesia.ai/tts/bytes', {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model_id: model,
      transcript: text,
      voice: { mode: 'id', id: voiceId, ...(spec.speed ? { __experimental_controls: { speed: spec.speed } } : {}) },
      output_format: { container, sample_rate: 44_100, ...(container === 'mp3' ? { bit_rate: 128_000 } : { encoding: 'pcm_f32le' }) },
      ...(spec.language ? { language: spec.language } : {}),
    }),
    ...(typeof voice === 'object' && voice.signal ? { signal: voice.signal } : {}),
  });
  if (!response.ok) await speechFail(response, PROVIDER);

  return {
    audio: await bytes(response),
    mime: response.headers.get('content-type') ?? (container === 'mp3' ? 'audio/mpeg' : 'audio/wav'),
    provider: PROVIDER,
    model,
    voiceId,
  };
}
