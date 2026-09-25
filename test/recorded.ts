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

// The tool the round trip fixture calls, and the answer the caller hands back.
export const RECORDED_TOOL = 'get_weather';
export const RECORDED_TOOL_INPUT = { city: 'Sydney' };
export const RECORDED_TOOL_RESULT = '22 degrees and clear.';

// The openai provider speaks the responses API, not chat completions: the
// chat completions body above is the openai-compatible half of the seam.
const OPENAI_RESPONSE_USAGE = {
  input_tokens: 120,
  output_tokens: 18,
  total_tokens: 138,
  input_tokens_details: { cached_tokens: 40 },
  output_tokens_details: { reasoning_tokens: 0 },
};

export const OPENAI_RESPONSE = {
  id: 'resp_recorded',
  object: 'response',
  created_at: 1_759_000_000,
  status: 'completed',
  model: 'gpt-5',
  output: [
    {
      type: 'message',
      id: 'msg_recorded',
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text: RECORDED_TEXT, annotations: [] }],
    },
  ],
  incomplete_details: null,
  usage: OPENAI_RESPONSE_USAGE,
};

// Second turn replies: the model has seen the tool result and answers in text.
export const ANTHROPIC_AFTER_TOOL = ANTHROPIC_MESSAGE;
export const OPENAI_AFTER_TOOL = OPENAI_RESPONSE;
export const OPENAI_COMPATIBLE_AFTER_TOOL = OPENAI_CHAT_COMPLETION;
export const GOOGLE_AFTER_TOOL = GOOGLE_GENERATE_CONTENT;

// First turn replies: the model asks for the tool. Every vendor but google
// carries its own call id, which is what LlmResult.toolUses[].id reports back.
export const ANTHROPIC_TOOL_USE = {
  ...ANTHROPIC_MESSAGE,
  content: [
    { type: 'text', text: 'Checking.' },
    { type: 'tool_use', id: 'toolu_recorded', name: RECORDED_TOOL, input: RECORDED_TOOL_INPUT },
  ],
  stop_reason: 'tool_use',
};

export const OPENAI_TOOL_USE = {
  ...OPENAI_RESPONSE,
  status: 'completed',
  output: [
    {
      type: 'function_call',
      id: 'fc_recorded',
      call_id: 'call_recorded',
      name: RECORDED_TOOL,
      arguments: JSON.stringify(RECORDED_TOOL_INPUT),
      status: 'completed',
    },
  ],
};

export const OPENAI_COMPATIBLE_TOOL_USE = {
  ...OPENAI_CHAT_COMPLETION,
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: null,
        refusal: null,
        tool_calls: [
          {
            id: 'call_recorded',
            type: 'function',
            function: { name: RECORDED_TOOL, arguments: JSON.stringify(RECORDED_TOOL_INPUT) },
          },
        ],
      },
      logprobs: null,
      finish_reason: 'tool_calls',
    },
  ],
};

// Google names no call id, so the SDK generates one. The contract still hands
// the caller an id, which is the whole point of generating one.
export const GOOGLE_TOOL_USE = {
  ...GOOGLE_GENERATE_CONTENT,
  candidates: [
    {
      content: {
        parts: [{ functionCall: { name: RECORDED_TOOL, args: RECORDED_TOOL_INPUT } }],
        role: 'model',
      },
      finishReason: 'STOP',
      index: 0,
    },
  ],
};

// The gateway answers in the AI SDK's own provider neutral shape, where a tool
// call's input is a JSON string rather than an object.
export const GATEWAY_AFTER_TOOL = {
  content: [{ type: 'text', text: RECORDED_TEXT }],
  finishReason: 'stop',
  usage: { inputTokens: 120, outputTokens: 18, cachedInputTokens: 40 },
  warnings: [],
};

export const GATEWAY_TOOL_USE = {
  content: [
    {
      type: 'tool-call',
      toolCallId: 'gw_call_recorded',
      toolName: RECORDED_TOOL,
      input: JSON.stringify(RECORDED_TOOL_INPUT),
    },
  ],
  finishReason: 'tool-calls',
  usage: { inputTokens: 120, outputTokens: 18, cachedInputTokens: 40 },
  warnings: [],
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
