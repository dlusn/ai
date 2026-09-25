#!/usr/bin/env node
// Boot the edge function fixture in a real Deno process and put one request
// through it. Proves the package, the four AI SDK packages and the gateway
// package import and execute outside Node, with no vendor key and no cost.
//
// The Supabase edge runtime container is a separate, stricter pass:
//   supabase start && supabase functions serve seam --no-verify-jwt
import { spawn } from 'node:child_process';

const PORT = Number(process.env.PORT ?? 8787);
const ENTRY = 'fixtures/supabase/functions/seam/index.ts';

const child = spawn('deno', ['run', '--allow-net', '--allow-env', '--config', 'deno.json', ENTRY], {
  // The stub provider is what makes this free and keyless.
  env: { ...process.env, PORT: String(PORT), LLM_PROVIDER: 'stub' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let log = '';
child.stdout.on('data', (chunk) => (log += chunk));
child.stderr.on('data', (chunk) => (log += chunk));

const stop = () => child.kill('SIGTERM');
process.on('exit', stop);

async function waitForBoot(deadline) {
  while (Date.now() < deadline) {
    try {
      const probe = await fetch(`http://127.0.0.1:${PORT}/`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'boot probe' }),
      });
      return probe;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(`the function did not boot in time. Deno said:\n${log}`);
}

try {
  const response = await waitForBoot(Date.now() + 60_000);
  const text = await response.text();
  if (response.status !== 200) throw new Error(`${response.status}: ${text}\n${log}`);
  const body = JSON.parse(text);
  console.log(`POST /seam -> ${response.status}`);
  console.log(JSON.stringify(body, null, 2));
  if (!body.ok || body.runtime !== 'deno') {
    console.error('boot proof failed: the function did not answer from Deno.');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(String(error));
  process.exitCode = 1;
} finally {
  stop();
}
