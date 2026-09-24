# SUMMARY: A1, @dlusn/ai v0.1.0

Card A1 is complete. `@dlusn/ai` v0.1.0 is the one LLM-agnostic seam DLUSN and
ekoni both consume, built on Vercel AI SDK core, with text, vision, structured
output, speech, a stub and pricing.

## What changed

New repo content on `agent/f40e7ea3`, starting from the bare skeleton. No
consumer repo was touched, per the card rules.

### The seam

| File | What it does |
|---|---|
| `src/types.ts` | The contract. `LlmRole`, `LlmRequest`, `LlmResult`, `LlmChunk`, `LlmCapabilities`, `LlmPrice`, `ResolvedModel`. Byte compatible with `docs/llm-agnostic.md`. |
| `src/errors.ts` | `LlmError` with `kind`, `status`, `provider`, `retryable`, plus the status to kind map and the capacity failure test. |
| `src/env.ts` | Runtime neutral env read: `Deno.env.get` first, then `process.env`. No Node only API. |
| `src/registry.ts` | Tiers `fast`, `standard`, `best` for anthropic, openai, google and stub, each row with `capabilities` (vision, tools, structuredOutput, caching, thinking, contextTokens, maxOutput) and `price` (input, output, cacheRead, cacheWrite) in USD per million tokens. `resolveModel(role)` reads `LLM_PROVIDER`, `LLM_API_KEY` with the three vendor fallbacks, `LLM_MODEL_<ROLE>`, `LLM_FALLBACK_<ROLE>`, `LLM_BASE_URL`. Unknown role, unknown provider, missing key and missing compatible model id all throw at resolve time. |
| `src/core.ts` | `complete`, `stream`, `completeObject`. The capacity fallback (429, 503, 529, 404 on the id) is handled once here. |
| `src/adapters/index.ts` | The only file importing a vendor SDK. Model construction, message and image part conversion, tool conversion, `providerOptions` translation for caching, thinking, effort and JSON mode, cache write token extraction, and error mapping. |
| `src/adapters/stub.ts` | Fixture per role, call recording, no network. |
| `src/stub.ts` | The `./stub` surface: `setStubFixtures`, `stubCalls`, `resetStub`, plus the speech equivalents. |
| `src/pricing.ts` | `costOf`, `costBreakdown`, `priceFor`. An unpriced pair books zero and calls `onUnpriced`, never throws. |
| `src/speech/*` | `transcribe` and `synthesize` over Deepgram, ElevenLabs and Cartesia, chosen by `SPEECH_STT_PROVIDER` and `SPEECH_TTS_PROVIDER`, plus a stub. Deepgram keyterms and ElevenLabs and Cartesia voice ids are opts, never constants. |

### Fixtures, tests, gates and docs

- `fixtures/next-route.ts`, `fixtures/edge-function.ts`, `fixtures/deno-check.ts`
- `test/` 54 vitest cases across 7 files, all on recorded vendor responses
- `scripts/no-emdash.mjs`, `scripts/no-vendor-leak.mjs`
- `deno.json`, `.github/workflows/ci.yml`
- `README.md`, `AGENTS.md`, `CLAUDE.md`, `DECISIONS.md`, `PROGRESS.md`

## Commits

| SHA | Subject |
|---|---|
| `74e014b` | feat: @dlusn/ai v0.1, the LLM-agnostic seam |
| `88f2888` | docs: README, AGENTS.md, DECISIONS.md, PROGRESS.md and CI |

## Verify

### `npm test` (no-emdash gate, no-vendor-leak gate, vitest)

```
$ npm test
no-emdash: clean.
no-vendor-leak: clean.

 RUN  v3.2.7

 v test/pricing.test.ts (8 tests) 2ms
 v test/registry.test.ts (15 tests) 6ms
 v test/speech.test.ts (10 tests) 7ms
 v test/fixtures.test.ts (4 tests) 27ms
 v test/structured.test.ts (5 tests) 62ms
 v test/result-shape.test.ts (5 tests) 66ms
 v test/fallback.test.ts (7 tests) 69ms

 Test Files  7 passed (7)
      Tests  54 passed (54)
```

### `tsc --noEmit`

```
$ npx tsc --noEmit
(no output, exit 0)
```

### `deno check` on the fixtures

```
$ deno check --config deno.json fixtures/deno-check.ts fixtures/edge-function.ts
Check fixtures/deno-check.ts
Check fixtures/edge-function.ts
(0 errors)
```

Run locally through `npx deno@2` (deno 2.9.6). CI runs it through
`denoland/setup-deno@v2`.

### Acceptance grep

```
$ grep -rn "api.anthropic.com\|@anthropic-ai\|claude-\|gpt-\|gemini-" src
src/registry.ts:41:      model: 'claude-haiku-4-5',
src/registry.ts:47:      model: 'claude-sonnet-5',
src/registry.ts:53:      model: 'claude-opus-5-5',
src/registry.ts:61:      model: 'gpt-5-nano',
src/registry.ts:67:      model: 'gpt-5-mini',
src/registry.ts:73:      model: 'gpt-5',
src/registry.ts:81:      model: 'gemini-2.5-flash-lite',
src/registry.ts:87:      model: 'gemini-2.5-flash',
src/registry.ts:93:      model: 'gemini-2.5-pro',
```

`registry.ts` only, which is inside the allowed set (registry plus the adapter
files). `npm run no-vendor-leak` enforces this on every run, so a future card
cannot quietly leak an id into a feature file.

### Both consumer fixtures on the stub, no vendor key

`test/fixtures.test.ts` clears `LLM_API_KEY`, `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY` and `GOOGLE_API_KEY`, replaces `globalThis.fetch` with a
function that throws on any call, and runs the Next route handler and the edge
function handler. Both return 200 with stub answers, and the network is never
touched. 4 cases, all passing.

### Dashes

Zero em or en dash characters in the branch diff, checked over the full diff and
not just the gated globs:

```
$ git diff 47594bb..HEAD -- . ':(exclude)package-lock.json' ':(exclude)deno.lock' | node -e "...scan..."
dash lines in diff: 0
```

### Runtime smoke, plain Node, no vendor key

This is a library, so there is no dev server to click through. The equivalent
evidence is a real run outside the test runner:

```
$ node --input-type=module -e "...LLM_PROVIDER=stub, no vendor keys..."
resolve: {"role":"chat","tier":"best","provider":"stub","model":"stub-best",...}
result: {"text":"smoke ok","toolUses":[],"stopReason":"end","usage":{...},"provider":"stub","model":"stub-best"}
cost usd: 0
stt: nineteen at Tuggerah
recorded calls: 1
bad role -> LlmError bad_request
```

No console errors or warnings.

## Decisions worth the owner's attention

Full list in `DECISIONS.md`. Three that change behaviour:

1. **The seam owns the retry policy.** `maxRetries: 0` on every SDK call, and
   the seam does exactly one retry: the fallback to `LLM_FALLBACK_<ROLE>`. The
   SDK's own backoff would burn two slow attempts on an out of capacity model id
   before the fallback got a turn, and the contract puts the fallback in the
   seam once. A deployment that wants resilience sets a fallback id. If you
   would rather keep the SDK's backoff as well, that is a one line change.
2. **`openai-compatible` has no default model id and no price row.** A
   compatible endpoint can be OpenRouter, Groq, Ollama or a local server, so
   `LLM_MODEL_<ROLE>` is required and `resolveModel` throws without it, and cost
   books zero through `onUnpriced` until a registry row exists. Guessing would
   have been worse than failing loudly.
3. **Structured output takes plain JSON Schema, not zod.** A zod schema would
   have put a fifth runtime dependency into the contract and into every
   consumer, and the card fixes the dependency list at four.

## Gaps and things deliberately not done

- **The ekoni ADR was never pasted on the issue.** The card says the ADR wins on
  role names and DB columns where it disagrees with the contract. It was not
  available during this run, so the five roles come from the contract (`chat`,
  `draft`, `vision`, `extract`, `triage`) and the capability field names come
  from the card body, which quotes the ADR. If the ADR adds a role, the steps
  are in `AGENTS.md` under "Adding a role" and it is a three file change.
- **Registry prices are a snapshot, 25 Sep 2026.** They are defaults, and
  `LLM_MODEL_<ROLE>` always wins, so a stale row is a pricing correction and
  never a wrong model in production. Worth a check before the first metering
  card goes live.
- **No consumer repo changes**, per the card rules. cmd and body swap in later.
- **No migration**, no database work, nothing deployed in this card.
- **Streaming speech is not implemented.** `transcribe` is one shot. Deepgram
  and Cartesia both offer websocket transcription, worth adding when a surface
  needs live captions.
- **`npm run typecheck` uses `tsc` from devDependencies.** `exactOptionalPropertyTypes`
  is off because the AI SDK's public types are not written for it. The rest of
  strict, including `noUncheckedIndexedAccess`, is on.
