# DECISIONS

Living record. Newest first.

## 25 Sep 2026, v0.2.0

### A chain entry carries its own base URL after a pipe

`LLM_MODELS_EXTRACT=openai-compatible/qwen|http://rig.local:8000/v1,openai-compatible/qwen|https://hosted.test/v1`.
The whole point of the chain is a home rig with the same model hosted behind it,
and both halves are `openai-compatible` on different hosts, so a per provider
base URL cannot express it and a positional `LLM_BASE_URL_2` would silently
attach to the wrong hop the moment the list is reordered. A pipe never appears
in a model id or a URL, so the split is unambiguous. `LLM_BASE_URL` still
applies to any target on `LLM_PROVIDER` that did not bring its own.

### Only `LLM_MODELS_<ROLE>` reads a provider prefix

A gateway model id is already `vendor/model`, so `anthropic/claude-sonnet-5`
would mean two different things depending on which variable it sat in.
`LLM_MODEL_<ROLE>` and `LLM_FALLBACK_<ROLE>` stay bare ids on `LLM_PROVIDER`,
exactly as in v0.1. A chain entry that wants the broker writes
`gateway/anthropic/claude-sonnet-5`, and the first slash is the provider split.

### Both timeouts are raced, not only aborted

A host that accepts the socket and then says nothing never rejects, so an
`AbortSignal` alone would leave the chain waiting on a target that is already
declared dead. `LLM_CONNECT_TIMEOUT_MS` races inside the custom fetch, where
first byte means the response headers arrived, and `LLM_TIMEOUT_MS` races the
whole attempt. The abort still fires either way, so the socket is released.

### The breaker is in memory and per isolate, and that is the point

The breaker exists to make a dead target cost nothing on the second call. A
shared store would put a network round trip on the path whose whole purpose is
avoiding one. An edge isolate is short lived, so the worst case is one extra
wasted attempt after a cold start.

### A registry row is not a tier default

`ROWS` is flat and `REGISTRY` picks the three tier defaults out of it. That is
what lets gpt-6-astra and gemini-3.8-flash be priced, metered and pinnable
today without silently moving any role onto a model that costs eight times what
it replaced. Promoting one is an owner decision.

### The gateway is a target, never a default

`REGISTRY.gateway` is all nulls, the same as `openai-compatible`, so selecting
the broker means naming the model id. Research verdict, 25 Sep 2026: health
adjacent coaching chat never goes through a broker, so the coach role pins
`anthropic` direct and only the non health roles may name `gateway`.

### `expectedCacheDiscount` prices the rows the vendor does not

Where a vendor publishes a cache read price the published number bills. Where
it does not, cached tokens bill at the input price less this number, which is
how a compatible endpoint with no prompt cache correctly books cached tokens at
full price. A test keeps the two in step on every row that has both.

### Structured output is `generateText` with `Output.object`

`generateObject` is deprecated in the current AI SDK major. On anthropic this
path still lands as a forced tool call, which is what that vendor answers a
structured request with, so the contract shape is unchanged. One fixture goes
through anthropic, openai-compatible, google, gateway and the stub.

### Pins are exact and aged, not `minimumDependencyAge: 0`

Deno 2.9 blocks any npm version published in the last 24 hours. Disabling the
gate would trade a supply chain control for convenience on every install, so
the pins are the newest release of each package that clears it.
`npm run aged-pins` prints the candidates when bumping.

## 25 Sep 2026, v0.1.0

### The seam owns the retry policy, the SDK does not

`maxRetries: 0` on every AI SDK call, and the seam does exactly one retry: the
capacity fallback to `LLM_FALLBACK_<ROLE>`. The SDK's own exponential backoff
would spend two slow attempts on a model id that is out of capacity before the
fallback id ever got a turn, and the contract says fallback logic lives in the
seam once. A deployment that wants resilience configures a fallback id.

### `openai-compatible` has no default model id and no price row

A compatible endpoint can be OpenRouter, Groq, Ollama, Mistral or a local
server, so there is no honest default id and no honest price. `resolveModel`
throws at resolve time when `LLM_MODEL_<ROLE>` is missing, and `costOf` books
zero through the `onUnpriced` hook until the deployment adds a registry row.
Guessing an id or a price would be worse than failing loudly.

### Relative imports carry the `.ts` extension

Deno requires it for relative specifiers, and every bundler in the stack
(webpack, turbopack, esbuild, vite) accepts it. `@dlusn/kit` is extensionless
because Metro resolves it, but this package has to satisfy Deno first.
`allowImportingTsExtensions` in `tsconfig.json` makes `tsc --noEmit` agree.

### `exactOptionalPropertyTypes` is off, the rest of strict is on

The AI SDK's public types are written without it, so turning it on produced a
dozen errors in glue code with no defect behind any of them.
`noUncheckedIndexedAccess` stays on, which is where the real value was.

### Structured output takes plain JSON Schema, not zod

`completeObject(req, schema)` wraps the schema with the SDK's `jsonSchema`
helper. Taking a zod schema would put a fifth runtime dependency in the
contract and in every consumer, for a type-inference convenience. Callers pass
the generic instead.

### `stream` opens eagerly so the fallback can still fire

A stream cannot be retried once bytes have left, so `stream` pulls the first
chunk inside the fallback wrapper. An out of capacity model fails before the
caller sees anything, and the fallback id gets its turn.

### Cache write tokens are read out of provider metadata in the adapter layer

`LlmResult.usage.cacheWrite` is part of the contract, but the AI SDK usage shape
carries cache reads only. `cacheWriteTokens` in `src/adapters/index.ts` reads
the vendor metadata key, so no call site and no metering code learns the vendor
field name.

### Speech errors are `LlmError` too

One error type across the package. A caller that already branches on `kind` and
`retryable` for text does the same for voice, and the speech seam did not need
its own hierarchy to say "429 from the transcription vendor".

### Registry defaults, and why they are only defaults

Tier ladders are cost ladders, identical in shape across vendors: `fast` is the
cheap small model, `standard` the workhorse, `best` the frontier model. Prices
are USD per million tokens, captured 25 Sep 2026. `LLM_MODEL_<ROLE>` always
wins, so a stale row costs a pricing correction, never a wrong model in
production.
