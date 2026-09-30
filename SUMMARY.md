# SUMMARY: complete() no longer uses the first-byte budget (0.4.1)

## What changed
- `baseCallOptions` takes an optional `connectMs`. `complete` and `completeObject` pass nothing, so `languageModel` builds no `connectTimeoutFetch`. Only `LLM_TIMEOUT_MS` bounds them (the chain race in `runChain`).
- `stream` passes `resolved.connectTimeoutMs`, so the first-byte race is unchanged there.
- README: `LLM_CONNECT_TIMEOUT_MS` documented as streaming only.
- `package.json` 0.4.1, PROGRESS.md and DECISIONS.md entries.

## Files
`src/core.ts`, `README.md`, `package.json`, `PROGRESS.md`, `DECISIONS.md`, `test/connect-budget.test.ts` (new), `test/chain.test.ts`.

## Tests
- New: `complete` on a fake fetch answering at 3x `LLM_CONNECT_TIMEOUT_MS` resolves; `complete` past `LLM_TIMEOUT_MS` rejects `unavailable`; `stream` with no first byte rejects `unavailable`.
- `test/chain.test.ts` "never sends a first byte" case drove `complete` with the connect budget, which is the bug. It now uses `LLM_TIMEOUT_MS` for the same failover assertion.

## Verify
`npm test` 110/110 green (dash and vendor-leak gates clean), `npm run typecheck` clean, `npm run deno:check` clean.

## After merge (Onyx)
cmd and body re-vendor (dep sha bump), then drop the `LLM_CONNECT_TIMEOUT_MS=25000` secret on body. No migrations. No UI, so no dev server or mockup version.
