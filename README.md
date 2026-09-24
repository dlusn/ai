# @dlusn/ai

The LLM-agnostic seam shared by DLUSN and ekoni. One package, one contract, four
runtime dependencies. No product or ops code talks to a model vendor directly.

Contract: <https://github.com/dlusn/ceo/blob/main/docs/llm-agnostic.md>

A call site passes a **role**. The vendor, the model id, the fallback chain and
the pricing are configuration the seam reads. Swapping Anthropic for OpenAI,
Gemini, OpenRouter or a local model is an env change, with zero edits to
features.

## Install

### Next (npm)

```bash
npm install github:dlusn/ai#<sha>
```

`main` and `types` point at `src`, the same install pattern as `@dlusn/kit`, so
the bundler compiles the TypeScript. The four AI SDK packages come along as
dependencies.

### Supabase edge functions (Deno)

Add the package and its dependencies to the function's `deno.json` imports:

```json
{
  "imports": {
    "@dlusn/ai": "https://raw.githubusercontent.com/dlusn/ai/<sha>/src/index.ts",
    "@dlusn/ai/speech": "https://raw.githubusercontent.com/dlusn/ai/<sha>/src/speech/index.ts",
    "@dlusn/ai/stub": "https://raw.githubusercontent.com/dlusn/ai/<sha>/src/stub.ts",
    "@dlusn/ai/pricing": "https://raw.githubusercontent.com/dlusn/ai/<sha>/src/pricing.ts",
    "ai": "npm:ai@^5.0.0",
    "@ai-sdk/anthropic": "npm:@ai-sdk/anthropic@^2.0.0",
    "@ai-sdk/openai": "npm:@ai-sdk/openai@^2.0.0",
    "@ai-sdk/google": "npm:@ai-sdk/google@^2.0.0"
  }
}
```

CI checks this works: `deno check` runs against `fixtures/deno-check.ts` and
`fixtures/edge-function.ts` on every push.

## Environment

| Variable | Default | What it does |
|---|---|---|
| `LLM_PROVIDER` | `anthropic` | `anthropic`, `openai`, `openai-compatible`, `google` or `stub`. |
| `LLM_BASE_URL` | none | Required when `LLM_PROVIDER=openai-compatible`. Covers OpenRouter, Groq, Ollama, Mistral and anything else speaking the chat completions shape. |
| `LLM_API_KEY` | none | Falls back to `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` or `GOOGLE_API_KEY` for the matching provider. Not needed for `stub`. |
| `LLM_MODEL_<ROLE>` | registry tier row | Pins the model id for one role, for example `LLM_MODEL_CHAT`. Required for `openai-compatible`, which has no honest default. |
| `LLM_FALLBACK_<ROLE>` | none | Model id tried once when the first id answers 429, 503, 529 or 404. |
| `SPEECH_STT_PROVIDER` | `deepgram` | `deepgram`, `elevenlabs`, `cartesia` or `stub`. |
| `SPEECH_TTS_PROVIDER` | `elevenlabs` | Same set. |
| `SPEECH_STT_MODEL` | provider default | Overridable per call through `opts.model`. |
| `SPEECH_TTS_MODEL` | provider default | Overridable per call through the voice object. |
| `SPEECH_TTS_VOICE` | none | Default voice id when the caller passes an empty one. |
| `DEEPGRAM_API_KEY` | none | Needed when Deepgram is selected. |
| `ELEVENLABS_API_KEY` | none | Needed when ElevenLabs is selected. |
| `CARTESIA_API_KEY` | none | Needed when Cartesia is selected. |

Roles and the tier each resolves to by default:

| Role | Tier |
|---|---|
| `chat` | `best` |
| `draft` | `standard` |
| `vision` | `standard` |
| `extract` | `fast` |
| `triage` | `fast` |

An unknown role throws at `resolveModel` time, not at call time.

## Exports

### `.` text, vision and structured output

```ts
import { complete, stream, completeObject } from '@dlusn/ai';

const result = await complete({
  role: 'chat',
  system: 'Answer in one sentence.',
  messages: [{ role: 'user', content: 'What is a phase?' }],
  maxTokens: 512,
  cache: true, // applied where the provider supports it, skipped where it does not
});
// result.text, result.toolUses, result.stopReason, result.usage, result.provider, result.model
```

Vision is a message part. The adapter converts it to the vendor shape:

```ts
await complete({
  role: 'vision',
  system: 'Estimate the portion.',
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: 'How much is this?' },
      { type: 'image', mime: 'image/jpeg', base64 },
    ],
  }],
  maxTokens: 256,
});
```

Structured output takes plain JSON Schema, so no schema library enters the
dependency list:

```ts
const { object } = await completeObject<{ food: string; grams: number }>(
  { role: 'extract', system: 'Extract the food.', messages, maxTokens: 128 },
  { type: 'object', properties: { food: { type: 'string' }, grams: { type: 'number' } }, required: ['food', 'grams'] },
);
```

Streaming yields text and tool chunks, then one `done` chunk carrying the same
`LlmResult` that `complete` would have returned:

```ts
for await (const chunk of stream(request)) {
  if (chunk.type === 'text') write(chunk.text);
  if (chunk.type === 'done') meter(chunk.result.usage);
}
```

### `./speech`

```ts
import { transcribe, synthesize } from '@dlusn/ai/speech';

// Keyterms are product vocabulary, always passed in, never a constant here.
const said = await transcribe({ data: bytes, mime: 'audio/m4a' }, {
  keyterms: ['Tuggerah', 'Erina Fair'],
  language: 'en-AU',
});

// Voice ids are config too.
const audio = await synthesize('Your count is ready.', { id: process.env.COACH_VOICE_ID! });
```

### `./stub`

`LLM_PROVIDER=stub` makes every verify script and gate pass with no vendor key.
Fixtures come from the caller, and every call is recorded.

```ts
import { setStubFixtures, stubCalls, resetStub, setSpeechStub } from '@dlusn/ai/stub';

setStubFixtures({ chat: 'canned answer', extract: '{"food":"oats","grams":120}' });
setSpeechStub({ transcribe: 'nineteen units at Tuggerah' });

await complete({ role: 'chat', system: '', messages, maxTokens: 64 });
expect(stubCalls()[0].request.system).toBe('');
resetStub();
```

### `./pricing`

```ts
import { costOf, costBreakdown } from '@dlusn/ai/pricing';

const usd = costOf(result, {
  onUnpriced: ({ provider, model }) => log.warn('unpriced pair', provider, model),
});
```

An unpriced provider and model pair books zero and calls the hook. It never
throws in a request path.

## Errors

Every failure is an `LlmError` with `kind`, `status`, `provider` and
`retryable`. Kinds: `rate_limit`, `overloaded`, `auth`, `bad_request`,
`unavailable`, `unknown`.

The capacity fallback lives in the seam once. A 429, 503, 529 or a 404 on the
model id retries a single time on `LLM_FALLBACK_<ROLE>` if one is set. No route
or edge function writes a retry.

## Development

```bash
npm install
npm test        # no-emdash gate, no-vendor-leak gate, vitest
npm run typecheck
deno check --config deno.json fixtures/deno-check.ts fixtures/edge-function.ts
```

Tests run on recorded vendor responses, never on a live network.
