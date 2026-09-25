// The Deno importability gate. If this file checks, an edge function can import
// the package. It touches every export so a Node only API in any of them fails
// here before it ever reaches a deployment.

import { complete, completeObject, stream, resolveModel, REGISTRY, LlmError } from '@dlusn/ai';
import type { LlmRequest, LlmResult, LlmToolResultPart, LlmToolUsePart } from '@dlusn/ai';
import { synthesize, transcribe, sttProvider, ttsProvider } from '@dlusn/ai/speech';
import { costOf, costBreakdown, priceFor } from '@dlusn/ai/pricing';
import { resetStub, setStubFixtures, stubCalls, setSpeechStub } from '@dlusn/ai/stub';

export async function checkEverything(): Promise<LlmResult> {
  const request: LlmRequest = {
    role: 'chat',
    system: 'check',
    messages: [{ role: 'user', content: 'check' }],
    maxTokens: 16,
  };

  setStubFixtures({ chat: 'ok', extract: '{"ok":true}' });
  setSpeechStub({ transcribe: 'ok', synthesize: 'ok' });

  resolveModel('chat');
  void REGISTRY.anthropic.best;
  void priceFor('anthropic', 'claude-sonnet-5');
  void sttProvider();
  void ttsProvider();

  for await (const chunk of stream(request)) void chunk;
  await completeObject(request, { type: 'object' });
  await transcribe({ data: new Uint8Array(1), mime: 'audio/wav' });
  await synthesize('ok', 'voice-abc');

  // The tool round trip, so an edge function that runs a tool loop is covered
  // by this gate too and not only by the vitest suite.
  const use: LlmToolUsePart = { type: 'tool_use', id: 'call_1', name: 'check', input: {} };
  const answer: LlmToolResultPart = { type: 'tool_result', toolUseId: 'call_1', content: 'ok' };
  await complete({
    ...request,
    messages: [
      { role: 'user', content: 'check' },
      { role: 'assistant', content: [use] },
      { role: 'user', content: [answer] },
    ],
    tools: [{ name: 'check', inputSchema: { type: 'object' } }],
  });

  const result = await complete(request);
  void costOf(result);
  void costBreakdown(result);
  void stubCalls();
  void new LlmError('check', { kind: 'unknown', provider: 'stub' });
  resetStub();
  return result;
}
