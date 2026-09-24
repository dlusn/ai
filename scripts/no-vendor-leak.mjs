#!/usr/bin/env node
// Gate from the contract's acceptance list: a vendor host, a vendor SDK name or
// a vendor model id may appear in registry.ts and in the adapter files, nowhere
// else under src. This is the check that keeps the seam a seam.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PATTERN = /api\.anthropic\.com|@anthropic-ai|claude-|gpt-|gemini-/;

const ALLOWED = [
  /^src\/registry\.ts$/,
  /^src\/adapters\//,
  /^src\/speech\/(deepgram|elevenlabs|cartesia)\.ts$/,
];

const files = execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8', cwd: process.cwd() })
  .split('\n')
  .filter(Boolean);

const leaks = [];
for (const file of files) {
  if (ALLOWED.some((re) => re.test(file))) continue;
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (PATTERN.test(line)) leaks.push(`${file}:${i + 1}: ${line.trim()}`);
    });
}

if (leaks.length) {
  console.error(`no-vendor-leak: ${leaks.length} vendor reference(s) outside the registry and the adapters:\n`);
  for (const leak of leaks) console.error(leak);
  console.error('\nMove it into src/registry.ts or src/adapters/, or into the speech adapter it belongs to.');
  process.exit(1);
}

console.log('no-vendor-leak: clean.');
