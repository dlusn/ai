// @dlusn/ai, the LLM-agnostic seam. Text, vision and structured output.
// Speech is ./speech, the test double is ./stub, cost is ./pricing.

export { complete, completeObject, stream } from './core.ts';
export { LlmError, isCapacityFailure, kindForStatus } from './errors.ts';
export { REGISTRY, ROLE_TIERS, currentProvider, resolveModel, rowFor } from './registry.ts';
export * from './types.ts';
