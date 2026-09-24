import { afterEach, describe, expect, it } from 'vitest';

import { LlmError } from '../src/errors.ts';
import { REGISTRY, ROLE_TIERS, resolveModel, rowFor } from '../src/registry.ts';
import { LLM_ROLES, type LlmProvider, type LlmRole, type LlmTier } from '../src/types.ts';
import { clearEnv, setEnv } from './env.ts';

afterEach(clearEnv);

describe('resolve matrix', () => {
  const cases: { provider: LlmProvider; env: Record<string, string>; expect: Record<LlmRole, string> }[] = [
    {
      provider: 'anthropic',
      env: { LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'k' },
      expect: {
        chat: 'claude-opus-5-5',
        draft: 'claude-sonnet-5',
        vision: 'claude-sonnet-5',
        extract: 'claude-haiku-4-5',
        triage: 'claude-haiku-4-5',
      },
    },
    {
      provider: 'openai',
      env: { LLM_PROVIDER: 'openai', OPENAI_API_KEY: 'k' },
      expect: { chat: 'gpt-5', draft: 'gpt-5-mini', vision: 'gpt-5-mini', extract: 'gpt-5-nano', triage: 'gpt-5-nano' },
    },
    {
      provider: 'google',
      env: { LLM_PROVIDER: 'google', GOOGLE_API_KEY: 'k' },
      expect: {
        chat: 'gemini-2.5-pro',
        draft: 'gemini-2.5-flash',
        vision: 'gemini-2.5-flash',
        extract: 'gemini-2.5-flash-lite',
        triage: 'gemini-2.5-flash-lite',
      },
    },
    {
      provider: 'stub',
      env: { LLM_PROVIDER: 'stub' },
      expect: { chat: 'stub-best', draft: 'stub-standard', vision: 'stub-standard', extract: 'stub-fast', triage: 'stub-fast' },
    },
  ];

  for (const testCase of cases) {
    it(`${testCase.provider} maps every role to its tier`, () => {
      for (const role of LLM_ROLES) {
        setEnv(testCase.env);
        const resolved = resolveModel(role);
        expect(resolved.provider).toBe(testCase.provider);
        expect(resolved.tier).toBe(ROLE_TIERS[role]);
        expect(resolved.model).toBe(testCase.expect[role]);
      }
    });
  }

  it('defaults to anthropic when LLM_PROVIDER is unset', () => {
    setEnv({ ANTHROPIC_API_KEY: 'k' });
    expect(resolveModel('chat').provider).toBe('anthropic');
  });

  it('lets LLM_MODEL_<ROLE> win over the registry default', () => {
    setEnv({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'k', LLM_MODEL_EXTRACT: 'pinned-id' });
    expect(resolveModel('extract').model).toBe('pinned-id');
    expect(resolveModel('chat').model).toBe(REGISTRY.anthropic.best?.model);
  });

  it('reads LLM_FALLBACK_<ROLE>', () => {
    setEnv({ LLM_PROVIDER: 'anthropic', LLM_API_KEY: 'k', LLM_FALLBACK_CHAT: 'backup-id' });
    expect(resolveModel('chat').fallback).toBe('backup-id');
    expect(resolveModel('draft').fallback).toBeUndefined();
  });

  it('falls back from LLM_API_KEY to the vendor key name', () => {
    setEnv({ LLM_PROVIDER: 'google', GOOGLE_API_KEY: 'from-google-var' });
    expect(resolveModel('chat').apiKey).toBe('from-google-var');
    setEnv({ LLM_PROVIDER: 'google', LLM_API_KEY: 'from-generic-var', GOOGLE_API_KEY: 'from-google-var' });
    expect(resolveModel('chat').apiKey).toBe('from-generic-var');
  });
});

describe('resolve time failures', () => {
  it('throws on an unknown role before any call is made', () => {
    setEnv({ LLM_PROVIDER: 'stub' });
    expect(() => resolveModel('summarise' as LlmRole)).toThrowError(LlmError);
    expect(() => resolveModel('summarise' as LlmRole)).toThrowError(/Unknown LLM role/);
  });

  it('throws on an unknown provider', () => {
    setEnv({ LLM_PROVIDER: 'mystery', LLM_API_KEY: 'k' });
    expect(() => resolveModel('chat')).toThrowError(/Unknown LLM_PROVIDER/);
  });

  it('needs LLM_BASE_URL for openai-compatible', () => {
    setEnv({ LLM_PROVIDER: 'openai-compatible', LLM_API_KEY: 'k', LLM_MODEL_CHAT: 'house-model-1' });
    expect(() => resolveModel('chat')).toThrowError(/LLM_BASE_URL/);
  });

  it('needs LLM_MODEL_<ROLE> for openai-compatible, which has no honest default', () => {
    setEnv({ LLM_PROVIDER: 'openai-compatible', LLM_API_KEY: 'k', LLM_BASE_URL: 'https://models.internal.test/v1' });
    expect(() => resolveModel('chat')).toThrowError(/LLM_MODEL_CHAT/);
  });

  it('needs a key for every provider but the stub', () => {
    setEnv({ LLM_PROVIDER: 'anthropic' });
    expect(() => resolveModel('chat')).toThrowError(/No API key/);
    setEnv({ LLM_PROVIDER: 'stub' });
    expect(() => resolveModel('chat')).not.toThrow();
  });
});

describe('registry rows', () => {
  it('prices every row in USD per million tokens with one currency', () => {
    for (const provider of Object.keys(REGISTRY) as LlmProvider[]) {
      for (const tier of ['fast', 'standard', 'best'] as LlmTier[]) {
        const row = REGISTRY[provider][tier];
        if (!row) continue;
        expect(row.provider).toBe(provider);
        expect(Object.keys(row.price).sort()).toEqual(['cacheRead', 'cacheWrite', 'input', 'output']);
        expect(Object.keys(row.capabilities).sort()).toEqual([
          'caching',
          'contextTokens',
          'maxOutput',
          'structuredOutput',
          'thinking',
          'tools',
          'vision',
        ]);
        expect(row.price.output).toBeGreaterThanOrEqual(row.price.input);
      }
    }
  });

  it('looks a row up by provider and model', () => {
    expect(rowFor('anthropic', 'claude-sonnet-5')?.capabilities.caching).toBe(true);
    expect(rowFor('anthropic', 'not-a-model')).toBeUndefined();
    expect(rowFor('nowhere', 'anything')).toBeUndefined();
  });
});
