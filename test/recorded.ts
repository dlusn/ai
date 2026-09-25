// Recorded responses, captured once from each vendor and frozen here. Tests
// never reach the network: the fake fetch below answers from these bodies.

export const RECORDED_TEXT = 'Hello from the seam.';

export const ANTHROPIC_MESSAGE = {
  id: 'msg_recorded',
  type: 'message',
  role: 'assistant',
  model: 'claude-sonnet-5',
  content: [{ type: 'text', text: RECORDED_TEXT }],
  stop_reason: 'end_turn',
  stop_sequence: null,
  usage: {
    input_tokens: 120,
    output_tokens: 18,
    cache_read_input_tokens: 40,
    cache_creation_input_tokens: 10,
  },
};

export const OPENAI_CHAT_COMPLETION = {
  id: 'chatcmpl_recorded',
  object: 'chat.completion',
  created: 1_759_000_000,
  model: 'house-model-1',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: RECORDED_TEXT, refusal: null },
      logprobs: null,
      finish_reason: 'stop',
    },
  ],
  usage: {
    prompt_tokens: 120,
    completion_tokens: 18,
    total_tokens: 138,
    prompt_tokens_details: { cached_tokens: 40 },
  },
};

export const GOOGLE_GENERATE_CONTENT = {
  candidates: [
    {
      content: { parts: [{ text: RECORDED_TEXT }], role: 'model' },
      finishReason: 'STOP',
      index: 0,
    },
  ],
  usageMetadata: {
    promptTokenCount: 120,
    candidatesTokenCount: 18,
    totalTokenCount: 138,
    cachedContentTokenCount: 40,
  },
  modelVersion: 'gemini-2.5-flash',
};

export type RecordedCall = { url: string; init: RequestInit | undefined; body: string };

/**
 * Replaces globalThis.fetch with a recorder that answers from the map above.
 * Returns the captured calls and a restore function.
 */
export function fakeFetch(
  handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>,
): { calls: RecordedCall[]; restore: () => void } {
  const calls: RecordedCall[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const body = typeof init?.body === 'string' ? init.body : '';
    calls.push({ url, init, body });
    return handler(url, init);
  }) as typeof globalThis.fetch;

  return { calls, restore: () => { globalThis.fetch = original; } };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
