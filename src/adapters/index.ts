// The only place a vendor SDK is imported and the only place a vendor specific
// request field is written. Call sites never see providerOptions.

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGateway } from '@ai-sdk/gateway';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import {
  APICallError,
  jsonSchema,
  tool,
  type LanguageModel,
  type JSONValue,
  type ModelMessage,
  type ToolResultPart,
  type ToolSet,
} from 'ai';

import { LlmError, kindForStatus } from '../errors.ts';
import type {
  LlmMessage,
  LlmPart,
  LlmProvider,
  LlmRequest,
  LlmTarget,
  LlmTextPart,
  LlmToolResultPart,
} from '../types.ts';

/**
 * Give up on a target that has not sent a first byte in `connectMs`. The abort
 * lands before the SDK has parsed anything, so the chain can move on while the
 * dead host is still deciding whether to answer.
 */
export function connectTimeoutFetch(connectMs: number, provider: string): typeof globalThis.fetch {
  return (async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    const controller = new AbortController();
    const outer = init?.signal as AbortSignal | undefined;
    const relay = () => controller.abort(outer?.reason);
    if (outer) {
      if (outer.aborted) relay();
      else outer.addEventListener('abort', relay, { once: true });
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    // Raced rather than left to the abort, because a host that accepts the
    // socket and then says nothing never rejects on its own. A retryable
    // LlmError, not a bare abort: the chain has to be able to tell "this host
    // is dead" from "the caller cancelled".
    const expiry = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(
          new LlmError(`No first byte in ${connectMs}ms.`, {
            kind: 'unavailable',
            provider,
            retryable: true,
          }),
        );
      }, connectMs);
    });

    try {
      // globalThis.fetch is read per call so a test double installed after the
      // model handle was built still sees the request.
      return await Promise.race([globalThis.fetch(input, { ...init, signal: controller.signal }), expiry]);
    } finally {
      clearTimeout(timer);
      outer?.removeEventListener('abort', relay);
    }
  }) as typeof globalThis.fetch;
}

/** Build the vendor model handle for one chain target. */
export function languageModel(target: LlmTarget, modelId: string, connectMs?: number): LanguageModel {
  const { provider, apiKey, baseURL } = target;
  const fetchOption = connectMs ? { fetch: connectTimeoutFetch(connectMs, provider) } : {};
  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey, ...(baseURL ? { baseURL } : {}), ...fetchOption })(modelId);
    case 'openai':
      return createOpenAI({ apiKey, ...(baseURL ? { baseURL } : {}), ...fetchOption })(modelId);
    case 'openai-compatible':
      // One compatible endpoint covers OpenRouter, Groq, Ollama, Mistral, a
      // vLLM rig and anything else that speaks the chat completions shape.
      // `.chat()` is deliberate: the bare factory defaults to the responses API.
      return createOpenAI({ apiKey: apiKey ?? 'not-needed', baseURL, ...fetchOption }).chat(modelId);
    case 'google':
      return createGoogleGenerativeAI({ apiKey, ...(baseURL ? { baseURL } : {}), ...fetchOption })(modelId);
    case 'gateway':
      // The broker. Model ids are vendor/model and the key is AI_GATEWAY_API_KEY.
      return createGateway({ apiKey, ...(baseURL ? { baseURL } : {}), ...fetchOption })(modelId);
    default:
      throw new LlmError(`Provider "${provider}" has no language model adapter.`, {
        kind: 'bad_request',
        provider,
      });
  }
}

function badPart(message: string): LlmError {
  return new LlmError(message, { kind: 'bad_request', provider: 'none' });
}

/** A user facing part: text or an image. */
function toUserPart(part: LlmPart) {
  if (part.type === 'text') return { type: 'text' as const, text: part.text };
  if (part.type === 'image') {
    if (part.base64) {
      return { type: 'image' as const, image: part.base64, mediaType: part.mime ?? 'image/jpeg' };
    }
    if (part.url) {
      return { type: 'image' as const, image: new URL(part.url), ...(part.mime ? { mediaType: part.mime } : {}) };
    }
    throw badPart('An image part needs base64 or url.');
  }
  throw badPart(`A user turn carries text, image and tool_result parts only, not "${part.type}".`);
}

/** An assistant facing part: text or a tool call. */
function toAssistantPart(part: LlmPart) {
  if (part.type === 'text') return { type: 'text' as const, text: part.text };
  if (part.type === 'tool_use') {
    return { type: 'tool-call' as const, toolCallId: part.id, toolName: part.name, input: part.input };
  }
  throw badPart(`An assistant turn carries text and tool_use parts only, not "${part.type}".`);
}

/** The inside of a tool_result that arrived as parts rather than a string. */
function toToolContentPart(part: LlmPart) {
  if (part.type === 'text') return { type: 'text' as const, text: part.text };
  if (part.type === 'image' && part.base64) {
    return { type: 'media' as const, data: part.base64, mediaType: part.mime ?? 'image/jpeg' };
  }
  throw badPart('A tool_result part array carries text and base64 image parts only.');
}

function toToolOutput(part: LlmToolResultPart): ToolResultPart['output'] {
  if (typeof part.content === 'string') {
    return part.isError ? { type: 'error-text', value: part.content } : { type: 'text', value: part.content };
  }
  // A failed tool goes over as JSON rather than being flattened to a string,
  // because the model reads the failure better with its shape intact.
  if (part.isError) return { type: 'error-json', value: part.content as unknown as JSONValue };
  return { type: 'content', value: part.content.map(toToolContentPart) };
}

/**
 * The AI SDK tool result part wants the tool's name as well as the call id, and
 * the contract part carries only the id. Recover the name from the tool_use the
 * id points at, which is in the same conversation by definition.
 */
function toolNamesById(messages: LlmMessage[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const message of messages) {
    if (typeof message.content === 'string') continue;
    for (const part of message.content) {
      if (part.type === 'tool_use') names.set(part.id, part.name);
    }
  }
  return names;
}

function isToolResult(part: LlmPart): part is LlmToolResultPart {
  return part.type === 'tool_result';
}

function allText(parts: LlmPart[]): parts is LlmTextPart[] {
  return parts.every((part) => part.type === 'text');
}

/**
 * Contract messages to AI SDK messages. Images, tool calls and tool results all
 * become vendor parts here. A tool_result is its own role in the AI SDK shape,
 * so one contract turn can split into a tool message and a user message, in
 * that order: the vendors all want the answer before whatever the caller said
 * about it.
 */
export function toModelMessages(messages: LlmMessage[]): ModelMessage[] {
  const names = toolNamesById(messages);
  const out: ModelMessage[] = [];

  for (const message of messages) {
    if (typeof message.content === 'string') {
      out.push({ role: message.role, content: message.content } as ModelMessage);
      continue;
    }

    const results = message.content.filter(isToolResult);
    if (results.length) {
      out.push({
        role: 'tool',
        content: results.map((part) => {
          const toolName = names.get(part.toolUseId);
          if (!toolName) {
            throw badPart(
              `tool_result "${part.toolUseId}" has no matching tool_use earlier in the conversation.`,
            );
          }
          return { type: 'tool-result', toolCallId: part.toolUseId, toolName, output: toToolOutput(part) };
        }),
      });
    }

    const rest = message.content.filter((part) => !isToolResult(part));
    if (rest.length === 0) continue;

    if (message.role === 'assistant') {
      // A text only assistant turn stays a plain string, exactly as it was
      // before tool parts existed, so no v0.2 caller sees a new wire shape.
      const content = allText(rest) ? rest.map((part) => part.text).join('') : rest.map(toAssistantPart);
      out.push({ role: 'assistant', content } as ModelMessage);
      continue;
    }

    out.push({ role: 'user', content: rest.map(toUserPart) } as ModelMessage);
  }

  return out;
}

export function toToolSet(tools: LlmRequest['tools']): ToolSet | undefined {
  if (!tools || tools.length === 0) return undefined;
  const set: ToolSet = {};
  for (const t of tools) {
    set[t.name] = tool({
      ...(t.description ? { description: t.description } : {}),
      inputSchema: jsonSchema(t.inputSchema as Parameters<typeof jsonSchema>[0]),
    });
  }
  return set;
}

export function toToolChoice(choice: LlmRequest['toolChoice']) {
  if (choice === undefined) return undefined;
  if (typeof choice === 'string') return choice;
  return { type: 'tool' as const, toolName: choice.name };
}

/**
 * Vendor specifics live here and nowhere else. Anything a provider does not
 * support is silently skipped, per the contract.
 */
export function toProviderOptions(
  provider: LlmProvider,
  req: LlmRequest,
  supports: { caching: boolean; thinking: boolean },
  modelId = '',
): Record<string, Record<string, JSONValue>> | undefined {
  const thinkingBudget = typeof req.thinking === 'object' ? req.thinking.budgetTokens : undefined;
  const wantsThinking = req.thinking === true || typeof req.thinking === 'object';

  if (provider === 'gateway') {
    // The broker forwards a namespaced options block to whatever vendor the
    // `vendor/model` id names, so reuse that vendor's branch verbatim.
    const vendor = modelId.split('/')[0] ?? '';
    const known: LlmProvider[] = ['anthropic', 'openai', 'google'];
    if (!known.includes(vendor as LlmProvider)) return undefined;
    return toProviderOptions(vendor as LlmProvider, req, supports);
  }

  if (provider === 'anthropic') {
    const options: Record<string, JSONValue> = {};
    if (supports.caching && req.cache) options.cacheControl = { type: 'ephemeral' };
    if (supports.thinking && wantsThinking) {
      options.thinking = { type: 'enabled', ...(thinkingBudget ? { budgetTokens: thinkingBudget } : {}) };
    }
    return Object.keys(options).length ? { anthropic: options } : undefined;
  }

  if (provider === 'openai' || provider === 'openai-compatible') {
    const options: Record<string, JSONValue> = {};
    // OpenAI caches prompts automatically, so caching maps to the effort dial
    // only. Thinking maps to reasoning effort, the nearest equivalent.
    if (supports.thinking && wantsThinking) options.reasoningEffort = thinkingBudget && thinkingBudget > 8_000 ? 'high' : 'medium';
    if (req.json) options.structuredOutputs = true;
    return Object.keys(options).length ? { openai: options } : undefined;
  }

  if (provider === 'google') {
    const options: Record<string, JSONValue> = {};
    if (supports.thinking && wantsThinking) {
      options.thinkingConfig = { thinkingBudget: thinkingBudget ?? -1 };
    }
    return Object.keys(options).length ? { google: options } : undefined;
  }

  return undefined;
}

/**
 * Cache write tokens are not part of the AI SDK usage shape, so read them out
 * of provider metadata here rather than at a call site.
 */
export function cacheWriteTokens(metadata: unknown): number {
  const meta = metadata as Record<string, Record<string, unknown>> | undefined;
  const candidates = [
    meta?.anthropic?.cacheCreationInputTokens,
    meta?.openai?.cacheCreationInputTokens,
    meta?.google?.cacheCreationInputTokens,
  ];
  for (const value of candidates) {
    if (typeof value === 'number') return value;
  }
  return 0;
}

/** Any thrown value to a contract LlmError. */
export function toLlmError(error: unknown, provider: string): LlmError {
  if (error instanceof LlmError) return error;
  if (APICallError.isInstance(error)) {
    const status = error.statusCode;
    return new LlmError(error.message, {
      kind: kindForStatus(status),
      status,
      provider,
      retryable: error.isRetryable,
      cause: error,
    });
  }
  // The gateway throws its own error class, not APICallError, but it carries
  // the same two fields. Duck type rather than import six error classes.
  const withStatus = error as { statusCode?: unknown; isRetryable?: unknown; message?: unknown };
  if (typeof withStatus?.statusCode === 'number') {
    return new LlmError(String(withStatus.message ?? 'gateway error'), {
      kind: kindForStatus(withStatus.statusCode),
      status: withStatus.statusCode,
      provider,
      ...(typeof withStatus.isRetryable === 'boolean' ? { retryable: withStatus.isRetryable } : {}),
      cause: error,
    });
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return new LlmError(error.message, { kind: 'bad_request', provider, retryable: false, cause: error });
  }
  return new LlmError(error instanceof Error ? error.message : String(error), {
    kind: 'unknown',
    provider,
    retryable: false,
    cause: error,
  });
}
