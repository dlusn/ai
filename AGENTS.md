# AGENTS.md

Canonical instruction file for this repo. `CLAUDE.md` points here.

## What this repo is

`@dlusn/ai`, the one LLM-agnostic seam DLUSN and ekoni both consume. Owner rule,
25 Sep 2026: no product or ops code talks to a model vendor directly.

**Read the contract before changing anything here:**
<https://github.com/dlusn/ceo/blob/main/docs/llm-agnostic.md>

Every type name, env var name and error kind comes from that file. The ekoni ADR
(`docs/adr/0001-llm-agnostic-seam.md` in `ekoni/app`) is the design record. Where
the two disagree, the ADR wins on role names and DB columns, the contract wins on
the `LlmResult` and `LlmError` shape.

## Hard rules

1. **Four runtime dependencies, exactly**: `ai`, `@ai-sdk/anthropic`,
   `@ai-sdk/openai`, `@ai-sdk/google`. Adding a fifth is an owner decision.
2. **No vendor leak.** A vendor host, a vendor SDK name or a vendor model id may
   appear in `src/registry.ts`, `src/adapters/` and the three speech adapter
   files. Nowhere else. `npm run no-vendor-leak` enforces it.
3. **No Node only API in `src`.** Edge functions import this package. Use
   `fetch`, `FormData`, `Blob`, `URL` and the env helper in `src/env.ts`.
   `deno check` on the fixtures enforces it in CI.
4. **Call sites never see `providerOptions`.** Caching, thinking, effort, JSON
   mode and tool choice are request flags the adapter layer translates.
5. **Relative imports carry the `.ts` extension.** Deno needs it, every bundler
   accepts it.
6. **No live network in tests.** Record the vendor response into
   `test/recorded.ts` and swap `globalThis.fetch`.
7. **No em dashes or en dashes**, anywhere. `npm run no-emdash` enforces it.

## Adding a provider

1. A registry row per tier in `src/registry.ts` with real capabilities and real
   prices in USD per million tokens.
2. A branch in `languageModel` and in `toProviderOptions` in
   `src/adapters/index.ts`.
3. The key name in `KEY_FALLBACKS`.
4. A recorded response and a case in `test/result-shape.test.ts`, asserting the
   same `LlmResult` shape as every other adapter.

## Adding a role

1. Add it to `LlmRole` and `LLM_ROLES` in `src/types.ts`.
2. Give it a tier in `ROLE_TIERS` in `src/registry.ts`.
3. Add it to the resolve matrix in `test/registry.test.ts` and to the managed
   list in `test/env.ts`.

## Verify

```bash
npm test
npm run typecheck
deno check --config deno.json fixtures/deno-check.ts fixtures/edge-function.ts
```
