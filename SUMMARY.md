# SUMMARY: effort low by default on 5.x (0.4.2)

## What changed
- Anthropic branch of `toProviderOptions` (gateway reuses it) sends `effort: 'low'` when the caller did not ask for thinking. With `thinking` set, effort is left at the vendor default. Never sends `thinking: disabled` or `budget_tokens` unasked.
- `LlmRequest.effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'` overrides the default. Anthropic only.
- New optional capability `effort` (absent = no), true on fable-5-1, opus-5-5, sonnet-5-5 and the gateway sonnet row. Needed because haiku-4-5 shares the anthropic caps with `thinking: true` (it does support thinking, so flipping that flag would have broken opt-in thinking there). Haiku gets no effort field.
- README paragraph, PROGRESS.md, DECISIONS.md, version 0.4.2.

## Files
`src/types.ts`, `src/registry.ts`, `src/adapters/index.ts`, `test/effort.test.ts` (new), `test/gateway.test.ts` and `test/registry.test.ts` (expectations updated), `README.md`, `PROGRESS.md`, `DECISIONS.md`, `package.json`.

## Verify
- `npx tsc --noEmit -p tsconfig.json`: exit 0
- `npm test`: 119 passed (dash gate and vendor-leak gate clean)
- `npm run deno:check`: green
- Tests assert the wire body: direct `output_config.effort`, gateway `providerOptions.anthropic.effort`; low by default, none with `thinking: true`, `high` on override, nothing on haiku.

## Open (Onyx)
cmd + body re-vendor cards, then review Body `maxTokens` caps against measured usage. No migrations, no live calls.
