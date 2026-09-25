# DECISIONS

Living record. Newest first.

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
