# SUMMARY: v0.4.0, Sonnet 5.5 pin and forced tool_choice downgrade

## Changed
- Registry: `claude-sonnet-5` is now `claude-sonnet-5-5` (anthropic row and `anthropic/claude-sonnet-5-5` gateway row, 1M context, 128K max output). `standard` tier picks it. Anthropic rows are exactly fable-5-1, opus-5-5, sonnet-5-5, haiku-4-5.
- New optional capability `forcedToolChoice` (absent means supported). Set `false` on fable-5-1, opus-5-5, sonnet-5-5 and the gateway sonnet row.
- `toToolChoice` sends `auto` for `{ name }` and `required` when the row lacks it; `baseCallOptions` appends one system line ("Answer by calling the <name> tool." or "Answer by calling one of the provided tools."). Applies to `complete` and `stream`. Haiku, other vendors and unknown models keep the forced choice.
- `thinking: { type: 'disabled' }` is never sent: only `enabled`, only on request. Confirmed by reading `toProviderOptions`; the new test asserts `thinking` is absent.
- `package.json` and lockfile at 0.4.0, PROGRESS.md and DECISIONS.md entries, README ids updated.

## Files
`src/registry.ts`, `src/types.ts`, `src/adapters/index.ts`, `src/core.ts`, `test/forced-tool-choice.test.ts` (new), `test/registry.test.ts`, other tests and `fixtures/deno-check.ts` (id rename), `README.md`, `package.json`, `package-lock.json`, `PROGRESS.md`, `DECISIONS.md`.

## Verify (all run here)
`npm test` 107 pass (includes no-emdash and no-vendor-leak gates), `npm run typecheck` clean, `npm run deno:check` clean. `boot:proof` not run.

## Gap
`completeObject` on anthropic still goes through the AI SDK's own structured output path, which the existing test describes as a forced tool call. The seam does not control that `tool_choice`, so it may still 400 on 5.x models. Not in this card's scope; needs a live check against sonnet-5-5 and probably its own card.

No migrations. Consumer re-vendors (cmd, body) are separate cards.
