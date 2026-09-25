// One structured line per chain hop and per breaker transition. A deployment
// that wants these in its own log pipeline swaps the sink, it never parses
// console output.

import type { LlmLogEvent } from './types.ts';

let sink: (event: LlmLogEvent) => void = (event) => {
  console.warn(JSON.stringify(event));
};

/** Replace the sink. Pass undefined to go back to one JSON line on console.warn. */
export function setLlmLogger(next?: (event: LlmLogEvent) => void): void {
  sink = next ?? ((event) => console.warn(JSON.stringify(event)));
}

export function logLlm(event: LlmLogEvent): void {
  // A broken logger must never take a request down with it.
  try {
    sink(event);
  } catch {
    // ponytail: swallowed on purpose, a log sink is not in the request contract
  }
}
