// Every test drives the seam through env, the same way a deployment does.

const MANAGED = [
  'LLM_PROVIDER',
  'LLM_BASE_URL',
  'LLM_API_KEY',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'LLM_MODEL_CHAT',
  'LLM_MODEL_DRAFT',
  'LLM_MODEL_VISION',
  'LLM_MODEL_EXTRACT',
  'LLM_MODEL_TRIAGE',
  'LLM_FALLBACK_CHAT',
  'LLM_FALLBACK_EXTRACT',
  'SPEECH_STT_PROVIDER',
  'SPEECH_TTS_PROVIDER',
  'SPEECH_STT_MODEL',
  'SPEECH_TTS_MODEL',
  'SPEECH_TTS_VOICE',
  'DEEPGRAM_API_KEY',
  'ELEVENLABS_API_KEY',
  'CARTESIA_API_KEY',
];

export function clearEnv(): void {
  for (const key of MANAGED) delete process.env[key];
}

export function setEnv(values: Record<string, string>): void {
  clearEnv();
  for (const [key, value] of Object.entries(values)) process.env[key] = value;
}
