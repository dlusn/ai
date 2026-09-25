# A3: tool round trip in the contract, registry rows for the ids consumers pin

**@dlusn/ai v0.3.0, branch `agent/4d8b11da`, sha `1aad165b6eaa17b2dc05bb347d2207ae5f1362f5`.**
cmd#47 and body#114 re-pin to the merge sha on `main`, which is this branch's
four commits on top of `f554690`.

## What changed

**1. Tool round trip in the contract.** `LlmPart` gains `LlmToolUsePart`
(`{ type: 'tool_use'; id; name; input }`) and `LlmToolResultPart`
(`{ type: 'tool_result'; toolUseId; content; isError? }`). `LlmResult.toolUses`
gains `id`: the provider's own call id where it has one, a generated one where
it does not, stable inside one result. `LlmChunk` tool chunks carry the same id,
so a streamed loop replays as well as a buffered one.

`toModelMessages` maps both on every adapter, stub and openai-compatible
included. A `tool_use` becomes a `tool-call` part on the assistant turn. A
`tool_result` becomes a `tool` role message of its own, emitted before anything
else the caller said on that turn, so one contract turn can become two AI SDK
messages. That is the only place the mapping is not one to one.

Two silent failures are now loud:

- a `tool_result` whose `toolUseId` matches no earlier `tool_use` throws
  `bad_request` before any network work, instead of the turn vanishing
- `isError: true` maps to the vendor's error output, instead of a failure being
  passed off as an ordinary answer

Nothing existing changes shape. A text only assistant turn is still joined to a
plain string, exactly the v0.2 wire body, and a caller that never sends a tool
part is untouched.

**2. Stub round trips.** The stub appends `tool_result <id>: <content>` to its
fixture text whenever a result is in the conversation, so a full loop is
provable with no vendor key. A `toolUses` fixture entry may omit `id`; the stub
numbers them `stub_tool_1` and up.

**3. Registry rows.** Six anthropic rows added, all from `grep` over
`dlusn/cmd/lib/ai/{models,pricing}.ts` and `dlusn/body/supabase/functions`:

| id | pinned by | in, out, cache read, cache write (USD per M) |
|---|---|---|
| `claude-fable-5-1` | cmd chat | 10, 50, 0.25, 12.5 |
| `claude-opus-5` | cmd draft and chat fallback | 5, 25, 0.5, 6.25 |
| `claude-sonnet-4-6` | cmd vision, extract, triage | 3, 15, 0.3, 3.75 |
| `claude-fable-5` | cmd historical rows | 10, 50, 1, 12.5 |
| `claude-opus-4-8` | cmd historical rows | 5, 25, 0.5, 6.25 |
| `claude-opus-4-7` | cmd historical rows | 5, 25, 0.5, 6.25 |

Body pins `claude-haiku-4-5` and `claude-sonnet-5`, both of which already had
rows. Prices read 25 Sep 2026 from `claude.com/pricing` and from
`platform.claude.com/docs/en/about-claude/pricing`, which agree; the date and
both URLs are in the header comment in `src/registry.ts`. Cache reads are
0.025x input on fable 5.1 and 0.1x on the rest, so `expectedCacheDiscount` is
0.975 on that row and 0.9 on the others. None of these is a tier default, so no
unpinned role moves.

An unknown pair still meters zero, and now also writes
`{"event":"llm.unpriced","target":"provider/model"}` to `console.warn`, once per
isolate on its own dedupe set. It is not on `setLlmLogger`: `LlmLogEvent`
requires a `role`, and an unpriced pair has none.

**4. Contract test.** `test/tool-loop.test.ts`, 15 cases. One loop fixture
(assistant `tool_use`, user `tool_result`, second assistant turn) runs through
anthropic, openai, openai-compatible, google, gateway and stub with recorded
bodies and no network, asserting the call id, the tool name and the result text
all reach the vendor request body. A second recorded reply per adapter proves
`toolUses[].id` on each.

## Files

- `src/types.ts`: the two new parts, `toolUses[].id`, the tool chunk id
- `src/adapters/index.ts`: `toModelMessages` rewritten, plus `toUserPart`,
  `toAssistantPart`, `toToolOutput`, `toolNamesById`
- `src/adapters/stub.ts`: the echo, optional fixture ids
- `src/core.ts`: `toolCallId` read into `toolUses` and into the stream chunk
- `src/registry.ts`: six rows, dated price sources
- `src/pricing.ts`: `warnUnpriced`
- `test/tool-loop.test.ts`, `test/recorded.ts`, `test/pricing.test.ts`,
  `fixtures/deno-check.ts`
- `README.md`, `PROGRESS.md`, `DECISIONS.md`, `package.json` (0.3.0)

## Verify

```
npm ci
npm test                 # no-emdash clean, no-vendor-leak clean, 101 passed
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json   # exit 0
npm run deno:check       # all three fixtures check
```

All four green on `1aad165`. No live network in any test. No consumer repo
touched, no new runtime dependency, five deps still.

## Two things the owner should see

**1. Two anthropic tier default prices are stale, and I left them alone.** Both
vendor pages, read today, put **Sonnet 5 at $2 in and $10 out** (cache read
0.20, cache write 2.50) and **Opus 5.5 at $4 in and $20 out** (cache read 0.20,
cache write 5). `ROWS` says 3/15 and 5/25. Both are tier defaults: `sonnet-5` is
anthropic `standard` (draft, vision) and `opus-5-5` is anthropic `best` (chat).
So today the seam over bills Sonnet 5 by 50 percent and Opus 5.5 by 25 percent.

I did not change them. Correcting a tier default's price moves what every
unpinned role costs and rewrites `test/pricing.test.ts`, which this card's
acceptance pins as unchanged. `dlusn/cmd/lib/ai/pricing.ts` already has Sonnet 5
at 2/10, so cmd and the seam currently disagree. One small follow up card fixes
both rows and the four assertions that read them.

**2. Two existing things had to move, both one line.**
`test/structured.test.ts:206` asserted the old `toolUses` shape, so it gained the
`id` the card adds. `fixtures/supabase/config.toml` carried two en dashes in
generated comments and was failing the repo dash gate before this card; they are
now colons.

## Not done

- **Dated model aliases.** cmd maps `claude-sonnet-4-6-20260101` and three
  siblings back to the undated id before pricing. The seam never sees a dated
  id, because `LlmResult.model` is the id we asked for, not the one the vendor
  echoed. If that ever changes, the registry needs aliases too. Nothing to do
  today.
- **Anthropic context windows.** The vendor page says Claude 4.6 and later carry
  the full 1M window; every anthropic row here, new and old, says 200k. It is a
  capability hint, not pricing, and re-deriving it for the whole table is a
  different card. Same follow up as the prices above.
- **Supabase edge runtime boot proof.** Not re-run: the card scopes it to a
  `toModelMessages` file move, and no file moved. `npm run deno:check` covers
  the importability, and the deno fixture now runs a tool loop.
