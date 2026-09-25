// The only file besides the adapters that is allowed to name a vendor model id.
// Prices are USD per million tokens, one currency for the whole table.
// Anything here is a default: LLM_MODEL_<ROLE> always wins.

import { env, envFirst } from './env.ts';
import { LlmError } from './errors.ts';
import {
  LLM_ROLES,
  type LlmCapabilities,
  type LlmProvider,
  type LlmRole,
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

function caps(partial: Partial<LlmCapabilities> & Pick<LlmCapabilities, 'contextTokens' | 'maxOutput'>): LlmCapabilities {
  return {
    vision: true,
    tools: true,
    structuredOutput: true,
    caching: false,
    thinking: false,
    ...partial,
  };
}

export const REGISTRY: Record<LlmProvider, Record<LlmTier, RegistryRow | null>> = {
  anthropic: {
    fast: {
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      capabilities: caps({ caching: true, thinking: true, contextTokens: 200_000, maxOutput: 64_000 }),
      price: { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
    },
    standard: {
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      capabilities: caps({ caching: true, thinking: true, contextTokens: 200_000, maxOutput: 64_000 }),
      price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    },
    best: {
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      capabilities: caps({ caching: true, thinking: true, contextTokens: 200_000, maxOutput: 64_000 }),
      price: { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
    },
  },
  openai: {
    fast: {
      provider: 'openai',
      model: 'gpt-5-nano',
      capabilities: caps({ caching: true, thinking: true, contextTokens: 400_000, maxOutput: 128_000 }),
      price: { input: 0.05, output: 0.4, cacheRead: 0.005, cacheWrite: 0 },
    },
    standard: {
      provider: 'openai',
      model: 'gpt-5-mini',
      capabilities: caps({ caching: true, thinking: true, contextTokens: 400_000, maxOutput: 128_000 }),
      price: { input: 0.25, output: 2, cacheRead: 0.025, cacheWrite: 0 },
    },
    best: {
      provider: 'openai',
      model: 'gpt-5',
      capabilities: caps({ caching: true, thinking: true, contextTokens: 400_000, maxOutput: 128_000 }),
      price: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 },
    },
  },
  google: {
    fast: {
      provider: 'google',
      model: 'gemini-2.5-flash-lite',
      capabilities: caps({ caching: true, contextTokens: 1_000_000, maxOutput: 64_000 }),
      price: { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0 },
    },
    standard: {
      provider: 'google',
      model: 'gemini-2.5-flash',
      capabilities: caps({ caching: true, thinking: true, contextTokens: 1_000_000, maxOutput: 64_000 }),
      price: { input: 0.3, output: 2.5, cacheRead: 0.075, cacheWrite: 0 },
    },
    best: {
      provider: 'google',
      model: 'gemini-2.5-pro',
      capabilities: caps({ caching: true, thinking: true, contextTokens: 1_000_000, maxOutput: 64_000 }),
      price: { input: 1.25, output: 10, cacheRead: 0.31, cacheWrite: 0 },
    },
  },
  // A compatible endpoint can be anything, so there is no honest default id or
  // price. LLM_MODEL_<ROLE> is required and cost books as unpriced until the
  // deployment adds a row.
  'openai-compatible': { fast: null, standard: null, best: null },
  stub: {
    fast: { provider: 'stub', model: 'stub-fast', capabilities: caps({ contextTokens: 200_000, maxOutput: 8_192 }), price: ZERO() },
    standard: { provider: 'stub', model: 'stub-standard', capabilities: caps({ contextTokens: 200_000, maxOutput: 8_192 }), price: ZERO() },
    best: { provider: 'stub', model: 'stub-best', capabilities: caps({ contextTokens: 200_000, maxOutput: 8_192 }), price: ZERO() },
  },
};

function ZERO() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}

const PROVIDERS: readonly LlmProvider[] = ['anthropic', 'openai', 'openai-compatible', 'google', 'stub'];

const KEY_FALLBACKS: Partial<Record<LlmProvider, string[]>> = {
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  'openai-compatible': ['OPENAI_API_KEY'],
  google: ['GOOGLE_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
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
  const tiers = REGISTRY[provider as LlmProvider];
  if (!tiers) return undefined;
  for (const tier of ['fast', 'standard', 'best'] as LlmTier[]) {
    const row = tiers[tier];
    if (row && row.model === model) return row;
  }
  return undefined;
}

/**
 * Map a task role to a provider, a model id and a fallback, all from env.
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
  const row = REGISTRY[provider][tier];
  const suffix = role.toUpperCase();

  const model = env(`LLM_MODEL_${suffix}`) ?? row?.model;
  if (!model) {
    throw new LlmError(
      `No model for role "${role}" on provider "${provider}". Set LLM_MODEL_${suffix}.`,
      { kind: 'bad_request', provider },
    );
  }

  const baseURL = env('LLM_BASE_URL');
  if (provider === 'openai-compatible' && !baseURL) {
    throw new LlmError('LLM_PROVIDER=openai-compatible needs LLM_BASE_URL.', {
      kind: 'bad_request',
      provider,
    });
  }

  const apiKey = envFirst('LLM_API_KEY', ...(KEY_FALLBACKS[provider] ?? []));
  const keyOptional = provider === 'stub' || (provider === 'openai-compatible' && !!baseURL);
  if (!apiKey && !keyOptional) {
    throw new LlmError(
      `No API key for provider "${provider}". Set LLM_API_KEY${
        KEY_FALLBACKS[provider] ? ` or ${KEY_FALLBACKS[provider]![0]}` : ''
      }.`,
      { kind: 'auth', provider },
    );
  }

  return {
    role,
    tier,
    provider,
    model,
    fallback: env(`LLM_FALLBACK_${suffix}`),
    apiKey,
    baseURL,
    capabilities: rowFor(provider, model)?.capabilities ?? UNKNOWN_CAPABILITIES,
  };
}

/** What we assume about a model the registry has never seen. */
export const UNKNOWN_CAPABILITIES: LlmCapabilities = {
  vision: false,
  tools: true,
  structuredOutput: true,
  caching: false,
  thinking: false,
  contextTokens: 128_000,
  maxOutput: 4_096,
};
