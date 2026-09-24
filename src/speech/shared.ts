import { LlmError, kindForStatus } from '../errors.ts';
import type { SpeechAudio } from './types.ts';

export function toBlob(audio: SpeechAudio): Blob {
  if (audio.data instanceof Blob) return audio.data;
  const bytes = audio.data instanceof ArrayBuffer ? new Uint8Array(audio.data) : audio.data;
  return new Blob([bytes as unknown as BlobPart], { type: audio.mime });
}

export function toBody(audio: SpeechAudio): BodyInit {
  if (audio.data instanceof Blob) return audio.data;
  return audio.data instanceof ArrayBuffer ? audio.data : (audio.data.slice().buffer as ArrayBuffer);
}

export async function bytes(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer());
}

/** Turn a non 2xx speech response into the same LlmError every seam throws. */
export async function speechFail(response: Response, provider: string): Promise<never> {
  const body = await response.text().catch(() => '');
  throw new LlmError(`${provider} responded ${response.status}. ${body.slice(0, 400)}`, {
    kind: kindForStatus(response.status),
    status: response.status,
    provider,
  });
}

export function requireKey(value: string | undefined, provider: string, name: string): string {
  if (!value) {
    throw new LlmError(`No API key for ${provider}. Set ${name}.`, { kind: 'auth', provider });
  }
  return value;
}
