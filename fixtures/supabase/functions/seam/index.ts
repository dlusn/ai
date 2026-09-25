// A real Supabase edge function, deployable as written. It runs on the stub
// provider so the boot proof needs no vendor key and books no cost: what it
// proves is that the package, its four AI SDK dependencies and the gateway
// package all import and execute inside the Supabase edge runtime.
//
// It needs LLM_PROVIDER=stub and nothing else.
//
// Supabase edge runtime, from fixtures/supabase (the worktree lives under
// $HOME, so the Colima bind mount sees it):
//
//   supabase start
//   supabase functions serve seam --no-verify-jwt --env-file .env.boot
//   curl -s -X POST http://127.0.0.1:54321/functions/v1/seam \
//     -H 'content-type: application/json' -d '{"text":"nineteen at Tuggerah"}'
//
// Plain Deno, no Docker: `node scripts/boot-proof.mjs`.

import { complete, completeObject } from '@dlusn/ai';
import { costOf } from '@dlusn/ai/pricing';
import { resetStub, setStubFixtures } from '@dlusn/ai/stub';

const SCHEMA = {
  type: 'object',
  properties: { label: { type: 'string' }, confident: { type: 'boolean' } },
  required: ['label', 'confident'],
  additionalProperties: false,
};

export async function handler(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { text?: string };
  const said = body.text ?? '';

  setStubFixtures({
    triage: 'count',
    extract: JSON.stringify({ label: 'count', confident: true }),
  });

  try {
    const triaged = await complete({
      role: 'triage',
      system: 'Classify the message in one word.',
      messages: [{ role: 'user', content: said }],
      maxTokens: 32,
    });

    const { object } = await completeObject<{ label: string; confident: boolean }>(
      {
        role: 'extract',
        system: 'Extract the label.',
        messages: [{ role: 'user', content: said }],
        maxTokens: 64,
      },
      SCHEMA,
    );

    return Response.json({
      ok: true,
      said,
      label: triaged.text,
      object,
      provider: triaged.provider,
      model: triaged.model,
      usd: costOf(triaged),
      runtime: 'Deno' in globalThis ? 'deno' : 'node',
    });
  } finally {
    resetStub();
  }
}

// Only serve when this really is running inside Deno, so the same file can be
// imported by a Node test. PORT is for the local boot proof, Supabase sets its
// own port when it serves the function.
const deno = (
  globalThis as {
    Deno?: {
      serve(options: { port: number }, handler: (request: Request) => Promise<Response>): unknown;
      env?: { get(key: string): string | undefined };
    };
  }
).Deno;
if (deno && import.meta.main) {
  deno.serve({ port: Number(deno.env?.get('PORT') ?? 8000) }, handler);
}
