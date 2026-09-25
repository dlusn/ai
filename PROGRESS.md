# PROGRESS

## v0.3.0, 25 Sep 2026: card A3 shipped

Closes the two silent failure gaps the L2 run found on cmd#47.

| Step | State |
|---|---|
| `LlmToolUsePart` and `LlmToolResultPart` on `LlmPart`, assistant text plus tool_use, user tool_result | done |
| `LlmResult.toolUses[].id`, the provider's call id or a generated one | done |
| `LlmChunk` tool chunks carry the same id, so a streamed loop replays too | done |
| `toModelMessages` maps both parts on every adapter, tool_result to its own tool role message | done |
| An orphaned `tool_result` throws `bad_request` before any network work | done |
| `isError` maps to the vendor error output, not to ordinary text | done |
| Stub echoes the newest tool_result it was handed, so a loop proves without a vendor key | done |
| Anthropic rows for fable-5-1, fable-5, opus-5, opus-4-8, opus-4-7, sonnet-4-6 | done |
| Unknown pair still meters zero, now logs `llm.unpriced` once per isolate | done |
| Contract test: one tool loop fixture through anthropic, openai, openai-compatible, google, gateway, stub | done |
| Tests: 101 vitest cases, no live network | done |
| Gates: `no-emdash`, `no-vendor-leak`, `tsc`, `deno check` | done |
| Two stale anthropic tier default prices found, left for the owner | open, see DECISIONS |

## v0.2.0, 25 Sep 2026: card A2 shipped

| Step | State |
|---|---|
| `LLM_MODELS_<ROLE>` ordered chain, two entry form still works | done |
| Fail fast: `LLM_CONNECT_TIMEOUT_MS` 2000, `LLM_TIMEOUT_MS` 30000, both raced | done |
| Per target circuit breaker, `LLM_BREAKER_FAILURES` 3, `LLM_BREAKER_MS` 120000, one half open probe | done |
| One structured line per hop and per breaker transition, sink swappable | done |
| `gateway` provider via `@ai-sdk/gateway`, `AI_GATEWAY_API_KEY`, never a default | done |
| `documents` and `expectedCacheDiscount` on every row | done |
| gpt-6-astra, gpt-6-sol, gpt-6-luna, gemini-3.8-flash, gemini-3.1-pro-preview, hosted Qwen3.6-27B, three gateway rows | done |
| `usageToCost` exported, cache discount applied to cached tokens | done |
| `completeObject` on `generateText` with `Output.object`, one fixture through every adapter | done |
| Exact aged pins, Deno minimum dependency age policy documented | done |
| Edge function fixture plus a Deno boot proof | done |
| Supabase edge runtime container boot proof | separate pass |
| Tests: 77 vitest cases, no live network | done |
| Gates: `no-emdash`, `no-vendor-leak`, `tsc`, `deno check` | done |

## v0.1.0, 25 Sep 2026: card A1 shipped

Everything in the A1 scope is built and gated.

| Step | State |
|---|---|
| Package, TS strict, ESM, exports map with four subpaths | done |
| Deno importable, verified by `deno check` in CI | done |
| Four runtime dependencies, exactly | done |
| `complete`, `stream`, `completeObject`, `LlmError` | done |
| Capacity fallback from `LLM_FALLBACK_<ROLE>`, once, in the seam | done |
| Registry with tiers, capabilities, prices, `resolveModel(role)` | done |
| Vendor specifics behind `providerOptions` in the adapter layer | done |
| `./stub` with fixtures and call recording | done |
| `./pricing` with `costOf` and `onUnpriced` | done |
| `./speech` with Deepgram, ElevenLabs, Cartesia and a stub | done |
| Tests: 54 vitest cases, no live network | done |
| Gates: `no-emdash`, `no-vendor-leak`, `tsc`, `deno check` | done |
| README, AGENTS.md, DECISIONS.md | done |

## v0.1.0, 25 Sep 2026: A1b, keyless openai-compatible

`resolveModel` no longer throws on a missing key when `LLM_PROVIDER=openai-compatible` and `LLM_BASE_URL` is set, so Ollama, LM Studio and vLLM run without one. `anthropic`, `openai` and `google` still throw at resolve time.

## Not in this card

- **Consumer swaps.** `cmd` and `body` move onto the package in later cards. No
  consumer repo was touched here, per the card rules.
- **Streaming speech.** `transcribe` is one shot. Deepgram and Cartesia both
  offer a websocket transcription stream, worth adding when a surface needs
  live captions rather than a finished clip.
- **Embeddings and reranking.** The AI SDK covers both. Nothing in the portfolio
  needs them yet, so they are not in the contract.
- **Gateway routing.** Wired in v0.2 as the `gateway` provider. It is a target,
  never a default, and no role points at it yet.
- **Promptfoo eval gate.** The research verdict pairs it with the registry.
  It belongs in its own card, ahead of routing any role onto a new model.
- **Tier default bumps.** gpt-6 and gemini-3.x rows are priced and pinnable, but
  no tier default moved. Promoting one is an owner decision.

## Next

1. Tag `v0.2.0` and pin `github:dlusn/ai#<sha>` in the consumer cards.
2. Run the Supabase edge runtime boot proof (`supabase start`, then
   `supabase functions serve seam` from `fixtures/supabase`) on a machine with
   Docker up, and paste the curl output into this file.
3. cmd L1: replace `lib/ai/llm.ts` with the package, move `lib/ai/models.ts`
   into `LLM_MODEL_<ROLE>` env, delete the local fallback in `_turn.ts`.
4. body L1: replace the seven raw `fetch` edge functions with roles.
5. Fold the ekoni ADR's role names in when it lands, if it adds any past the
   five in the contract.
