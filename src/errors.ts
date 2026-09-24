import type { LlmErrorKind } from './types.ts';

export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly status?: number;
  readonly provider: string;
  readonly retryable: boolean;

  constructor(
    message: string,
    opts: { kind: LlmErrorKind; status?: number; provider: string; retryable?: boolean; cause?: unknown },
  ) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = 'LlmError';
    this.kind = opts.kind;
    this.status = opts.status;
    this.provider = opts.provider;
    this.retryable = opts.retryable ?? RETRYABLE_KINDS.has(opts.kind);
  }
}

const RETRYABLE_KINDS = new Set<LlmErrorKind>(['rate_limit', 'overloaded', 'unavailable']);

export function kindForStatus(status: number | undefined): LlmErrorKind {
  if (status === undefined) return 'unknown';
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status === 503 || status === 529) return 'overloaded';
  if (status >= 400 && status < 500) return 'bad_request';
  if (status >= 500) return 'unavailable';
  return 'unknown';
}

/**
 * Capacity failures worth retrying on LLM_FALLBACK_<ROLE>. A 404 counts because
 * that is how every provider answers a model id it has retired.
 */
export function isCapacityFailure(error: LlmError): boolean {
  return error.status === 429 || error.status === 503 || error.status === 529 || error.status === 404;
}
