import { describe, expect, it } from 'vitest';

import { costBreakdown, costOf, priceFor } from '../src/pricing.ts';
import type { LlmResult } from '../src/types.ts';

function result(over: Partial<LlmResult> = {}): LlmResult {
  return {
    text: 'x',
    toolUses: [],
    stopReason: 'end',
    usage: { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 },
    provider: 'anthropic',
    model: 'claude-sonnet-5',
    ...over,
  };
}

describe('costOf', () => {
  it('bills a million of each at the registry rate', () => {
    // Sonnet is 3 in and 15 out per million.
    expect(costOf(result())).toBeCloseTo(18, 10);
  });

  it('bills cache reads and cache writes separately', () => {
    const usd = costOf(
      result({ usage: { input: 0, output: 0, cacheRead: 2_000_000, cacheWrite: 1_000_000 } }),
    );
    // 2 million cache reads at 0.30 plus 1 million cache writes at 3.75.
    expect(usd).toBeCloseTo(0.6 + 3.75, 10);
  });

  it('scales down to a realistic single call', () => {
    const usd = costOf(result({ usage: { input: 1_200, output: 340, cacheRead: 0, cacheWrite: 0 } }));
    expect(usd).toBeCloseTo((1_200 * 3 + 340 * 15) / 1_000_000, 12);
  });

  it('itemises the breakdown', () => {
    const breakdown = costBreakdown(result());
    expect(breakdown.priced).toBe(true);
    expect(breakdown.input).toBeCloseTo(3, 10);
    expect(breakdown.output).toBeCloseTo(15, 10);
    expect(breakdown.usd).toBeCloseTo(breakdown.input + breakdown.output, 10);
  });

  it('books zero for an unpriced pair and calls onUnpriced once', () => {
    const seen: { provider: string; model: string }[] = [];
    const unpriced = result({ provider: 'openai-compatible', model: 'house-model-1' });

    expect(costOf(unpriced, { onUnpriced: (pair) => seen.push(pair) })).toBe(0);
    expect(seen).toEqual([{ provider: 'openai-compatible', model: 'house-model-1', usage: unpriced.usage }]);
  });

  it('never throws in a request path when nobody passed a hook', () => {
    expect(costOf(result({ provider: 'openai-compatible', model: 'house-model-1' }))).toBe(0);
  });

  it('prices the stub at zero without calling onUnpriced', () => {
    let called = 0;
    expect(costOf(result({ provider: 'stub', model: 'stub-best' }), { onUnpriced: () => { called += 1; } })).toBe(0);
    expect(called).toBe(0);
  });

  it('exposes the price row', () => {
    expect(priceFor('openai', 'gpt-5')).toEqual({ input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 0 });
    expect(priceFor('openai', 'nope')).toBeUndefined();
  });
});
