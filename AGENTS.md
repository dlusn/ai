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

1. **Five runtime dependencies, exactly**: `ai`, `@ai-sdk/anthropic`,
   `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/gateway`. Adding a sixth is an
   owner decision. All five are pinned to an exact version that has aged past
   Deno's 24 hour minimum dependency age gate: `npm run aged-pins` when bumping,
   never `"minimumDependencyAge": 0`.
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

1. A row in `ROWS` in `src/registry.ts` with real capabilities and real prices
   in USD per million tokens, and the vendor page date in the header comment.
   Wire it into `REGISTRY` only if it should be a tier default.
2. A branch in `languageModel` and in `toProviderOptions` in
   `src/adapters/index.ts`.
3. The provider name in `PROVIDERS` and the key name in `KEY_FALLBACKS`.
4. A recorded response and a case in `test/result-shape.test.ts`, asserting the
   same `LlmResult` shape as every other adapter.

## Adding a model row

A row is not a tier default. Add it to `ROWS` with `documents` and
`expectedCacheDiscount` filled in honestly (0 when the vendor publishes no
cache discount). Moving a tier default in `REGISTRY` is an owner decision,
because it changes what every unpinned role runs and what it costs.

## Adding a role

1. Add it to `LlmRole` and `LLM_ROLES` in `src/types.ts`.
2. Give it a tier in `ROLE_TIERS` in `src/registry.ts`.
3. Add it to the resolve matrix in `test/registry.test.ts` and to the managed
   list in `test/env.ts`.

## Verify

```bash
npm test
npm run typecheck
npm run deno:check
npm run boot:proof
```
