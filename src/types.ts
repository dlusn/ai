// The seam contract. Every type here comes from dlusn/ceo docs/llm-agnostic.md.
// Call sites import from here and never from a vendor SDK.

/** Task roles. A call site passes a role, never a model id or a vendor tier. */
export type LlmRole = 'chat' | 'draft' | 'vision' | 'extract' | 'triage';

export const LLM_ROLES: readonly LlmRole[] = ['chat', 'draft', 'vision', 'extract', 'triage'];

/** Cost and capability tiers the registry is keyed by. */
export type LlmTier = 'fast' | 'standard' | 'best';

/** Providers the package can resolve. `openai-compatible` needs LLM_BASE_URL. */
export type LlmProvider = 'anthropic' | 'openai' | 'openai-compatible' | 'google' | 'stub';

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

/** What resolveModel hands the adapter layer. */
export type ResolvedModel = {
  role: LlmRole;
  tier: LlmTier;
  provider: LlmProvider;
  model: string;
  /** LLM_FALLBACK_<ROLE>, used once on a capacity failure. */
  fallback?: string;
  apiKey?: string;
  baseURL?: string;
  capabilities: LlmCapabilities;
};

/** Capability names come from the ekoni ADR. */
export type LlmCapabilities = {
  vision: boolean;
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
};
