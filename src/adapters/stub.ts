// The stub adapter. No network, no vendor key, one fixture per role supplied by
// the caller. Every verify script and gate runs on this.

import { LlmError } from '../errors.ts';
import type { LlmRequest, LlmResult, LlmRole, LlmToolResultPart, ResolvedModel } from '../types.ts';

/** What a caller can hand back for a role. A bare string means text only. */
export type StubFixture =
  | string
  | {
      text?: string;
      /** `id` is optional: without one the stub numbers the calls in order. */
      toolUses?: { id?: string; name: string; input: unknown }[];
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

/** The newest tool_result the caller sent, searching backwards. */
function lastToolResult(req: LlmRequest): LlmToolResultPart | undefined {
  for (let i = req.messages.length - 1; i >= 0; i -= 1) {
    const content = req.messages[i]!.content;
    if (typeof content === 'string') continue;
    for (let j = content.length - 1; j >= 0; j -= 1) {
      const part = content[j]!;
      if (part.type === 'tool_result') return part;
    }
  }
  return undefined;
}

/**
 * What the stub says back when it was handed a tool result. Echoing it is what
 * lets a contract test prove a whole tool loop without a vendor key: a stub
 * that ignored the result would pass a broken round trip just as happily.
 */
function toolResultEcho(part: LlmToolResultPart): string {
  const body =
    typeof part.content === 'string'
      ? part.content
      : part.content.map((inner) => (inner.type === 'text' ? inner.text : `[${inner.type}]`)).join('');
  return `tool_result ${part.toolUseId}: ${body}`;
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

  const echo = lastToolResult(req);
  const text = [spec.text ?? '', echo ? toolResultEcho(echo) : ''].filter(Boolean).join(' ');
  const toolUses = (spec.toolUses ?? []).map((use, index) => ({
    id: use.id ?? `stub_tool_${index + 1}`,
    name: use.name,
    input: use.input,
  }));
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
