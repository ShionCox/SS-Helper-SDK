import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const scanner = join(process.cwd(), 'scripts', 'legacy-scan.mjs');
const runScan = (...roots) => spawnSync(process.execPath, [scanner, ...roots], { encoding: 'utf8' });
const commit = (root) => {
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.email=test@example.test', '-c', 'user.name=test', 'commit', '-qm', 'fixture']);
};
const makeRepo = () => {
  const root = mkdtempSync(join(tmpdir(), 'ss-helper-legacy-scan-'));
  execFileSync('git', ['init', '-q', root]);
  writeFileSync(join(root, 'ok.ts'), 'export const ok = true;\n');
  commit(root);
  return root;
};
const trackMissingFile = (root, file) => {
  const blob = execFileSync('git', ['-C', root, 'hash-object', '-w', '--stdin'], { input: 'fixture\n', encoding: 'utf8' }).trim();
  execFileSync('git', ['-C', root, 'update-index', '--add', '--cacheinfo', `100644,${blob},${file}`]);
  execFileSync('git', ['-C', root, '-c', 'user.email=test@example.test', '-c', 'user.name=test', 'commit', '-qm', 'missing fixture']);
};
test('legacy scan classifies all supplied roots and rejects raw globals', () => {
  const sdk = makeRepo(); const llm = makeRepo(); const memory = makeRepo();
  try {
    const args = ['--sdk-root', sdk, '--llm-root', llm, '--memory-root', memory];
    const pass = runScan(...args);
    assert.equal(pass.status, 0, pass.stderr);
    assert.match(pass.stdout, /Legacy scan passed/);
    writeFileSync(join(llm, 'bad.ts'), 'window.STX.doThing();\n');
    commit(llm);
    const failure = runScan(...args);
    assert.equal(failure.status, 1);
    assert.match(failure.stderr, /LLM \[production\] bad\.ts: raw consumer global/);
  } finally { [sdk, llm, memory].forEach((root) => rmSync(root, { recursive: true, force: true })); }
});

test('legacy scan rejects retired SS-Helper transports outside named guards', () => {
  const sdk = makeRepo(); const llm = makeRepo(); const memory = makeRepo();
  try {
    const args = ['--sdk-root', sdk, '--llm-root', llm, '--memory-root', memory];
    writeFileSync(join(sdk, 'retired.ts'), "fetch('/api/plugins/ss-helper-sdk/v1/memory/health');\n");
    commit(sdk);
    const failure = runScan(...args);
    assert.equal(failure.status, 1);
    assert.match(failure.stderr, /SDK\/Core \[production\] retired\.ts: retired SS-Helper transport/);
  } finally { [sdk, llm, memory].forEach((root) => rmSync(root, { recursive: true, force: true })); }
});

test('legacy scan exempts only named assertion files', () => {
  const sdk = makeRepo(); const llm = makeRepo(); const memory = makeRepo();
  try {
    mkdirSync(join(sdk, 'tests'), { recursive: true });
    writeFileSync(join(sdk, 'tests', 'legacy-scan.test.mjs'), "assert.match(source, /window.STX/);\n");
    commit(sdk);
    const args = ['--sdk-root', sdk, '--llm-root', llm, '--memory-root', memory];
    assert.equal(runScan(...args).status, 0);
    writeFileSync(join(sdk, 'tests', 'unlisted-assertion.test.mjs'), "assert.match(source, /window.STX/);\n");
    commit(sdk);
    const failure = runScan(...args);
    assert.equal(failure.status, 1);
    assert.match(failure.stderr, /SDK\/Core \[executable\/fixture\/manifest\] tests\/unlisted-assertion\.test\.mjs: raw consumer global/);
  } finally { [sdk, llm, memory].forEach((root) => rmSync(root, { recursive: true, force: true })); }
});

test('legacy scan fails closed when a tracked file cannot be read', () => {
  const sdk = makeRepo(); const llm = makeRepo(); const memory = makeRepo();
  try {
    trackMissingFile(sdk, 'missing.ts');
    const failure = runScan('--sdk-root', sdk, '--llm-root', llm, '--memory-root', memory);
    assert.equal(failure.status, 1);
    assert.match(failure.stderr, /SDK\/Core \[production\] missing\.ts: unable to read tracked file/);
  } finally { [sdk, llm, memory].forEach((root) => rmSync(root, { recursive: true, force: true })); }
});

test('historical markers do not broadly bypass prohibited documentation patterns', () => {
  const sdk = makeRepo(); const llm = makeRepo(); const memory = makeRepo();
  try {
    mkdirSync(join(sdk, 'docs'), { recursive: true });
    writeFileSync(join(sdk, 'docs', 'historical-notes.md'), 'Historical migration notes: window.STX.doThing();\n');
    commit(sdk);
    const args = ['--sdk-root', sdk, '--llm-root', llm, '--memory-root', memory];
    const failure = runScan(...args);
    assert.equal(failure.status, 1);
    assert.match(failure.stderr, /SDK\/Core \[docs\/package\] docs\/historical-notes\.md: raw consumer global/);
  } finally { [sdk, llm, memory].forEach((root) => rmSync(root, { recursive: true, force: true })); }
});

test('legacy scan permits only the explicit historical migration evidence exception', () => {
  const sdk = makeRepo(); const llm = makeRepo(); const memory = makeRepo();
  try {
    mkdirSync(join(sdk, 'docs'), { recursive: true });
    writeFileSync(join(sdk, 'docs', 'migration.md'), 'Historical migration evidence: window.STX.doThing();\n');
    commit(sdk);
    assert.equal(runScan('--sdk-root', sdk, '--llm-root', llm, '--memory-root', memory).status, 0);
    writeFileSync(join(sdk, 'docs', 'migration.md'), "Historical migration evidence: from 'C:\\\\secret';\n");
    commit(sdk);
    const failure = runScan('--sdk-root', sdk, '--llm-root', llm, '--memory-root', memory);
    assert.equal(failure.status, 1);
    assert.match(failure.stderr, /SDK\/Core \[docs\/package\] docs\/migration\.md: workspace\/link\/absolute import leakage/);
  } finally { [sdk, llm, memory].forEach((root) => rmSync(root, { recursive: true, force: true })); }
});
