// complete, stream and completeObject. The fallback chain, the timeouts and the
// circuit breaker live here once, so no route or edge function writes a retry.

import { Output, generateText, jsonSchema, streamText, type FinishReason } from 'ai';

import {
  cacheWriteTokens,
  languageModel,
  toLlmError,
  toModelMessages,
  toProviderOptions,
  toToolChoice,
  toToolSet,
} from './adapters/index.ts';
import { stubComplete } from './adapters/stub.ts';
import { breakerCheck, breakerFailure, breakerSuccess } from './breaker.ts';
import { LlmError, isCapacityFailure } from './errors.ts';
import { logLlm } from './log.ts';
import { resolveModel, targetKey } from './registry.ts';
import type {
  LlmChunk,
  LlmObjectResult,
  LlmRequest,
  LlmResult,
  LlmStopReason,
  LlmTarget,
  LlmUsage,
  ResolvedModel,
} from './types.ts';

function stopReasonOf(finish: FinishReason, toolCount: number): LlmStopReason {
  if (toolCount > 0 || finish === 'tool-calls') return 'tool_use';
  if (finish === 'length') return 'max_tokens';
  if (finish === 'stop') return 'end';
  return 'other';
}

function usageOf(usage: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number }, metadata: unknown): LlmUsage {
  return {
    input: usage.inputTokens ?? 0,
    output: usage.outputTokens ?? 0,
    cacheRead: usage.cachedInputTokens ?? 0,
    cacheWrite: cacheWriteTokens(metadata),
  };
}

function baseCallOptions(
  resolved: ResolvedModel,
  target: LlmTarget,
  req: LlmRequest,
  signal: AbortSignal,
) {
  return {
    model: languageModel(target, target.model, resolved.connectTimeoutMs),
    system: req.system,
    messages: toModelMessages(req.messages),
    maxOutputTokens: req.maxTokens,
    // One retry policy, in one place. The SDK's own backoff would hide a
    // capacity failure behind several slow attempts before the next target in
    // the chain ever gets a turn, so the seam does the failing over itself.
    maxRetries: 0,
    abortSignal: signal,
    ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
    ...(() => {
      const options = toProviderOptions(target.provider, req, target.capabilities, target.model);
      return options ? { providerOptions: options } : {};
    })(),
  };
}

/** A failure the next target in the chain is worth trying for. */
function worthFailingOver(error: LlmError): boolean {
  return error.retryable || isCapacityFailure(error);
}

/**
 * Walk the chain from LLM_MODELS_<ROLE>. Each target gets one attempt, bounded
 * by LLM_CONNECT_TIMEOUT_MS to first byte and LLM_TIMEOUT_MS in total. A target
 * that keeps failing trips its breaker and gets skipped outright until the
 * window passes, which is what makes a dead home rig cost nothing on the second
 * call rather than a timeout every time.
 */
async function runChain<T>(
  resolved: ResolvedModel,
  attempt: (target: LlmTarget, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  let last: LlmError | undefined;

  for (let index = 0; index < resolved.targets.length; index += 1) {
    const target = resolved.targets[index]!;
    const next = resolved.targets[index + 1];
    const key = targetKey(target);

    if (breakerCheck(key) === 'open') {
      logLlm({
        event: 'llm.breaker_skip',
        role: resolved.role,
        target: key,
        ...(next ? { next: targetKey(next) } : {}),
      });
      last = new LlmError(`Circuit breaker is open for ${key}.`, {
        kind: 'unavailable',
        provider: target.provider,
        retryable: true,
      });
      continue;
    }

    const started = Date.now();
    const controller = new AbortController();
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Raced, not only aborted: a target that holds the connection open forever
    // would otherwise hold the whole chain open with it.
    const expiry = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        expired = true;
        controller.abort();
        reject(new Error('timeout'));
      }, resolved.timeoutMs);
    });

    try {
      const value = await Promise.race([attempt(target, controller.signal), expiry]);
      if (breakerSuccess(key).closed) {
        logLlm({ event: 'llm.breaker_close', role: resolved.role, target: key });
      }
      return value;
    } catch (raw) {
      const error = expired
        ? new LlmError(`${key} did not answer within ${resolved.timeoutMs}ms.`, {
            kind: 'unavailable',
            provider: target.provider,
            retryable: true,
            cause: raw,
          })
        : toLlmError(raw, target.provider);
      last = error;

      if (breakerFailure(key).opened) {
        logLlm({ event: 'llm.breaker_open', role: resolved.role, target: key, kind: error.kind, ...(error.status === undefined ? {} : { status: error.status }) });
      }

      if (!next || !worthFailingOver(error)) throw error;

      logLlm({
        event: 'llm.fallback',
        role: resolved.role,
        target: key,
        next: targetKey(next),
        kind: error.kind,
        ...(error.status === undefined ? {} : { status: error.status }),
        ms: Date.now() - started,
        reason: error.message,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  throw (
    last ??
    new LlmError(`No target answered for role "${resolved.role}".`, {
      kind: 'unavailable',
      provider: resolved.provider,
      retryable: true,
    })
  );
}

/** Merge the caller's AbortSignal into the per attempt one. */
function linked(signal: AbortSignal, outer?: AbortSignal): AbortSignal {
  if (!outer) return signal;
  const controller = new AbortController();
  const stop = () => controller.abort(outer.aborted ? outer.reason : signal.reason);
  if (outer.aborted || signal.aborted) stop();
  else {
    outer.addEventListener('abort', stop, { once: true });
    signal.addEventListener('abort', stop, { once: true });
  }
  return controller.signal;
}

/** One turn, text and tool uses. */
export async function complete(req: LlmRequest): Promise<LlmResult> {
  const resolved = resolveModel(req.role);

  return runChain(resolved, async (target, signal) => {
    if (target.provider === 'stub') return stubComplete({ ...resolved, ...target }, req);

    const result = await generateText({
      ...baseCallOptions(resolved, target, req, linked(signal, req.signal)),
      ...(() => {
        const tools = toToolSet(req.tools);
        if (!tools) return {};
        const choice = toToolChoice(req.toolChoice);
        return { tools, ...(choice ? { toolChoice: choice } : {}) };
      })(),
    });

    const toolUses = result.toolCalls.map((call) => ({ id: call.toolCallId, name: call.toolName, input: call.input }));
    return {
      text: result.text,
      toolUses,
      stopReason: stopReasonOf(result.finishReason, toolUses.length),
      usage: usageOf(result.usage, result.providerMetadata),
      provider: target.provider,
      model: target.model,
    } satisfies LlmResult;
  });
}

/**
 * Streaming turn. Yields text chunks and tool uses as they arrive, then one
 * final `done` chunk carrying the same LlmResult complete would have returned.
 */
export async function* stream(req: LlmRequest): AsyncIterable<LlmChunk> {
  const resolved = resolveModel(req.role);

  if (resolved.targets[0]?.provider === 'stub') {
    const result = stubComplete({ ...resolved, ...resolved.targets[0] }, req, 'stream');
    if (result.text) yield { type: 'text', text: result.text };
    for (const use of result.toolUses) yield { type: 'tool', id: use.id, name: use.name, input: use.input };
    yield { type: 'done', result };
    return;
  }

  // A stream cannot be retried once bytes are out, so the chain applies to
  // opening the stream only.
  const opened = await runChain(resolved, async (target, signal) => {
    const handle = streamText({
      ...baseCallOptions(resolved, target, req, linked(signal, req.signal)),
      ...(() => {
        const tools = toToolSet(req.tools);
        if (!tools) return {};
        const choice = toToolChoice(req.toolChoice);
        return { tools, ...(choice ? { toolChoice: choice } : {}) };
      })(),
    });
    // Surfaces the first error before any chunk reaches the caller.
    const iterator = handle.fullStream[Symbol.asyncIterator]();
    const first = await iterator.next();
    return { handle, iterator, first, target };
  });

  const { handle, iterator, first, target } = opened;
  try {
    for (let step = first; !step.done; step = await iterator.next()) {
      const part = step.value;
      if (part.type === 'text-delta') yield { type: 'text', text: part.text };
      else if (part.type === 'tool-call') yield { type: 'tool', id: part.toolCallId, name: part.toolName, input: part.input };
      else if (part.type === 'error') throw part.error;
    }

    const [text, finishReason, usage, toolCalls, metadata] = await Promise.all([
      handle.text,
      handle.finishReason,
      handle.usage,
      handle.toolCalls,
      handle.providerMetadata,
    ]);
    const toolUses = toolCalls.map((call) => ({ id: call.toolCallId, name: call.toolName, input: call.input }));
    yield {
      type: 'done',
      result: {
        text,
        toolUses,
        stopReason: stopReasonOf(finishReason, toolUses.length),
        usage: usageOf(usage, metadata),
        provider: target.provider,
        model: target.model,
      },
    };
  } catch (raw) {
    throw toLlmError(raw, target.provider);
  }
}

/**
 * Structured output. `schema` is plain JSON Schema, so no schema library leaks
 * into the dependency list or into a call site. The path is generateText with
 * Output.object: generateObject is deprecated in the current AI SDK major, and
 * on anthropic this still lands as a forced tool call, which is what that
 * vendor answers structured requests with.
 */
export async function completeObject<T = unknown>(
  req: LlmRequest,
  schema: Record<string, unknown>,
): Promise<LlmObjectResult<T>> {
  const resolved = resolveModel(req.role);

  return runChain(resolved, async (target, signal) => {
    if (target.provider === 'stub') {
      const result = stubComplete({ ...resolved, ...target }, req, 'object');
      return { ...result, object: parseObject<T>(result.text) };
    }

    const result = await generateText({
      ...baseCallOptions(resolved, target, { ...req, json: true }, linked(signal, req.signal)),
      experimental_output: Output.object<T>({
        schema: jsonSchema<T>(schema as Parameters<typeof jsonSchema>[0]),
      }),
    });

    const object = result.experimental_output;
    return {
      text: JSON.stringify(object),
      object,
      toolUses: [],
      stopReason: stopReasonOf(result.finishReason, 0),
      usage: usageOf(result.usage, result.providerMetadata),
      provider: target.provider,
      model: target.model,
    } satisfies LlmObjectResult<T>;
  });
}

function parseObject<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new LlmError('Stub fixture for completeObject is not JSON.', {
      kind: 'bad_request',
      provider: 'stub',
      cause,
    });
  }
}
