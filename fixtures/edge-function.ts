// A Supabase edge function, exactly as a product repo would write one. Deno
// resolves the package and its dependencies through the imports map in
// deno.json, so nothing here is Node only.

import { complete } from '@dlusn/ai';
import { transcribe } from '@dlusn/ai/speech';

export async function handler(request: Request): Promise<Response> {
  const form = await request.formData();
  const file = form.get('audio');

  const said =
    file instanceof Blob
      ? (await transcribe({ data: file, mime: file.type || 'audio/m4a' }, { keyterms: ['Tuggerah', 'Erina Fair'] })).text
      : String(form.get('text') ?? '');

  const result = await complete({
    role: 'triage',
    system: 'Classify the message in one word.',
    messages: [{ role: 'user', content: said }],
    maxTokens: 32,
  });

  return new Response(JSON.stringify({ said, label: result.text, model: result.model }), {
    headers: { 'content-type': 'application/json' },
  });
}

// Only serve when this really is running inside Deno, so the same file can be
// imported by a Node test.
const deno = (globalThis as { Deno?: { serve(h: (r: Request) => Promise<Response>): unknown } }).Deno;
if (deno && import.meta.main) deno.serve(handler);
