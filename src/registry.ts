// The only file besides the adapters that is allowed to name a vendor model id.
// Prices are USD per million tokens, one currency for the whole table.
// Anything here is a default: LLM_MODELS_<ROLE> and LLM_MODEL_<ROLE> always win.
//
// Prices read from the vendor pricing pages on 25 Sep 2026:
//   anthropic  https://www.anthropic.com/pricing
//   openai     https://developers.openai.com/api/docs/pricing
//   google     https://ai.google.dev/gemini-api/docs/pricing
//   qwen3      https://artificialanalysis.ai/models/qwen3-6-27b/providers (DeepInfra FP8)
// Re-read them before trusting a number older than a quarter.

import { env, envFirst, envNumber } from './env.ts';
import { LlmError } from './errors.ts';
import {
  LLM_ROLES,
  type LlmCapabilities,
  type LlmProvider,
  type LlmRole,
  type LlmTarget,
  type LlmTier,
  type RegistryRow,
  type ResolvedModel,
} from './types.ts';

/** Which cost tier each task role runs on by default. */
export const ROLE_TIERS: Record<LlmRole, LlmTier> = {
  chat: 'best',
  draft: 'standard',
  vision: 'standard',
  extract: 'fast',
  triage: 'fast',
};

function caps(
  partial: Partial<LlmCapabilities> & Pick<LlmCapabilities, 'contextTokens' | 'maxOutput'>,
): LlmCapabilities {
  return {
    vision: true,
    documents: false,
    tools: true,
    structuredOutput: true,
    caching: false,
    thinking: false,
    ...partial,
  };
}

function row(
  provider: LlmProvider,
  model: string,
  price: RegistryRow['price'],
  capabilities: LlmCapabilities,
  expectedCacheDiscount: number,
): RegistryRow {
  return { provider, model, capabilities, price, expectedCacheDiscount };
}

const ZERO_PRICE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

// Anthropic: full context, prompt caching, extended thinking, PDF document
// blocks. Cached reads are a tenth of input, cache writes are 1.25x.
const ANTHROPIC_CAPS = caps({
  documents: true,
  caching: true,
  thinking: true,
  contextTokens: 200_000,
  maxOutput: 64_000,
});

// GPT-5 and GPT-6: 400k and 1.05M context, automatic prompt caching at a tenth
// of input, reasoning effort, image input, PDF input through the files API.
const OPENAI_5_CAPS = caps({
  documents: true,
  caching: true,
  thinking: true,
  contextTokens: 400_000,
  maxOutput: 128_000,
});
const OPENAI_6_CAPS = caps({
  documents: true,
  caching: true,
  thinking: true,
  contextTokens: 1_050_000,
  maxOutput: 128_000,
});

const GEMINI_CAPS = caps({
  documents: true,
  caching: true,
  thinking: true,
  contextTokens: 1_000_000,
  maxOutput: 64_000,
});

/**
 * Every row the registry knows, flat. The tier map below picks the defaults out
 * of it. A row that is not a tier default is still priced and still carries
 * capabilities, so pinning it through LLM_MODEL_<ROLE> meters correctly.
 */
export const ROWS: readonly RegistryRow[] = [
  // Anthropic.
  row('anthropic', 'claude-haiku-4-5', { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 }, ANTHROPIC_CAPS, 0.9),
  row('anthropic', 'claude-sonnet-5', { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, ANTHROPIC_CAPS, 0.9),
  row('anthropic', 'claude-opus-5-5', { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, ANTHROPIC_CAPS, 0.9),

  // Anthropic ids a DLUSN consumer pins today but no tier defaults to, so an
  // unpinned role never lands here. cmd runs fable 5.1 for chat, opus 5 for
  // draft and sonnet 4.6 for vision, extract and triage; the rest are here so a
  // stored usage row from an older message still prices instead of metering
  // zero and quietly turning a daily spend cap into a no-op.
  //
  // Prices read 25 Sep 2026 from claude.com/pricing and from
  // platform.claude.com/docs/en/about-claude/pricing, which agree. Cache reads
  // are 0.025x input on fable 5.1 and 0.1x on the rest, which is why the
  // expected discount below is not one number for the whole vendor.
  row('anthropic', 'claude-fable-5-1', { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 }, ANTHROPIC_CAPS, 0.975),
  row('anthropic', 'claude-fable-5', { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 }, ANTHROPIC_CAPS, 0.9),
  row('anthropic', 'claude-opus-5', { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, ANTHROPIC_CAPS, 0.9),
  row('anthropic', 'claude-opus-4-8', { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, ANTHROPIC_CAPS, 0.9),
  row('anthropic', 'claude-opus-4-7', { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 }, ANTHROPIC_CAPS, 0.9),
  row('anthropic', 'claude-sonnet-4-6', { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, ANTHROPIC_CAPS, 0.9),

  // OpenAI GPT-5, still the tier defaults.
  row('openai', 'gpt-5-nano', { input: 0.05, output: 0.4, cacheRead: 0.005, cacheWrite: 0 }, OPENAI_5_CAPS, 0.9),
  row('openai', 'gpt-5-mini', { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 }, OPENAI_5_CAPS, 0.9),
  row('openai', 'gpt-5', { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 }, OPENAI_5_CAPS, 0.9),

  // OpenAI GPT-6, priced and ready to pin. Promoting one of these to a tier
  // default is an owner decision, not a package decision: astra is eight times
  // the flagship it would replace.
  row('openai', 'gpt-6-luna', { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0 }, OPENAI_6_CAPS, 0.9),
  row('openai', 'gpt-6-sol', { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 0 }, OPENAI_6_CAPS, 0.9),
  row('openai', 'gpt-6-astra', { input: 10, output: 50, cacheRead: 1, cacheWrite: 0 }, OPENAI_6_CAPS, 0.9),

  // Google. The 2.5 rows are the tier defaults, 3.8 flash is the current flash.
  row('google', 'gemini-2.5-flash-lite', { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0 }, caps({ documents: true, caching: true, contextTokens: 1_000_000, maxOutput: 64_000 }), 0.9),
  row('google', 'gemini-2.5-flash', { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 }, GEMINI_CAPS, 0.9),
  row('google', 'gemini-2.5-pro', { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 }, GEMINI_CAPS, 0.9),
  // Under 200k of context. Over 200k the page doubles input and lifts output,
  // which the flat table cannot express, so long context books low here.
  row('google', 'gemini-3.8-flash', { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 }, GEMINI_CAPS, 0.9),
  row('google', 'gemini-3.1-pro-preview', { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 }, GEMINI_CAPS, 0.9),

  // Qwen3 hosted, the fallback half of a home rig pair. DeepInfra FP8, no
  // prompt cache discount published, so a cached token bills at full input.
  row('openai-compatible', 'Qwen/Qwen3.6-27B', { input: 0.32, output: 3.2, cacheRead: 0, cacheWrite: 0 }, caps({ vision: false, contextTokens: 262_000, maxOutput: 32_000 }), 0),

  // Vercel AI Gateway. Model ids are vendor/model. The gateway bills the
  // vendor list price through, so these mirror the direct rows. Document input
  // is not brokered, so it books false whatever the vendor supports.
  row('gateway', 'anthropic/claude-sonnet-5', { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, caps({ caching: true, thinking: true, contextTokens: 200_000, maxOutput: 64_000 }), 0.9),
  row('gateway', 'openai/gpt-6-sol', { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 0 }, caps({ caching: true, thinking: true, contextTokens: 1_050_000, maxOutput: 128_000 }), 0.9),
  row('gateway', 'google/gemini-3.8-flash', { input: 0.75, output: 3.75, cacheRead: 0.075, cacheWrite: 0 }, caps({ caching: true, thinking: true, contextTokens: 1_000_000, maxOutput: 64_000 }), 0.9),

  // The stub. Free, and it says so, so no verify run books a cent.
  row('stub', 'stub-fast', ZERO_PRICE, caps({ contextTokens: 200_000, maxOutput: 8_192 }), 0),
  row('stub', 'stub-standard', ZERO_PRICE, caps({ contextTokens: 200_000, maxOutput: 8_192 }), 0),
  row('stub', 'stub-best', ZERO_PRICE, caps({ contextTokens: 200_000, maxOutput: 8_192 }), 0),
];

function pick(provider: LlmProvider, model: string): RegistryRow {
  const found = ROWS.find((candidate) => candidate.provider === provider && candidate.model === model);
  if (!found) throw new Error(`registry: no row for ${provider}/${model}`);
  return found;
}

/** Tier defaults. A null tier means the deployment must name the model id. */
export const REGISTRY: Record<LlmProvider, Record<LlmTier, RegistryRow | null>> = {
  anthropic: {
    fast: pick('anthropic', 'claude-haiku-4-5'),
    standard: pick('anthropic', 'claude-sonnet-5'),
    best: pick('anthropic', 'claude-opus-5-5'),
  },
  openai: {
    fast: pick('openai', 'gpt-5-nano'),
    standard: pick('openai', 'gpt-5-mini'),
    best: pick('openai', 'gpt-5'),
  },
  google: {
    fast: pick('google', 'gemini-2.5-flash-lite'),
    standard: pick('google', 'gemini-2.5-flash'),
    best: pick('google', 'gemini-2.5-pro'),
  },
  // A compatible endpoint can be anything, so there is no honest default id.
  'openai-compatible': { fast: null, standard: null, best: null },
  // The gateway is a target, never a default. Naming it means naming the id.
  gateway: { fast: null, standard: null, best: null },
  stub: {
    fast: pick('stub', 'stub-fast'),
    standard: pick('stub', 'stub-standard'),
    best: pick('stub', 'stub-best'),
  },
};

const PROVIDERS: readonly LlmProvider[] = [
  'anthropic',
  'openai',
  'openai-compatible',
  'google',
  'gateway',
  'stub',
];

const KEY_FALLBACKS: Partial<Record<LlmProvider, string[]>> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  'openai-compatible': ['OPENAI_API_KEY'],
  google: ['GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
  gateway: ['AI_GATEWAY_API_KEY'],
};

export function currentProvider(): LlmProvider {
  const raw = env('LLM_PROVIDER') ?? 'anthropic';
  if (!PROVIDERS.includes(raw as LlmProvider)) {
    throw new LlmError(`Unknown LLM_PROVIDER "${raw}". Expected one of ${PROVIDERS.join(', ')}.`, {
      kind: 'bad_request',
      provider: raw,
    });
  }
  return raw as LlmProvider;
}

/** Look a row up by provider and model id, for pricing and capability reads. */
export function rowFor(provider: string, model: string): RegistryRow | undefined {
  return ROWS.find((candidate) => candidate.provider === provider && candidate.model === model);
}

/** The key the breaker and the logs use for one target. */
export function targetKey(target: Pick<LlmTarget, 'provider' | 'model' | 'baseURL'>): string {
  return `${target.provider}/${target.model}${target.baseURL ? `@${target.baseURL}` : ''}`;
}

function keyFor(provider: LlmProvider): string | undefined {
  return envFirst('LLM_API_KEY', ...(KEY_FALLBACKS[provider] ?? []));
}

/**
 * One chain entry: `provider/model`, or a bare `model` on LLM_PROVIDER, either
 * one optionally followed by `|baseURL`. The pipe is what lets a home rig and
 * the same model hosted sit in one chain, since both are openai-compatible on
 * different hosts. A gateway id keeps its own slash: `gateway/anthropic/model`.
 *
 * `prefixed` is false for the LLM_MODEL_<ROLE> and LLM_FALLBACK_<ROLE> pair,
 * which have always been bare ids on LLM_PROVIDER. Reading a provider out of
 * those would make a gateway id like `anthropic/claude-sonnet-5` mean two
 * different things depending on which var it sat in.
 */
function parseTarget(entry: string, role: LlmRole, provider: LlmProvider, prefixed: boolean): LlmTarget {
  const pipe = entry.indexOf('|');
  const head = (pipe === -1 ? entry : entry.slice(0, pipe)).trim();
  const inlineBase = pipe === -1 ? undefined : entry.slice(pipe + 1).trim() || undefined;

  const slash = head.indexOf('/');
  const maybeProvider = slash === -1 ? '' : head.slice(0, slash);
  const named = prefixed && PROVIDERS.includes(maybeProvider as LlmProvider);
  const targetProvider = named ? (maybeProvider as LlmProvider) : provider;
  const model = named ? head.slice(slash + 1) : head;

  if (!model) {
    throw new LlmError(`Chain entry "${entry}" for role "${role}" has no model id.`, {
      kind: 'bad_request',
      provider: targetProvider,
    });
  }

  // LLM_BASE_URL is the base URL of the provider the deployment selected, so it
  // only applies to a target on that provider that did not bring its own.
  const baseURL = inlineBase ?? (targetProvider === provider ? env('LLM_BASE_URL') : undefined);

  if (targetProvider === 'openai-compatible' && !baseURL) {
    throw new LlmError(
      `Target "${entry}" for role "${role}" is openai-compatible and needs LLM_BASE_URL or an inline "|<url>".`,
      { kind: 'bad_request', provider: targetProvider },
    );
  }

  const apiKey = keyFor(targetProvider);
  const keyOptional = targetProvider === 'stub' || targetProvider === 'openai-compatible';
  if (!apiKey && !keyOptional) {
    throw new LlmError(
      `No API key for provider "${targetProvider}". Set LLM_API_KEY${
        KEY_FALLBACKS[targetProvider] ? ` or ${KEY_FALLBACKS[targetProvider]![0]}` : ''
      }.`,
      { kind: 'auth', provider: targetProvider },
    );
  }

  return {
    provider: targetProvider,
    model,
    ...(apiKey ? { apiKey } : {}),
    ...(baseURL ? { baseURL } : {}),
    capabilities: rowFor(targetProvider, model)?.capabilities ?? UNKNOWN_CAPABILITIES,
  };
}

/**
 * Map a task role to an ordered chain of targets, all from env.
 * Throws at resolve time, never at call time, so a bad role or a missing
 * compatible model id fails before any network work starts.
 */
export function resolveModel(role: LlmRole): ResolvedModel {
  if (!LLM_ROLES.includes(role)) {
    throw new LlmError(`Unknown LLM role "${role}". Expected one of ${LLM_ROLES.join(', ')}.`, {
      kind: 'bad_request',
      provider: 'none',
    });
  }

  const provider = currentProvider();
  const tier = ROLE_TIERS[role];
  const suffix = role.toUpperCase();

  const chain = env(`LLM_MODELS_${suffix}`);
  const entries = chain
    ? chain.split(',').map((part) => part.trim()).filter(Boolean)
    : [env(`LLM_MODEL_${suffix}`) ?? REGISTRY[provider][tier]?.model, env(`LLM_FALLBACK_${suffix}`)]
        .filter((value): value is string => !!value);

  if (entries.length === 0) {
    throw new LlmError(
      `No model for role "${role}" on provider "${provider}". Set LLM_MODELS_${suffix} or LLM_MODEL_${suffix}.`,
      { kind: 'bad_request', provider },
    );
  }

  const targets = entries.map((entry) => parseTarget(entry, role, provider, !!chain));
  const primary = targets[0]!;

  return {
    role,
    tier,
    targets,
    provider: primary.provider,
    model: primary.model,
    ...(targets[1] ? { fallback: targets[1].model } : {}),
    ...(primary.apiKey ? { apiKey: primary.apiKey } : {}),
    ...(primary.baseURL ? { baseURL: primary.baseURL } : {}),
    capabilities: primary.capabilities,
    connectTimeoutMs: envNumber('LLM_CONNECT_TIMEOUT_MS', 2_000),
    timeoutMs: envNumber('LLM_TIMEOUT_MS', 30_000),
  };
}

/** What we assume about a model the registry has never seen. */
export const UNKNOWN_CAPABILITIES: LlmCapabilities = {
  vision: false,
  documents: false,
  tools: true,
  structuredOutput: true,
  caching: false,
  thinking: false,
  contextTokens: 128_000,
  maxOutput: 4_096,
};
