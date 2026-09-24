// The stub adapter. No network, no vendor key, one fixture per role supplied by
// the caller. Every verify script and gate runs on this.

import { LlmError } from '../errors.ts';
import type { LlmRequest, LlmResult, LlmRole, ResolvedModel } from '../types.ts';

/** What a caller can hand back for a role. A bare string means text only. */
export type StubFixture =
  | string
  | {
      text?: string;
      toolUses?: { name: string; input: unknown }[];
      stopReason?: LlmResult['stopReason'];
      usage?: Partial<LlmResult['usage']>;
      /** Throw instead of answering, to exercise fallback and error paths. */
      error?: LlmError;
    };

export type StubFixtures = Partial<Record<LlmRole, StubFixture>>;

export type StubCall = { role: LlmRole; model: string; request: LlmRequest; kind: 'complete' | 'stream' | 'object' };

let fixtures: StubFixtures = {};
let calls: StubCall[] = [];

/** Install the fixture map. Replaces anything set before. */
export function setStubFixtures(next: StubFixtures): void {
  fixtures = { ...next };
}

/** Every stub call since the last reset, oldest first. */
export function stubCalls(): readonly StubCall[] {
  return calls;
}

/** Clear fixtures and recorded calls. */
export function resetStub(): void {
  fixtures = {};
  calls = [];
}

export function stubComplete(
  resolved: ResolvedModel,
  req: LlmRequest,
  kind: StubCall['kind'] = 'complete',
): LlmResult {
  calls.push({ role: resolved.role, model: resolved.model, request: req, kind });

  const fixture = fixtures[req.role];
  if (fixture === undefined) {
    throw new LlmError(
      `No stub fixture for role "${req.role}". Call setStubFixtures({ ${req.role}: "..." }) first.`,
      { kind: 'bad_request', provider: 'stub' },
    );
  }

  const spec = typeof fixture === 'string' ? { text: fixture } : fixture;
  if (spec.error) throw spec.error;

  const text = spec.text ?? '';
  const toolUses = spec.toolUses ?? [];
  return {
    text,
    toolUses,
    stopReason: spec.stopReason ?? (toolUses.length ? 'tool_use' : 'end'),
    usage: {
      input: spec.usage?.input ?? 0,
      output: spec.usage?.output ?? 0,
      cacheRead: spec.usage?.cacheRead ?? 0,
      cacheWrite: spec.usage?.cacheWrite ?? 0,
    },
    provider: 'stub',
    model: resolved.model,
  };
}
