// Cost in USD from the registry. An unpriced provider and model pair books zero
// and calls onUnpriced, it never throws in a request path (cmd metering rule).

import { rowFor } from './registry.ts';
import type { LlmPrice, LlmResult, LlmUsage, RegistryRow } from './types.ts';

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

const NOTHING: CostBreakdown = { usd: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, priced: false };

const warnedPairs = new Set<string>();

/**
 * An unpriced pair meters as zero, which silently turns a consumer's daily
 * spend cap into a no-op. Zero is still the answer, because throwing in a
 * request path is worse, but the pair gets named out loud once per isolate so
 * the gap shows up in logs instead of in a month of free looking spend.
 */
function warnUnpriced(provider: string, model: string): void {
  const pair = `${provider}/${model}`;
  if (warnedPairs.has(pair)) return;
  warnedPairs.add(pair);
  try {
    console.warn(JSON.stringify({ event: 'llm.unpriced', target: pair }));
  } catch {
    // ponytail: swallowed on purpose, a log line is not in the request contract
  }
}

/**
 * USD per million for a cached input token. The published cache read price
 * where the vendor has one, otherwise the input price less the row's expected
 * cache discount. A row with no discount bills cached tokens at full input,
 * which is what a compatible endpoint with no prompt cache actually does.
 */
export function cacheReadRate(row: RegistryRow): number {
  if (row.price.cacheRead > 0) return row.price.cacheRead;
  return row.price.input * (1 - row.expectedCacheDiscount);
}

/** USD for one result. Zero for an unpriced pair. */
export function costOf(result: LlmResult, options: CostOptions = {}): number {
  return costBreakdown(result, options).usd;
}

/** The same math, itemised, for a metering row. */
export function costBreakdown(result: LlmResult, options: CostOptions = {}): CostBreakdown {
  return usageToCost(result.provider, result.model, result.usage, options);
}

/**
 * Meter in currency, not raw tokens, without holding an LlmResult. A consumer
 * that stores usage rows and prices them later reads this.
 */
export function usageToCost(
  provider: string,
  model: string,
  usage: LlmUsage,
  options: CostOptions = {},
): CostBreakdown {
  const row = rowFor(provider, model);
  if (!row) {
    warnUnpriced(provider, model);
    options.onUnpriced?.({ provider, model, usage });
    return NOTHING;
  }

  const input = (usage.input * row.price.input) / PER_MILLION;
  const output = (usage.output * row.price.output) / PER_MILLION;
  const cacheRead = (usage.cacheRead * cacheReadRate(row)) / PER_MILLION;
  const cacheWrite = (usage.cacheWrite * row.price.cacheWrite) / PER_MILLION;

  return { usd: input + output + cacheRead + cacheWrite, input, output, cacheRead, cacheWrite, priced: true };
}

/** The price row for a pair, or undefined if the registry has never seen it. */
export function priceFor(provider: string, model: string): LlmPrice | undefined {
  return rowFor(provider, model)?.price;
}
