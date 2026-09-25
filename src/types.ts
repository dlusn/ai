// The seam contract. Every type here comes from dlusn/ceo docs/llm-agnostic.md.
// Call sites import from here and never from a vendor SDK.

/** Task roles. A call site passes a role, never a model id or a vendor tier. */
export type LlmRole = 'chat' | 'draft' | 'vision' | 'extract' | 'triage';

export const LLM_ROLES: readonly LlmRole[] = ['chat', 'draft', 'vision', 'extract', 'triage'];

/** Cost and capability tiers the registry is keyed by. */
export type LlmTier = 'fast' | 'standard' | 'best';

/**
 * Providers the package can resolve. `openai-compatible` needs LLM_BASE_URL.
 * `gateway` is the Vercel AI Gateway, a broker in front of many vendors. It is
 * a target like any other and never a default: a health adjacent role pins a
 * direct vendor instead.
 */
export type LlmProvider =
  | 'anthropic'
  | 'openai'
  | 'openai-compatible'
  | 'google'
  | 'gateway'
  | 'stub';

export type LlmTextPart = { type: 'text'; text: string };

/** Vision travels as a part. The adapter converts it to the vendor shape. */
export type LlmImagePart = {
  type: 'image';
  /** Media type, for example image/png. Required with base64, optional with url. */
  mime?: string;
  base64?: string;
  url?: string;
};

export type LlmPart = LlmTextPart | LlmImagePart;

export type LlmMessage = {
  role: 'user' | 'assistant';
  content: string | LlmPart[];
};

/** Provider neutral tool. `inputSchema` is plain JSON Schema. */
export type LlmTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

export type LlmToolChoice = 'auto' | 'required' | 'none' | { name: string };

export type LlmRequest = {
  role: LlmRole;
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
  temperature?: number;
  tools?: LlmTool[];
  toolChoice?: LlmToolChoice;
  /** Ask for a JSON object. The seam applies the provider specific switch. */
  json?: boolean;
  /** Opt in to prompt caching where the provider supports it, ignored elsewhere. */
  cache?: boolean;
  /** Opt in to extended thinking where the provider supports it, ignored elsewhere. */
  thinking?: { budgetTokens?: number } | boolean;
  signal?: AbortSignal;
};

export type LlmUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type LlmStopReason = 'end' | 'max_tokens' | 'tool_use' | 'other';

export type LlmResult = {
  text: string;
  toolUses: { name: string; input: unknown }[];
  stopReason: LlmStopReason;
  usage: LlmUsage;
  /** The provider that answered. */
  provider: string;
  /** The model id that actually answered, after any fallback. */
  model: string;
};

/** completeObject returns the contract result plus the parsed object. */
export type LlmObjectResult<T> = LlmResult & { object: T };

export type LlmChunk =
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string; input: unknown }
  | { type: 'done'; result: LlmResult };

export type LlmErrorKind =
  | 'rate_limit'
  | 'overloaded'
  | 'auth'
  | 'bad_request'
  | 'unavailable'
  | 'unknown';

/**
 * One entry in a role's fallback chain. A chain is an ordered list, primary
 * first, parsed from LLM_MODELS_<ROLE>. Each entry carries its own key and base
 * URL so a home rig and the same model hosted can sit in one chain.
 */
export type LlmTarget = {
  provider: LlmProvider;
  model: string;
  apiKey?: string;
  baseURL?: string;
  capabilities: LlmCapabilities;
};

/** What resolveModel hands the adapter layer. */
export type ResolvedModel = {
  role: LlmRole;
  tier: LlmTier;
  /** The whole chain, primary first. Never empty. */
  targets: LlmTarget[];
  /** The primary target, flattened. Same fields v0.1 exposed. */
  provider: LlmProvider;
  model: string;
  /** The second entry's model id, when there is one. */
  fallback?: string;
  apiKey?: string;
  baseURL?: string;
  capabilities: LlmCapabilities;
  /** Milliseconds to first byte before the seam gives up on a target. */
  connectTimeoutMs: number;
  /** Milliseconds for the whole attempt on one target. */
  timeoutMs: number;
};

/** Capability names come from the ekoni ADR. */
export type LlmCapabilities = {
  vision: boolean;
  /** PDF or other document parts are accepted as input. */
  documents: boolean;
  tools: boolean;
  structuredOutput: boolean;
  caching: boolean;
  thinking: boolean;
  contextTokens: number;
  maxOutput: number;
};

/** USD per million tokens, one currency for the whole registry. */
export type LlmPrice = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type RegistryRow = {
  provider: LlmProvider;
  model: string;
  capabilities: LlmCapabilities;
  price: LlmPrice;
  /**
   * Share off the input price a cached input token gets on this row, 0 to 1.
   * 0.9 means cached tokens bill at a tenth of the input price. A row whose
   * vendor publishes no separate cache read price prices cached tokens from
   * this number instead, so a consumer can forecast a cache before calling.
   */
  expectedCacheDiscount: number;
};

/** One line the seam emits when a chain hop or a breaker changes something. */
export type LlmLogEvent = {
  event: 'llm.fallback' | 'llm.breaker_open' | 'llm.breaker_skip' | 'llm.breaker_close';
  role: LlmRole;
  /** provider/model of the target the line is about. */
  target: string;
  /** provider/model of the next target, on a fallback hop. */
  next?: string;
  kind?: LlmErrorKind;
  status?: number;
  /** Milliseconds the failed attempt took. */
  ms?: number;
  reason?: string;
};
