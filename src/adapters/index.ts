// The only place a vendor SDK is imported and the only place a vendor specific
// request field is written. Call sites never see providerOptions.

import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import {
  APICallError,
  jsonSchema,
  tool,
  type LanguageModel,
  type JSONValue,
  type ModelMessage,
  type ToolSet,
} from 'ai';

import { LlmError, kindForStatus } from '../errors.ts';
import type { LlmMessage, LlmProvider, LlmRequest, ResolvedModel } from '../types.ts';

/** Build the vendor model handle for a resolved role. */
export function languageModel(resolved: ResolvedModel, modelId: string): LanguageModel {
  const { provider, apiKey, baseURL } = resolved;
  switch (provider) {
    case 'anthropic':
      return createAnthropic({ apiKey, ...(baseURL ? { baseURL } : {}) })(modelId);
    case 'openai':
      return createOpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) })(modelId);
    case 'openai-compatible':
      // One compatible endpoint covers OpenRouter, Groq, Ollama, Mistral and
      // anything else that speaks the chat completions shape.
      return createOpenAI({ apiKey: apiKey ?? 'not-needed', baseURL }).chat(modelId);
    case 'google':
      return createGoogleGenerativeAI({ apiKey, ...(baseURL ? { baseURL } : {}) })(modelId);
    default:
      throw new LlmError(`Provider "${provider}" has no language model adapter.`, {
        kind: 'bad_request',
        provider,
      });
  }
}

/** Contract messages to AI SDK messages. Images become vendor parts here. */
export function toModelMessages(messages: LlmMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if (typeof message.content === 'string') {
      return { role: message.role, content: message.content } as ModelMessage;
    }
    const parts = message.content.map((part) => {
      if (part.type === 'text') return { type: 'text' as const, text: part.text };
      if (part.base64) {
        return { type: 'image' as const, image: part.base64, mediaType: part.mime ?? 'image/jpeg' };
      }
      if (part.url) {
        return { type: 'image' as const, image: new URL(part.url), ...(part.mime ? { mediaType: part.mime } : {}) };
      }
      throw new LlmError('An image part needs base64 or url.', { kind: 'bad_request', provider: 'none' });
    });
    if (message.role === 'assistant') {
      // Assistant turns carry text only in this contract.
      const text = parts.map((p) => ('text' in p ? p.text : '')).join('');
      return { role: 'assistant', content: text } as ModelMessage;
    }
    return { role: 'user', content: parts } as ModelMessage;
  });
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
): Record<string, Record<string, JSONValue>> | undefined {
  const thinkingBudget = typeof req.thinking === 'object' ? req.thinking.budgetTokens : undefined;
  const wantsThinking = req.thinking === true || typeof req.thinking === 'object';

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
