#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const roots = [
  ['SDK/Core', option('--sdk-root')],
  ['LLM', option('--llm-root')],
  ['Memory', option('--memory-root')],
].filter(([, root]) => root).map(([name, root]) => [name, resolve(root)]);
if (!roots.length) {
  console.error('Usage: node scripts/legacy-scan.mjs --sdk-root <path> --llm-root <path> --memory-root <path>');
  process.exit(2);
}
const patterns = [
  ['stale SDK-relative import', /(?:from|import\()\s*['"][^'"]*(?:SS-Helper-SDK|packages\/sdk)[^'"]*['"]/i],
  ['raw consumer global', /\b(?:window|globalThis)\.STX\b/],
  ['old settings root', /ss-helper-plugins-container|old-settings-root/i],
  ['MemoryOS facade', /\bMemoryOS\b/],
  ['workspace/link/absolute import leakage', /(?:link:|file:\/\/|(?:from|import\()\s*['"][A-Za-z]:\\)/i],
  ['secret probing', /(?:localStorage\.getItem\(['"](?:api[_-]?key|token|secret)|Authorization\s*[:=]\s*['"]Bearer)/i],
];
// These files intentionally contain legacy markers as scanner/audit assertions or
// package metadata. Keep this list exact so every other tracked file is scanned.
const namedExemptions = new Map([
  ['SDK/Core', new Set([
    'pnpm-lock.yaml',
    'scripts/artifact-gate.mjs',
    'scripts/legacy-scan.mjs',
    'scripts/verify-migration-baseline.mjs',
    'tests/artifact-lib.test.mjs',
    'tests/communication-runtime.test.mjs',
    'tests/contracts.test.mjs',
    'tests/core-runtime.test.mjs',
    'tests/cross-plugin-services.test.mjs',
    'tests/legacy-scan.test.mjs',
  ])],
  ['LLM', new Set([
    'scripts/legacy-scan.mjs',
  ])],
  ['Memory', new Set([
    'AGENTS.md',
    'scripts/legacy-scan.mjs',
    'test/sdk-artifact.spec.ts',
    'test/sdk-migration-baseline.spec.ts',
  ])],
]);
// Historical evidence may retain a specific legacy marker only when it is
// explicitly identified in the source document. This never exempts path or
// credential leakage, and every entry is covered by legacy-scan.test.mjs.
const historicalEvidenceExceptions = new Map([
  ['SDK/Core', new Map([
    ['docs/migration.md', new Map([
      ['raw consumer global', 'Historical migration evidence:'],
    ])],
    ['docs/CURRENT_PROJECT_STATUS.md', new Map([
      ['raw consumer global', '本文保留 G007 快照作为历史验证证据'],
      ['MemoryOS facade', '本文保留 G007 快照作为历史验证证据'],
    ])],
    ['docs/migration-baseline.md', new Map([
      ['raw consumer global', '阶段：G0 inventory only'],
      ['old settings root', '阶段：G0 inventory only'],
      ['MemoryOS facade', '阶段：G0 inventory only'],
    ])],
    ['docs/old-sdk-capability-ledger.md', new Map([
      ['raw consumer global', '状态：G0 frozen inventory'],
      ['MemoryOS facade', '状态：G0 frozen inventory'],
    ])],
  ])],
  ['Memory', new Map([
    ['docs/sdk-migration-baseline.md', new Map([
      ['raw consumer global', 'SDK 迁移历史基线（G0/G5C，非当前操作指南）'],
    ])],
  ])],
]);
const classification = (file) => {
  if (/^(README|CHANGELOG)|^docs\//i.test(file) || /\.md$/i.test(file)) return 'docs/package';
  if (/(^|\/)(scripts|test|tests|fixtures)\//i.test(file) || /(?:manifest|package)\.json$/i.test(file)) return 'executable/fixture/manifest';
  return 'production';
};
let violations = 0;
for (const [name, root] of roots) {
  if (!existsSync(root)) {
    console.error(`${name}: root missing: ${root}`); violations += 1; continue;
  }
  let files;
  try { files = execFileSync('git', ['-C', root, 'ls-files'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean); }
  catch { console.error(`${name}: must be a Git worktree: ${root}`); violations += 1; continue; }
  const counts = { production: 0, 'executable/fixture/manifest': 0, 'docs/package': 0 };
  for (const file of files) {
    const category = classification(file); counts[category] += 1;
    if (namedExemptions.get(name)?.has(file)) continue;
    const full = resolve(root, file);
    let text;
    try { text = readFileSync(full, 'utf8'); }
    catch (error) {
      console.error(`${name} [${category}] ${file}: unable to read tracked file (${error.code ?? error.message})`);
      violations += 1;
      continue;
    }
    for (const [label, matcher] of patterns) {
      if (!matcher.test(text)) continue;
      const requiredMarker = historicalEvidenceExceptions.get(name)?.get(file)?.get(label);
      if (category === 'docs/package' && requiredMarker && text.includes(requiredMarker)) continue;
      console.error(`${name} [${category}] ${file}: ${label}`); violations += 1;
    }
  }
  console.log(`${name}: production=${counts.production}, executable/fixture/manifest=${counts['executable/fixture/manifest']}, docs/package=${counts['docs/package']}`);
}
if (violations) {
  console.error(`Legacy scan failed: ${violations} violation(s).`);
  process.exit(1);
}
console.log('Legacy scan passed: no prohibited production, executable/fixture/manifest, or docs/package leakage.');
