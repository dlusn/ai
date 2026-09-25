# PROGRESS

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
- **Gateway routing.** `@ai-sdk/gateway` arrives as a transitive dependency of
  `ai` and is not wired up. If model routing ever moves to a gateway it becomes
  another provider branch, not a rewrite.

## Next

1. Tag `v0.1.0` and pin `github:dlusn/ai#<sha>` in the consumer cards.
2. cmd L1: replace `lib/ai/llm.ts` with the package, move `lib/ai/models.ts`
   into `LLM_MODEL_<ROLE>` env, delete the local fallback in `_turn.ts`.
3. body L1: replace the seven raw `fetch` edge functions with roles.
4. Fold the ekoni ADR's role names in when it lands, if it adds any past the
   five in the contract.
