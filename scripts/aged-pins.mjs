#!/usr/bin/env node
// Print the newest version of each runtime dependency that is old enough to
// clear Deno's minimum dependency age gate. Run it when bumping the pins.
import { execFileSync } from 'node:child_process';

const AGE_HOURS = Number(process.argv[2] ?? 30);
const cutoff = Date.now() - AGE_HOURS * 3_600_000;
const PACKAGES = {
  ai: /^5\.\d+\.\d+$/,
  '@ai-sdk/anthropic': /^2\.\d+\.\d+$/,
  '@ai-sdk/openai': /^2\.\d+\.\d+$/,
  '@ai-sdk/google': /^2\.\d+\.\d+$/,
  '@ai-sdk/gateway': /^2\.\d+\.\d+$/,
};

for (const [name, range] of Object.entries(PACKAGES)) {
  const times = JSON.parse(execFileSync('npm', ['view', name, 'time', '--json'], { encoding: 'utf8' }));
  const aged = Object.entries(times)
    .filter(([version, when]) => range.test(version) && Date.parse(when) < cutoff)
    .sort((a, b) => Date.parse(a[1]) - Date.parse(b[1]));
  const last = aged.at(-1);
  console.log(`${name} ${last ? `${last[0]} (${last[1]})` : 'none'}`);
}
