import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { contentDigest, createDeterministicZip, inventory, rewriteSdkImports, sha256File, verifyInventory } from '../scripts/artifact-lib.mjs';
import { createEvidenceSanitizer } from '../scripts/evidence-sanitizer.mjs';
import { systemTool } from '../scripts/platform-tools.mjs';

test('artifact evidence sanitizer redacts Windows roots without obscuring command semantics', () => {
  const sanitize = createEvidenceSanitizer({
    repoRoot: 'I:\\VUE\\SS-Helper-SDK\\.omx\\team\\gate\\worktrees\\worker-1',
    temporaryRoot: 'C:\\Users\\lyy\\AppData\\Local\\Temp\\ss-helper-gate',
    llmRoot: 'I:\\VUE\\SS-Helper-LLM',
    memoryRoot: 'I:/VUE/SS-Helper-Memory',
    userProfile: 'C:\\Users\\lyy',
  });
  const sanitized = sanitize.sanitizeValue({
    command: 'node I:\\VUE\\SS-Helper-SDK\\.omx\\team\\gate\\worktrees\\worker-1\\scripts\\real-st-browser-smoke.mjs --llmRoot=i:/vue/ss-helper-llm --memoryRoot=I:\\VUE\\SS-Helper-Memory --module=file:///I:/VUE/SS-Helper-LLM/dist/runtime-entry.js',
    cwd: 'C:\\Users\\lyy\\AppData\\Local\\Temp\\ss-helper-gate\\consumer',
    evidencePath: 'See (D:\\unmapped\\gate-evidence.json), next',
    profilePath: 'c:/users/LYY/.cache/gate',
    unknownFileUrl: 'file:///D:/unmapped/gate-evidence.json',
    uncPath: '\\\\server\\share\\gate-evidence.json',
    nested: [{ 'I:\\VUE\\SS-Helper-Memory\\dist\\index.js': 'I:\\VUE\\SS-Helper-LLM2\\not-the-llm-root.js' }],
  });
  const serialized = JSON.stringify(sanitized);

  assert.doesNotMatch(serialized, /[a-z]:[\\/]/iu);
  assert.doesNotMatch(serialized, /file:/iu);
  assert.doesNotMatch(serialized, /ss-helper-sdk|ss-helper-llm|ss-helper-memory|users[\\/]lyy/iu);
  assert.equal(
    sanitized.command,
    'node <repo>/scripts/real-st-browser-smoke.mjs --llmRoot=<llm-root> --memoryRoot=<memory-root> --module=<llm-root>/dist/runtime-entry.js',
  );
  assert.equal(sanitized.cwd, '<temporary>/consumer');
  assert.equal(sanitized.evidencePath, 'See (<absolute-path>), next');
  assert.equal(sanitized.profilePath, '<user-profile>/.cache/gate');
  assert.equal(sanitized.unknownFileUrl, '<file-reference>');
  assert.equal(sanitized.uncPath, '<absolute-path>');
  assert.deepEqual(sanitized.nested, [{ '<memory-root>/dist/index.js': '<absolute-path>' }]);
});

test('artifact inventory is canonical and rejects payload drift', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ss-helper-artifact-unit-'));
  try {
    mkdirSync(path.join(root, 'nested'));
    writeFileSync(path.join(root, 'z.js'), 'z');
    writeFileSync(path.join(root, 'nested', 'a.js'), 'a');
    const files = inventory(root);
    const manifest = { files, contentDigest: contentDigest([...files].reverse()) };
    assert.deepEqual(verifyInventory(root, manifest), files);
    writeFileSync(path.join(root, 'nested', 'a.js'), 'changed');
    assert.throws(() => verifyInventory(root, manifest), /inventory/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('contentDigest matches the fixed path-NUL-lowercaseSha256-LF vector', () => {
  const files = [
    { path: 'z.txt', size: 999, sha256: 'A'.repeat(64) },
    { path: 'a/b.js', size: 1, sha256: '0123456789ABCDEF'.repeat(4) },
  ];
  assert.equal(contentDigest(files), '00a5c11a95b675fd777ab104dc0382adbb12a6c37298f316caf4a466486d11e4');
  assert.equal(contentDigest([...files].reverse()), '00a5c11a95b675fd777ab104dc0382adbb12a6c37298f316caf4a466486d11e4');
  assert.equal(contentDigest(files.map((file) => ({ ...file, size: file.size + 1000 }))), '00a5c11a95b675fd777ab104dc0382adbb12a6c37298f316caf4a466486d11e4');
});

test('contentDigest can be independently recomputed from the payload inventory', () => {
  const files = [
    { path: 'nested/two.js', size: 2, sha256: '2'.repeat(64) },
    { path: 'one.js', size: 1, sha256: '1'.repeat(64) },
  ];
  const independent = createHash('sha256');
  for (const file of [...files].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)) {
    independent.update(Buffer.concat([
      Buffer.from(file.path, 'utf8'),
      Buffer.from([0]),
      Buffer.from(file.sha256.toLowerCase(), 'utf8'),
      Buffer.from('\n', 'utf8'),
    ]));
  }
  assert.equal(contentDigest(files), independent.digest('hex'));
});

test('Core build rewrite points bare SDK imports at the artifact-owned vendor tree', () => {
  const output = path.join('artifact', 'lib', 'runtime', 'entry.js');
  const sdk = path.join('artifact', 'vendor', 'sdk');
  const rewritten = rewriteSdkImports("import { x } from '@ss-helper/sdk'; import y from '@ss-helper/sdk/contracts/core';", output, sdk);
  assert.equal(rewritten, "import { x } from '../../vendor/sdk/index.js'; import y from '../../vendor/sdk/contracts/core.js';");
});

test('deterministic zip ignores source filesystem timestamps and extracts cleanly', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ss-helper-zip-unit-'));
  try {
    const stage = path.join(root, 'stage');
    mkdirSync(path.join(stage, 'nested'), { recursive: true });
    writeFileSync(path.join(stage, 'nested', 'payload.txt'), 'payload\n');
    const first = createDeterministicZip(stage, path.join(root, 'first.zip'));
    utimesSync(path.join(stage, 'nested', 'payload.txt'), new Date(), new Date());
    const second = createDeterministicZip(stage, path.join(root, 'second.zip'));
    assert.equal(sha256File(second), sha256File(first));
    const extracted = path.join(root, 'extracted');
    mkdirSync(extracted);
    execFileSync(systemTool('tar.exe'), ['-xf', second, '-C', extracted]);
    assert.equal(readFileSync(path.join(extracted, 'nested', 'payload.txt'), 'utf8'), 'payload\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
