// Every test drives the seam through env, the same way a deployment does.

import { resetBreakers } from '../src/breaker.ts';
import { setLlmLogger } from '../src/log.ts';

const MANAGED = [
  'LLM_PROVIDER',
  'LLM_BASE_URL',
  'LLM_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'AI_GATEWAY_API_KEY',
  'LLM_MODEL_CHAT',
  'LLM_MODEL_DRAFT',
  'LLM_MODEL_VISION',
  'LLM_MODEL_EXTRACT',
  'LLM_MODEL_TRIAGE',
  'LLM_MODELS_CHAT',
  'LLM_MODELS_DRAFT',
  'LLM_MODELS_VISION',
  'LLM_MODELS_EXTRACT',
  'LLM_MODELS_TRIAGE',
  'LLM_FALLBACK_CHAT',
  'LLM_FALLBACK_EXTRACT',
  'LLM_TIMEOUT_MS',
  'LLM_CONNECT_TIMEOUT_MS',
  'LLM_BREAKER_MS',
  'LLM_BREAKER_FAILURES',
  'SPEECH_STT_PROVIDER',
  'SPEECH_TTS_PROVIDER',
  'SPEECH_STT_MODEL',
  'SPEECH_TTS_MODEL',
  'SPEECH_TTS_VOICE',
  'DEEPGRAM_API_KEY',
  'ELEVENLABS_API_KEY',
  'CARTESIA_API_KEY',
];

/**
 * Env, the breakers and the log sink are all per isolate, so a test that leaves
 * any of the three behind poisons the next one. Clearing all three together is
 * the only honest reset.
 */
export function clearEnv(): void {
  for (const key of MANAGED) delete process.env[key];
  resetBreakers();
  setLlmLogger(() => {});
}

export function setEnv(values: Record<string, string>): void {
  clearEnv();
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}

/** Collect the structured lines the seam emits during one test. */
export function collectLogs(): { lines: { event: string; target: string; next?: string }[] } {
  const lines: { event: string; target: string; next?: string }[] = [];
  setLlmLogger((event) => lines.push(event));
  return { lines };
}
