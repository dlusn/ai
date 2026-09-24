import { env } from '../env.ts';
import { bytes, requireKey, speechFail, toBody } from './shared.ts';
import type { SpeechAudio, Synthesis, TranscribeOptions, Transcript, Voice } from './types.ts';

const PROVIDER = 'deepgram';
const DEFAULT_STT_MODEL = 'nova-3';
const DEFAULT_TTS_MODEL = 'aura-2-thalia-en';

function key(): string {
  return requireKey(env('DEEPGRAM_API_KEY'), PROVIDER, 'DEEPGRAM_API_KEY');
}

export async function transcribe(audio: SpeechAudio, opts: TranscribeOptions = {}): Promise<Transcript> {
  const model = opts.model ?? env('SPEECH_STT_MODEL') ?? DEFAULT_STT_MODEL;
  const url = new URL('https://api.deepgram.com/v1/listen');
  url.searchParams.set('model', model);
  url.searchParams.set('smart_format', 'true');
  url.searchParams.set('punctuate', String(opts.punctuate ?? true));
  if (opts.diarize) url.searchParams.set('diarize', 'true');
  if (opts.language) url.searchParams.set('language', opts.language);
  // Keyterm boosting. The list is always caller supplied product vocabulary.
  for (const term of opts.keyterms ?? []) url.searchParams.append('keyterm', term);

  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Token ${key()}`, 'Content-Type': audio.mime },
    body: toBody(audio),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (!response.ok) await speechFail(response, PROVIDER);

  const json = (await response.json()) as {
    results?: { channels?: { alternatives?: { transcript?: string }[] }[] };
    metadata?: { duration?: number };
  };
  return {
    text: json.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? '',
    provider: PROVIDER,
    model,
    ...(opts.language ? { language: opts.language } : {}),
    ...(json.metadata?.duration === undefined ? {} : { durationSeconds: json.metadata.duration }),
  };
}

export async function synthesize(text: string, voice: Voice): Promise<Synthesis> {
  const spec = typeof voice === 'string' ? { id: voice } : voice;
  // A Deepgram voice is a model id, so the caller supplied id wins over the env
  // default and the constant is only the last resort.
  const model = spec.id || spec.model || env('SPEECH_TTS_MODEL') || DEFAULT_TTS_MODEL;
  const url = new URL('https://api.deepgram.com/v1/speak');
  url.searchParams.set('model', model);
  if (spec.format) url.searchParams.set('container', spec.format);

  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Token ${key()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
    ...(typeof voice === 'object' && voice.signal ? { signal: voice.signal } : {}),
  });
  if (!response.ok) await speechFail(response, PROVIDER);

  return {
    audio: await bytes(response),
    mime: response.headers.get('content-type') ?? 'audio/mpeg',
    provider: PROVIDER,
    model,
    voiceId: model,
  };
}
