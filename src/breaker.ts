// A per target circuit breaker, in memory, per isolate. No external state: an
// edge isolate is short lived and a shared store would need a round trip on the
// hot path, which is the thing the breaker exists to avoid.

import { envNumber } from './env.ts';

export type BreakerVerdict = 'closed' | 'open' | 'probe';

type Entry = {
  failures: number;
  /** When the breaker opened, ms since epoch. Absent while closed. */
  openedAt?: number;
  /** A half open probe is in flight, so no second request gets through. */
  probing: boolean;
};

const entries = new Map<string, Entry>();

/** Consecutive failures that open a target. */
export function breakerThreshold(): number {
  return envNumber('LLM_BREAKER_FAILURES', 3);
}

/** How long a target stays open before one probe is let through. */
export function breakerMs(): number {
  return envNumber('LLM_BREAKER_MS', 120_000);
}

function entryFor(key: string): Entry {
  const found = entries.get(key);
  if (found) return found;
  const fresh: Entry = { failures: 0, probing: false };
  entries.set(key, fresh);
  return fresh;
}

/**
 * Closed: call it. Open: skip it, the target is still cooling down. Probe: this
 * one request is the half open probe, everything else keeps skipping.
 */
export function breakerCheck(key: string, now = Date.now()): BreakerVerdict {
  const entry = entries.get(key);
  if (!entry || entry.openedAt === undefined) return 'closed';
  if (now - entry.openedAt < breakerMs()) return 'open';
  if (entry.probing) return 'open';
  entry.probing = true;
  return 'probe';
}

/** A target answered. Close it and forget the failures. */
export function breakerSuccess(key: string): { closed: boolean } {
  const entry = entries.get(key);
  if (!entry) return { closed: false };
  const wasOpen = entry.openedAt !== undefined;
  entries.delete(key);
  return { closed: wasOpen };
}

/** A target failed. Returns true when this failure is the one that opened it. */
export function breakerFailure(key: string, now = Date.now()): { opened: boolean } {
  const entry = entryFor(key);
  entry.probing = false;
  // A failed half open probe reopens for a fresh window without needing N more.
  if (entry.openedAt !== undefined) {
    entry.openedAt = now;
    return { opened: false };
  }
  entry.failures += 1;
  if (entry.failures < breakerThreshold()) return { opened: false };
  entry.openedAt = now;
  return { opened: true };
}

/** Drop every breaker. Tests and long lived workers that reload config use it. */
export function resetBreakers(): void {
  entries.clear();
}
