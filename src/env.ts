// Runtime neutral env read. Works in Deno edge functions, Next routes and Node
// scripts without importing anything Node only.

type EnvHost = {
  Deno?: { env?: { get(key: string): string | undefined } };
  process?: { env?: Record<string, string | undefined> };
};

export function env(key: string): string | undefined {
  const host = globalThis as unknown as EnvHost;
  const fromDeno = host.Deno?.env?.get?.(key);
  if (fromDeno !== undefined && fromDeno !== '') return fromDeno;
  const fromNode = host.process?.env?.[key];
  if (fromNode !== undefined && fromNode !== '') return fromNode;
  return undefined;
}

/** First env var that is set, in order. */
export function envFirst(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = env(key);
    if (value !== undefined) return value;
  }
  return undefined;
}
