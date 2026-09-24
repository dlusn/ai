// A Next app router route handler, exactly as a product repo would write one.
// Note what is absent: no vendor SDK, no model id, no retry, no provider field.

import { complete, LlmError } from '@dlusn/ai';
import { costOf } from '@dlusn/ai/pricing';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  const { question } = (await request.json()) as { question: string };

  try {
    const result = await complete({
      role: 'chat',
      system: 'Answer in one sentence.',
      messages: [{ role: 'user', content: question }],
      maxTokens: 512,
      cache: true,
    });

    return Response.json({
      text: result.text,
      model: result.model,
      provider: result.provider,
      usd: costOf(result, {
        onUnpriced: (pair) => console.warn('unpriced model pair', pair.provider, pair.model),
      }),
    });
  } catch (error) {
    if (error instanceof LlmError) {
      return Response.json({ error: error.kind, retryable: error.retryable }, { status: error.status ?? 500 });
    }
    throw error;
  }
}
