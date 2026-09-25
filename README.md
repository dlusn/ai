# @dlusn/ai

The LLM-agnostic seam shared by DLUSN and ekoni. One package, one contract, five
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
the bundler compiles the TypeScript. The five AI SDK packages come along as
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
    "ai": "npm:ai@5.0.265",
    "@ai-sdk/anthropic": "npm:@ai-sdk/anthropic@2.0.105",
    "@ai-sdk/openai": "npm:@ai-sdk/openai@2.0.129",
    "@ai-sdk/google": "npm:@ai-sdk/google@2.0.99",
    "@ai-sdk/gateway": "npm:@ai-sdk/gateway@2.0.157"
  }
}
```

CI checks this works: `deno check` runs against `fixtures/deno-check.ts`,
`fixtures/edge-function.ts` and `fixtures/supabase/functions/seam/index.ts` on
every push.

#### Deno version pinning

Versions here and in `package.json` are **exact and identical**, no carets.
Two reasons, both from the Deno spike:

1. **Minimum dependency age.** Deno 2.9 refuses any npm version published in
   the last 24 hours, and the AI SDK ships several releases a day, so a caret
   range breaks a fresh install at random. Pin a release that has aged. Do not
   set `"minimumDependencyAge": 0` to get around it: that disables a supply
   chain control on every install to save one version bump.
   `npm run aged-pins` prints the newest release of each package that clears
   the gate.
2. **Drift.** The seam maps vendor knobs onto `providerOptions` names that move
   between minors. An exact pin makes an SDK bump a reviewed change.

One more spike finding is baked into the adapter: an openai-compatible endpoint
goes through `openai.chat(modelId)`, never the bare factory, which defaults to
the responses API and does not match a chat completions host.

### Boot proof

```bash
npm run boot:proof   # real Deno process, one request, stub provider, no key
```

`fixtures/supabase/functions/seam/index.ts` is a deployable edge function. The
stricter pass runs it inside the Supabase edge runtime container:

```bash
cd fixtures/supabase
supabase start
supabase functions serve seam --no-verify-jwt
curl -s -X POST http://127.0.0.1:54321/functions/v1/seam \
  -H 'content-type: application/json' -d '{"text":"nineteen at Tuggerah"}'
```

Docker must be up (Colima counts) and the checkout must sit under `$HOME`, or
the bind mount into the runtime container is empty.

## Environment

| Variable | Default | What it does |
|---|---|---|
| `LLM_PROVIDER` | `anthropic` | `anthropic`, `openai`, `openai-compatible`, `google`, `gateway` or `stub`. |
| `LLM_BASE_URL` | none | Required when `LLM_PROVIDER=openai-compatible`. Covers OpenRouter, Groq, Ollama, Mistral, a vLLM rig and anything else speaking the chat completions shape. |
| `LLM_API_KEY` | none | Falls back to `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY` or `AI_GATEWAY_API_KEY` for the matching provider. Not needed for `stub` or a compatible endpoint. |
| `LLM_MODELS_<ROLE>` | none | The ordered fallback chain. See below. Wins over the two variables under it. |
| `LLM_MODEL_<ROLE>` | registry tier row | Pins the model id for one role, for example `LLM_MODEL_CHAT`. A bare id on `LLM_PROVIDER`, never a `provider/model` pair. Required for `openai-compatible` and `gateway`, which have no honest default. |
| `LLM_FALLBACK_<ROLE>` | none | Second model id in the chain, the two entry form of `LLM_MODELS_<ROLE>`. |
| `LLM_CONNECT_TIMEOUT_MS` | `2000` | Milliseconds to first byte before a target is given up on. |
| `LLM_TIMEOUT_MS` | `30000` | Milliseconds for one whole attempt on one target. |
| `LLM_BREAKER_FAILURES` | `3` | Consecutive failures that open a target. |
| `LLM_BREAKER_MS` | `120000` | How long a target stays open before one half open probe. |
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

## The fallback chain

`LLM_MODELS_<ROLE>` is an ordered, comma separated list. Each entry is
`provider/model`, or a bare `model` on `LLM_PROVIDER`, either one optionally
followed by `|baseURL`:

```bash
# A home rig first, the same model hosted behind it.
LLM_MODELS_EXTRACT="openai-compatible/Qwen/Qwen3.6-27B|http://rig.local:8000/v1,openai-compatible/Qwen/Qwen3.6-27B|https://api.deepinfra.com/v1/openai"

# The broker first, anthropic direct behind it.
LLM_MODELS_DRAFT="gateway/anthropic/claude-sonnet-5,anthropic/claude-sonnet-5"

# The two entry form, unchanged from v0.1.
LLM_MODEL_CHAT=claude-opus-5-5
LLM_FALLBACK_CHAT=claude-sonnet-5
```

The first slash splits the provider off, so a gateway id keeps its own slash:
`gateway/anthropic/claude-sonnet-5`. `LLM_MODEL_<ROLE>` and
`LLM_FALLBACK_<ROLE>` never read a provider prefix, so the same string means
one thing there and one thing in a chain entry.

The seam tries each target in order and moves on when the target answers a
retryable failure (`rate_limit`, `overloaded`, `unavailable`, or a 404 on the
id), sends no first byte inside `LLM_CONNECT_TIMEOUT_MS`, or does not finish
inside `LLM_TIMEOUT_MS`. A `bad_request` or an `auth` failure stops the chain:
the next target would fail the same way.

After `LLM_BREAKER_FAILURES` consecutive failures a target's breaker opens for
`LLM_BREAKER_MS` and the seam skips it outright, which is what makes a rig that
is switched off cost nothing on the second call rather than a timeout every
time. One request is then let through as a half open probe; it closes the
breaker if it passes and reopens the window if it does not. The breaker is in
memory, per isolate, with no external state.

Every hop and every breaker transition emits one structured line:

```json
{"event":"llm.fallback","role":"extract","target":"openai-compatible/Qwen/Qwen3.6-27B@http://rig.local:8000/v1","next":"openai-compatible/Qwen/Qwen3.6-27B@https://api.deepinfra.com/v1/openai","kind":"unavailable","ms":2001,"reason":"No first byte in 2000ms."}
```

`console.warn` by default. Point it somewhere else with
`setLlmLogger((event) => log.warn(event))`.

## Providers

| Provider | Key | Model ids | Vision | Documents | Caching | Thinking |
|---|---|---|---|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` | tier defaults | yes | yes | yes | yes |
| `openai` | `OPENAI_API_KEY` | tier defaults | yes | yes | yes | yes |
| `google` | `GOOGLE_API_KEY` | tier defaults | yes | yes | yes | yes |
| `openai-compatible` | none needed | required | per host | per host | per host | per host |
| `vercel-gateway` (`gateway`) | `AI_GATEWAY_API_KEY` | required, `vendor/model` | per vendor | no | per vendor | per vendor |
| `stub` | none | tier defaults | n/a | n/a | n/a | n/a |

The gateway is a target like any other and **never a default**: selecting it
means naming the model id. Research verdict, 25 Sep 2026: health adjacent
coaching chat does not go through a broker, so the coach role pins `anthropic`
direct and only non health roles may name `gateway`.

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

A tool loop is two more part types. The model's calls come back on
`result.toolUses`, each with an `id`; you hand that id back as a `tool_use`
part and answer it with a `tool_result` part on the next user turn. Replay the
whole conversation each turn and every turn after the first keeps its context:

```ts
const first = await complete({ role: 'chat', system, messages, maxTokens: 1024, tools });

const answered = [
  ...messages,
  { role: 'assistant', content: [
    ...(first.text ? [{ type: 'text', text: first.text } as const] : []),
    ...first.toolUses.map((use) => ({ type: 'tool_use', id: use.id, name: use.name, input: use.input } as const)),
  ] },
  { role: 'user', content: first.toolUses.map((use) => ({
    type: 'tool_result',
    toolUseId: use.id,
    content: run(use.name, use.input), // a string, or text and image parts
  } as const)) },
];

const second = await complete({ role: 'chat', system, messages: answered, maxTokens: 1024, tools });
```

`isError: true` on a `tool_result` tells the model the tool failed, rather than
passing the failure off as an ordinary answer. A `tool_result` whose
`toolUseId` matches no earlier `tool_use` is a `bad_request` before any network
work starts: a dropped tool turn is never silent.

`LLM_PROVIDER=stub` round trips the loop too. The stub echoes the newest
`tool_result` it was handed in its text, so a tool loop can be tested end to
end with no vendor key.

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
import { costOf, costBreakdown, usageToCost } from '@dlusn/ai/pricing';

const usd = costOf(result, {
  onUnpriced: ({ provider, model }) => log.warn('unpriced pair', provider, model),
});

// Meter in currency without holding the result, for a usage row priced later.
const { usd: billed } = usageToCost(row.provider, row.model, row.usage);
```

An unpriced provider and model pair books zero and calls the hook. It never
throws in a request path. It also writes one structured warn line naming the
pair, `{"event":"llm.unpriced","target":"provider/model"}`, once per isolate:
zero is the safe answer in a request path, but a spend cap reading zero forever
because an id has no row is not something a deployment should have to notice on
its own.

Cached input tokens bill at the row's published cache read price. Where a
vendor publishes none, they bill at the input price less the row's
`expectedCacheDiscount`, so a compatible endpoint with no prompt cache
correctly books cached tokens at full price rather than free.

## Errors

Every failure is an `LlmError` with `kind`, `status`, `provider` and
`retryable`. Kinds: `rate_limit`, `overloaded`, `auth`, `bad_request`,
`unavailable`, `unknown`.

The fallback chain lives in the seam once. No route or edge function writes a
retry. See "The fallback chain" above for which failures move to the next
target and which stop.

## Development

```bash
npm install
npm test            # no-emdash gate, no-vendor-leak gate, vitest
npm run typecheck
npm run deno:check  # Deno importability, including the edge function fixture
npm run boot:proof  # a real Deno process answers one request
npm run aged-pins   # candidates when bumping the AI SDK pins
```

Tests run on recorded vendor responses, never on a live network.
