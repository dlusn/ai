// The Deno importability gate. If this file checks, an edge function can import
// the package. It touches every export so a Node only API in any of them fails
// here before it ever reaches a deployment.

import { complete, completeObject, stream, resolveModel, REGISTRY, LlmError } from '@dlusn/ai';
import type { LlmRequest, LlmResult } from '@dlusn/ai';
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

  const result = await complete(request);
  void costOf(result);
  void costBreakdown(result);
  void stubCalls();
  void new LlmError('check', { kind: 'unknown', provider: 'stub' });
  resetStub();
  return result;
}
