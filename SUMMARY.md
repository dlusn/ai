# A2: @dlusn/ai v0.2.0

Registry v0.2, an ordered fallback chain with fail fast timeouts and a circuit
breaker, the Vercel AI Gateway as a provider, cost metering in currency,
document capability rows, and an edge runtime boot proof.

Branch `agent/9d1996f0`, five commits on top of `ffeaaf7`. No consumer repo
touched. One runtime dependency added, `@ai-sdk/gateway`, as the card allows.

## What changed

### 1. Fallback chain per role

`LLM_MODELS_<ROLE>` takes an ordered comma list. Each entry is `provider/model`
or a bare `model` on `LLM_PROVIDER`, either one optionally followed by
`|baseURL`. `LLM_MODEL_<ROLE>` plus `LLM_FALLBACK_<ROLE>` still build the two
entry form and still mean bare ids on `LLM_PROVIDER`.

The pipe is what makes the home rig case work: a rig and the same model hosted
are both `openai-compatible` on different hosts, which no per provider base URL
can express.

```bash
LLM_MODELS_EXTRACT="openai-compatible/Qwen/Qwen3.6-27B|http://rig.local:8000/v1,openai-compatible/Qwen/Qwen3.6-27B|https://api.deepinfra.com/v1/openai"
```

The seam moves to the next target on a retryable `LlmError`, on a 404 on the
id, on no first byte inside `LLM_CONNECT_TIMEOUT_MS` (2000) and on the attempt
not finishing inside `LLM_TIMEOUT_MS` (30000). It stops on `bad_request` and
`auth`, which the next target would fail identically. Both timeouts are raced,
not only aborted: a host that accepts the socket and then says nothing never
rejects on its own.

A per target breaker opens after `LLM_BREAKER_FAILURES` (3) consecutive
failures for `LLM_BREAKER_MS` (120000) and half opens with one probe. In
memory, per isolate, no external state. Every hop and every breaker transition
emits one structured line through a swappable sink (`setLlmLogger`).

### 2. Vercel AI Gateway provider

Provider `gateway` via `@ai-sdk/gateway`, key `AI_GATEWAY_API_KEY`, model ids in
`vendor/model` form. `REGISTRY.gateway` is all nulls like `openai-compatible`,
so it can never be reached without naming the id: it is a target, never a
default. A vendor knob still reaches the vendor namespaced through the broker,
because `toProviderOptions` reads the vendor out of the `vendor/model` id and
reuses that vendor's branch. Gateway errors carry `statusCode` and `isRetryable`
but are not `APICallError`, so `toLlmError` duck types those two fields rather
than importing six error classes.

`vercel-gateway` is a row in the new provider capability table in the README.

### 3. Registry rows

`ROWS` is now a flat table and `REGISTRY` picks the three tier defaults out of
it, so a row can be priced, metered and pinnable without becoming a default.
Added, priced from the vendor pages on 25 Sep 2026 and dated in the file
header: `gpt-6-astra` (10 / 50, cached 1), `gpt-6-sol` (2 / 10, cached 0.2),
`gpt-6-luna` (0.1 / 0.5, cached 0.01), `gemini-3.8-flash` (0.75 / 3.75),
`gemini-3.1-pro-preview` (2 / 12), hosted `Qwen/Qwen3.6-27B` on DeepInfra FP8
(0.32 / 3.2, no cache discount), and three `gateway` rows. The v0.1 google
cache read prices were wrong against the current page and are corrected.

Every row carries `documents` (PDF or document parts accepted) and
`expectedCacheDiscount` (0 to 1). Cached tokens bill at the published cache
read price where there is one, and at the input price less the discount where
there is not, so a compatible endpoint with no prompt cache correctly books
cached tokens at full price rather than free. A test keeps the two numbers in
step on every row that has both. `usageToCost(provider, model, usage)` is
exported so a consumer meters in currency without holding an `LlmResult`.

**No tier default moved.** Promoting gpt-6 or gemini-3.x is an owner decision:
astra is eight times the flagship it would replace.

### 4. Structured output

`completeObject` is `generateText` with `Output.object`, not the deprecated
`generateObject`. On anthropic this still lands as a forced tool call, which is
that vendor's structured answer, so the contract shape is unchanged. One
fixture now goes through anthropic, openai-compatible, google, gateway and the
stub, all asserting the same parsed object and the same `LlmResult` shape.

### 5. Deno hygiene

All five runtime deps pinned to exact versions in `package.json`, `deno.json`
and the fixture import map. The pins are the newest release of each package
that has aged past Deno 2.9's 24 hour minimum dependency age gate, not
`minimumDependencyAge: 0`. This bit for real during the run: `@ai-sdk/gateway`
2.0.158 and `@ai-sdk/openai` 2.0.130 were both inside the window and `deno
check` refused them, so the pins are 2.0.157 and 2.0.129.
`npm run aged-pins` prints the candidates when bumping. The README documents
the policy and the `openai.chat()` rule for compatible endpoints.

### 6. Edge runtime boot proof

`fixtures/supabase/functions/seam/index.ts` is a deployable Supabase edge
function on the stub provider (no key, no cost) that runs `complete`,
`completeObject` and `costOf`. It is in `deno check` and in CI.

`npm run boot:proof` boots it in a real Deno process and puts one request
through it. Output from this run:

```
POST /seam -> 200
{
  "ok": true,
  "said": "boot probe",
  "label": "count",
  "object": {
    "label": "count",
    "confident": true
  },
  "provider": "stub",
  "model": "stub-fast",
  "usd": 0,
  "runtime": "deno"
}
```

**Supabase edge runtime container: separate pass.** The dispatch sandbox allows
`node`, `npm`, `npx`, `git` and `gh` only, so `supabase` and `docker` could not
be run here and I did not route around the allowlist. The commands are in the
README and in the fixture header; run them from `fixtures/supabase` on a
machine with Docker up. Per the card this does not block the merge. What the
Deno pass above does establish is that the package, all five AI SDK packages
and the gateway package import and execute outside Node.

## Files

New: `src/breaker.ts`, `src/log.ts`, `test/chain.test.ts`, `test/gateway.test.ts`,
`fixtures/supabase/functions/seam/index.ts`, `fixtures/supabase/functions/deno.json`,
`scripts/boot-proof.mjs`, `scripts/aged-pins.mjs`, `SUMMARY.md`.

Changed: `src/types.ts`, `src/registry.ts`, `src/core.ts`, `src/pricing.ts`,
`src/env.ts`, `src/index.ts`, `src/adapters/index.ts`, `test/env.ts`,
`test/registry.test.ts`, `test/pricing.test.ts`, `test/structured.test.ts`,
`package.json`, `package-lock.json`, `deno.json`, `deno.lock`,
`.github/workflows/ci.yml`, `README.md`, `AGENTS.md`, `PROGRESS.md`,
`DECISIONS.md`.

## Commits

```
88a0ea9 feat: registry v0.2, documents, cache discount and the v0.2 model rows
a0163a9 feat: fallback chain with fail fast timeouts and a circuit breaker
5c187d3 test: gateway contract test and one structured fixture through every adapter
379d631 build: pin exact aged AI SDK versions, add the gateway dep and the boot proof
(this commit) docs: README, AGENTS.md, PROGRESS.md, DECISIONS.md, SUMMARY.md and CI
```

## Verify

```bash
npm install
npm test            # no-emdash, no-vendor-leak, 82 vitest cases
npm run typecheck   # tsc --noEmit
npm run deno:check  # three fixtures, including the edge function
npm run boot:proof  # a real Deno process answers one request
```

All green on this branch. 82 tests, up from 54. No live network in any test.

## Acceptance

| Item | State |
|---|---|
| Dead primary base URL plus a stub fallback answers from the fallback under 2.5 s | pass, `test/chain.test.ts` measured 34 ms |
| Second call skips the primary under 50 ms with the breaker open | pass, same test |
| Gateway resolves `gateway` plus `anthropic/claude-sonnet-5` and passes the contract test on a mock fetch | pass, `test/gateway.test.ts` |
| A1 acceptance grep unchanged | pass, `src/registry.ts` only |
| No em or en dash in the diff | pass, zero across the whole diff from `ffeaaf7` |

One note on the first two rows. The card's wording has the breaker open on the
**second** call, which with the documented default of three consecutive
failures it would not. The test sets `LLM_BREAKER_FAILURES=1` to assert that
shape, and a second test proves the default: three fallback hops, then one
breaker open, then a skip on the fourth call. If the owner wants the default to
be 1 rather than 3, that is a one line change to `breakerThreshold()`.

## Not done, and why

- **Tier default bumps to gpt-6 or gemini-3.x.** Priced and pinnable, not
  promoted. Owner decision, it changes cost for every unpinned role.
- **Promptfoo eval gate.** The research verdict pairs it with the registry and
  it should land before any role is routed onto a new model. Its own card.
- **Streaming through the chain past the first byte.** A stream cannot be
  retried once bytes are out, so the chain still applies to opening the stream
  only. Unchanged from v0.1 and correct.
