import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha256File } from '../scripts/artifact-lib.mjs';
import { canonicalText, packSdkPackage } from '../scripts/pack-sdk.mjs';
import { systemTool } from '../scripts/platform-tools.mjs';

test('canonicalText converts CRLF and bare CR to LF', () => {
  assert.equal(canonicalText('one\r\ntwo\rthree\n'), 'one\ntwo\nthree\n');
});

test('SDK pack canonicalizes text and reproduces archive bytes', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'ss-helper-sdk-pack-test-'));
  try {
    const packageDirectory = path.join(root, 'sdk');
    const artifactDirectory = path.join(root, 'artifacts');
    mkdirSync(path.join(packageDirectory, 'dist'), { recursive: true });
    writeFileSync(path.join(packageDirectory, 'package.json'), JSON.stringify({
      name: '@fixture/sdk',
      version: '2.1.0',
      type: 'module',
      files: ['dist/**', 'README.md', 'LICENSE'],
    }).replace(/\n/gu, '\r\n'));
    writeFileSync(path.join(packageDirectory, 'README.md'), '# Fixture\r\n\r\nCanonical text.\r\n');
    writeFileSync(path.join(packageDirectory, 'LICENSE'), 'Fixture\r\n');
    writeFileSync(path.join(packageDirectory, 'dist', 'index.js'), 'export const value = 1;\r\n');

    const first = packSdkPackage({ packageDirectory, artifactDirectory });
    const firstHash = sha256File(first);
    const second = packSdkPackage({ packageDirectory, artifactDirectory });
    assert.equal(sha256File(second), firstHash);

    const extracted = path.join(root, 'extracted');
    mkdirSync(extracted);
    execFileSync(systemTool('tar.exe'), ['-xf', second, '-C', extracted]);
    for (const relative of ['README.md', 'LICENSE', 'package.json', 'dist/index.js']) {
      assert.doesNotMatch(readFileSync(path.join(extracted, 'package', ...relative.split('/')), 'utf8'), /\r/u);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
