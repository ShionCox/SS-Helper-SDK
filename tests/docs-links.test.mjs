import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const files = ['README.md', 'docs/public-contracts.md', 'docs/plugin-authoring.md', 'docs/public-api.md', 'docs/settings-schema.md', 'docs/compatibility.md', 'docs/migration.md', 'docs/architecture-invariants.md', 'docs/acceptance-matrix.md', 'docs/artifact-gate.md'];
test('final documentation links resolve inside the SDK/Core worktree', () => {
  for (const file of files) {
    const content = readFileSync(resolve(root, file), 'utf8');
    for (const target of content.matchAll(/\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
      const href = target[1];
      if (/^(?:https?:|mailto:)/.test(href)) continue;
      assert.ok(existsSync(resolve(root, dirname(file), href)), `${file} -> ${href}`);
    }
  }
});

test('public documentation names the current SDK connection API', () => {
  for (const file of ['README.md', 'docs/public-api.md']) {
    const content = readFileSync(resolve(root, file), 'utf8');
    assert.doesNotMatch(content, /connectCore/);
    assert.match(content, /connectSSHelper/);
  }
});

test('README LLM example uses the current connection and message contract', () => {
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
  assert.doesNotMatch(readme, /connectCore/);
  assert.match(readme, /connectSSHelper/);
  assert.doesNotMatch(readme, /LLM_COMPLETION_V1,\s*\{\s*prompt\s*:/);
  assert.match(readme, /LLM_COMPLETION_V1,\s*\{\s*messages:\s*\[\s*\{\s*role:\s*'user',\s*content:\s*'Hello'\s*}\s*]\s*,?\s*}/s);
});

test('architecture evidence link targets the current artifact-gate heading', () => {
  const architecture = readFileSync(resolve(root, 'docs/architecture-invariants.md'), 'utf8');
  const artifactGate = readFileSync(resolve(root, 'docs/artifact-gate.md'), 'utf8');

  assert.match(
    architecture,
    /\[historical artifact\/runtime evidence\]\(artifact-gate\.md#historical-artifactruntime-evidence--g008-fresh-rerun-required\)/,
  );
  assert.match(artifactGate, /^## Historical artifact\/runtime evidence — G008 fresh rerun required$/m);
});

test('architecture documents SDK storage and Memory business ownership as separate boundaries', () => {
  const architecture = readFileSync(resolve(root, 'docs/architecture-invariants.md'), 'utf8');
  assert.match(architecture, /SDK owns generic workspace storage; Memory owns every memory rule/);
  assert.match(architecture, /frontend-only consumer of `session\.workspace`/);
  assert.match(architecture, /SDK contains no Memory schema, worker, dynamic import, route, fact conflict or recall implementation/);
  assert.doesNotMatch(architecture, /semantic worker is mounted beneath the SDK route/);
});
