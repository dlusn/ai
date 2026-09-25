// Cost in USD from the registry. An unpriced provider and model pair books zero
// and calls onUnpriced, it never throws in a request path (cmd metering rule).

import { rowFor } from './registry.ts';
import type { LlmPrice, LlmResult, LlmUsage } from './types.ts';

export type CostOptions = {
  /** Called once when the pair has no registry row. Book zero, log, move on. */
  onUnpriced?: (pair: { provider: string; model: string; usage: LlmUsage }) => void;
};

export type CostBreakdown = {
  /** Total USD for the call. */
  usd: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  priced: boolean;
};

const PER_MILLION = 1_000_000;

/** USD for one result. Zero for an unpriced pair. */
export function costOf(result: LlmResult, options: CostOptions = {}): number {
  return costBreakdown(result, options).usd;
}

/** The same math, itemised, for a metering row. */
export function costBreakdown(result: LlmResult, options: CostOptions = {}): CostBreakdown {
  const price = priceFor(result.provider, result.model);
  if (!price) {
    options.onUnpriced?.({ provider: result.provider, model: result.model, usage: result.usage });
    return { usd: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, priced: false };
  }

  const input = (result.usage.input * price.input) / PER_MILLION;
  const output = (result.usage.output * price.output) / PER_MILLION;
  const cacheRead = (result.usage.cacheRead * price.cacheRead) / PER_MILLION;
  const cacheWrite = (result.usage.cacheWrite * price.cacheWrite) / PER_MILLION;

  return { usd: input + output + cacheRead + cacheWrite, input, output, cacheRead, cacheWrite, priced: true };
}

/** The price row for a pair, or undefined if the registry has never seen it. */
export function priceFor(provider: string, model: string): LlmPrice | undefined {
  return rowFor(provider, model)?.price;
}
