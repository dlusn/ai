import { describe, expect, it } from 'vitest';

import { cacheReadRate, costBreakdown, costOf, priceFor, usageToCost } from '../src/pricing.ts';
import { rowFor } from '../src/registry.ts';
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

describe('the cache discount', () => {
  it('bills cached tokens at the published cache read price where there is one', () => {
    const row = rowFor('openai', 'gpt-6-sol')!;
    expect(row.expectedCacheDiscount).toBe(0.9);
    expect(cacheReadRate(row)).toBe(0.2);
  });

  it('applies the discount to the input price where the vendor publishes no cache rate', () => {
    // A compatible endpoint with no prompt cache: a cached token costs full input.
    const qwen = rowFor('openai-compatible', 'Qwen/Qwen3.6-27B')!;
    expect(qwen.expectedCacheDiscount).toBe(0);
    expect(cacheReadRate(qwen)).toBe(qwen.price.input);

    const usd = usageToCost('openai-compatible', 'Qwen/Qwen3.6-27B', {
      input: 0,
      output: 0,
      cacheRead: 1_000_000,
      cacheWrite: 0,
    }).usd;
    expect(usd).toBeCloseTo(0.32, 10);
  });
});

describe('the ids DLUSN consumers pin', () => {
  // Owner rule 25 Sep 2026: latest id per tier only. fable 5.1 had no row
  // before v0.3, so every cmd chat call metered zero and the daily cap never moved.
  const PINNED: [string, { input: number; output: number; cacheRead: number; cacheWrite: number }][] = [
    ['claude-fable-5-1', { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 }],
  ];

  for (const [model, price] of PINNED) {
    it(`${model} has a row and meters nonzero`, () => {
      expect(priceFor('anthropic', model)).toEqual(price);

      const breakdown = usageToCost('anthropic', model, {
        input: 10_000,
        output: 2_000,
        cacheRead: 5_000,
        cacheWrite: 1_000,
      });
      expect(breakdown.priced).toBe(true);
      expect(breakdown.usd).toBeGreaterThan(0);
      expect(breakdown.usd).toBeCloseTo(
        (10_000 * price.input + 2_000 * price.output + 5_000 * price.cacheRead + 1_000 * price.cacheWrite) /
          1_000_000,
        12,
      );
    });
  }

  it('warns once per isolate for an id it has never seen', () => {
    const lines: string[] = [];
    const original = console.warn;
    console.warn = (line: unknown) => { lines.push(String(line)); };
    try {
      const usage = { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 };
      usageToCost('anthropic', 'claude-not-shipped-yet', usage);
      usageToCost('anthropic', 'claude-not-shipped-yet', usage);
    } finally {
      console.warn = original;
    }

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toEqual({ event: 'llm.unpriced', target: 'anthropic/claude-not-shipped-yet' });
  });
});

describe('usageToCost', () => {
  it('meters in currency without an LlmResult', () => {
    const breakdown = usageToCost('anthropic', 'claude-sonnet-5', {
      input: 1_000_000,
      output: 1_000_000,
      cacheRead: 0,
      cacheWrite: 0,
    });
    expect(breakdown.usd).toBeCloseTo(18, 10);
    expect(breakdown.priced).toBe(true);
  });

  it('books zero and calls the hook for a pair the registry has never seen', () => {
    const seen: string[] = [];
    const breakdown = usageToCost(
      'gateway',
      'someone/unknown-model',
      { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 },
      { onUnpriced: (pair) => seen.push(`${pair.provider}/${pair.model}`) },
    );
    expect(breakdown).toEqual({ usd: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, priced: false });
    expect(seen).toEqual(['gateway/someone/unknown-model']);
  });

  it('prices a brokered call off the gateway row', () => {
    const breakdown = usageToCost('gateway', 'anthropic/claude-sonnet-5', {
      input: 1_000_000,
      output: 0,
      cacheRead: 1_000_000,
      cacheWrite: 0,
    });
    expect(breakdown.input).toBeCloseTo(3, 10);
    expect(breakdown.cacheRead).toBeCloseTo(0.3, 10);
  });
});
