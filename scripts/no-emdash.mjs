#!/usr/bin/env node
// Gate: fails if U+2014 (em dash) or U+2013 (en dash) appear in tracked source files.
// Owner rule 2026-09-05: no em/en dashes anywhere user-facing in DLUSN surfaces.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SOURCE_GLOBS = [
  /^src\//,
  /^test\//,
  /^fixtures\//,
  /^scripts\//,
  /^docs\//,
  /^README\.md$/,
  /^AGENTS\.md$/,
  /^PROGRESS\.md$/,
  /^DECISIONS\.md$/,
  /^SUMMARY\.md$/,
];

// file:line exemptions: a real reason must be given inline as a comment here.
const ALLOWLIST = new Set([
  // 'src/example/file.ts:12', // e.g. a component rendering a literal dash glyph
]);

const DASH_RE = new RegExp(`[${String.fromCharCode(0x2014, 0x2013)}]`);

function trackedFiles() {
  return execFileSync('git', ['ls-files'], { encoding: 'utf8', cwd: process.cwd() })
    .split('\n')
    .filter(Boolean)
    .filter((f) => SOURCE_GLOBS.some((re) => re.test(f)));
}

const failures = [];
for (const file of trackedFiles()) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue; // deleted-but-staged, etc.
  }
  content.split('\n').forEach((line, i) => {
    if (DASH_RE.test(line) && !ALLOWLIST.has(`${file}:${i + 1}`)) {
      failures.push(`${file}:${i + 1}: ${line.trim()}`);
    }
  });
}

if (failures.length) {
  console.error(`no-emdash: found ${failures.length} em/en dash occurrence(s):\n`);
  for (const f of failures) console.error(f);
  console.error('\nReplace with the punctuation the sentence needs (colon, comma, full stop, "to"). See AGENTS.md.');
  process.exit(1);
}

console.log('no-emdash: clean.');
