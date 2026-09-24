// complete, stream and completeObject. Capacity fallback lives here once, so no
// route or edge function ever writes a retry.

import { generateObject, generateText, jsonSchema, streamText, type FinishReason } from 'ai';

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
import { LlmError, isCapacityFailure } from './errors.ts';
import { resolveModel } from './registry.ts';
import type {
  LlmChunk,
  LlmObjectResult,
  LlmRequest,
  LlmResult,
  LlmStopReason,
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

function baseCallOptions(resolved: ResolvedModel, req: LlmRequest, modelId: string) {
  return {
    model: languageModel(resolved, modelId),
    system: req.system,
    messages: toModelMessages(req.messages),
    maxOutputTokens: req.maxTokens,
    // One retry policy, in one place. The SDK's own backoff would hide a
    // capacity failure behind several slow attempts before the fallback id
    // ever gets a turn, so the seam does the single retry itself.
    maxRetries: 0,
    ...(req.temperature === undefined ? {} : { temperature: req.temperature }),
    ...(req.signal ? { abortSignal: req.signal } : {}),
    ...(() => {
      const options = toProviderOptions(resolved.provider, req, resolved.capabilities);
      return options ? { providerOptions: options } : {};
    })(),
  };
}

/**
 * Run `attempt` on the resolved model, and once more on LLM_FALLBACK_<ROLE> if
 * the first id is out of capacity or gone (429, 503, 529, 404).
 */
async function withFallback<T>(
  resolved: ResolvedModel,
  attempt: (modelId: string) => Promise<T>,
): Promise<T> {
  try {
    return await attempt(resolved.model);
  } catch (raw) {
    const error = toLlmError(raw, resolved.provider);
    if (!resolved.fallback || resolved.fallback === resolved.model || !isCapacityFailure(error)) throw error;
    try {
      return await attempt(resolved.fallback);
    } catch (fallbackRaw) {
      throw toLlmError(fallbackRaw, resolved.provider);
    }
  }
}

/** One turn, text and tool uses. */
export async function complete(req: LlmRequest): Promise<LlmResult> {
  const resolved = resolveModel(req.role);
  if (resolved.provider === 'stub') return stubComplete(resolved, req);

  return withFallback(resolved, async (modelId) => {
    const result = await generateText({
      ...baseCallOptions(resolved, req, modelId),
      ...(() => {
        const tools = toToolSet(req.tools);
        if (!tools) return {};
        const choice = toToolChoice(req.toolChoice);
        return { tools, ...(choice ? { toolChoice: choice } : {}) };
      })(),
    });

    const toolUses = result.toolCalls.map((call) => ({ name: call.toolName, input: call.input }));
    return {
      text: result.text,
      toolUses,
      stopReason: stopReasonOf(result.finishReason, toolUses.length),
      usage: usageOf(result.usage, result.providerMetadata),
      provider: resolved.provider,
      model: modelId,
    } satisfies LlmResult;
  });
}

/**
 * Streaming turn. Yields text chunks and tool uses as they arrive, then one
 * final `done` chunk carrying the same LlmResult complete would have returned.
 */
export async function* stream(req: LlmRequest): AsyncIterable<LlmChunk> {
  const resolved = resolveModel(req.role);

  if (resolved.provider === 'stub') {
    const result = stubComplete(resolved, req, 'stream');
    if (result.text) yield { type: 'text', text: result.text };
    for (const use of result.toolUses) yield { type: 'tool', name: use.name, input: use.input };
    yield { type: 'done', result };
    return;
  }

  // A stream cannot be retried once bytes are out, so the fallback applies to
  // opening the stream only.
  const opened = await withFallback(resolved, async (modelId) => {
    const handle = streamText({
      ...baseCallOptions(resolved, req, modelId),
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
    return { handle, iterator, first, modelId };
  });

  const { handle, iterator, first, modelId } = opened;
  try {
    for (let step = first; !step.done; step = await iterator.next()) {
      const part = step.value;
      if (part.type === 'text-delta') yield { type: 'text', text: part.text };
      else if (part.type === 'tool-call') yield { type: 'tool', name: part.toolName, input: part.input };
      else if (part.type === 'error') throw part.error;
    }

    const [text, finishReason, usage, toolCalls, metadata] = await Promise.all([
      handle.text,
      handle.finishReason,
      handle.usage,
      handle.toolCalls,
      handle.providerMetadata,
    ]);
    const toolUses = toolCalls.map((call) => ({ name: call.toolName, input: call.input }));
    yield {
      type: 'done',
      result: {
        text,
        toolUses,
        stopReason: stopReasonOf(finishReason, toolUses.length),
        usage: usageOf(usage, metadata),
        provider: resolved.provider,
        model: modelId,
      },
    };
  } catch (raw) {
    throw toLlmError(raw, resolved.provider);
  }
}

/**
 * Structured output. `schema` is plain JSON Schema, so no schema library leaks
 * into the dependency list or into a call site.
 */
export async function completeObject<T = unknown>(
  req: LlmRequest,
  schema: Record<string, unknown>,
): Promise<LlmObjectResult<T>> {
  const resolved = resolveModel(req.role);

  if (resolved.provider === 'stub') {
    const result = stubComplete(resolved, req, 'object');
    return { ...result, object: parseObject<T>(result.text) };
  }

  return withFallback(resolved, async (modelId) => {
    const result = await generateObject({
      ...baseCallOptions(resolved, { ...req, json: true }, modelId),
      schema: jsonSchema<T>(schema as Parameters<typeof jsonSchema>[0]),
    });

    return {
      text: JSON.stringify(result.object),
      object: result.object,
      toolUses: [],
      stopReason: stopReasonOf(result.finishReason, 0),
      usage: usageOf(result.usage, result.providerMetadata),
      provider: resolved.provider,
      model: modelId,
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
