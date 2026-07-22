import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { systemTool } from './platform-tools.mjs';

const root = process.cwd();
const artifactDir = path.join(root, 'artifacts');
const fixtureDir = path.join(root, '.tmp', 'package-consumer');
rmSync(artifactDir, { recursive: true, force: true });
rmSync(fixtureDir, { recursive: true, force: true });
mkdirSync(artifactDir, { recursive: true });
mkdirSync(fixtureDir, { recursive: true });

execFileSync('pnpm', ['build:sdk'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
execFileSync('pnpm', ['pack:sdk'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
const tarballs = readdirSync(artifactDir).filter((name) => name.endsWith('.tgz'));
if (tarballs.length !== 1) throw new Error(`Expected one SDK tarball, got ${tarballs.length}`);
const tarball = path.join(artifactDir, tarballs[0]);
const listing = execFileSync(systemTool('tar.exe'), ['-tf', tarball], { encoding: 'utf8' }).trim().split(/\r?\n/u);
for (const entry of listing) {
  if (!/^package\/(?:dist\/|README\.md$|LICENSE$|package\.json$)/u.test(entry)) throw new Error(`Unexpected packed file: ${entry}`);
  if (/\.omx|\/src\/|\/tests\//u.test(entry)) throw new Error(`Private file leaked into tarball: ${entry}`);
}

const packageJson = JSON.parse(readFileSync(path.join(root, 'packages/sdk/package.json'), 'utf8'));
for (const [key, target] of Object.entries(packageJson.exports)) {
  const declaration = `package/${target.types.replace(/^\.\//u, '')}`;
  const runtime = `package/${target.import.replace(/^\.\//u, '')}`;
  if (!listing.includes(declaration) || !listing.includes(runtime)) throw new Error(`Export ${key} missing ${declaration} or ${runtime}`);
}

writeFileSync(path.join(fixtureDir, 'package.json'), JSON.stringify({
  name: 'ss-helper-tarball-consumer', private: true, type: 'module',
  dependencies: { '@ss-helper/sdk': `file:${tarball.replaceAll('\\', '/')}` },
}, null, 2));
writeFileSync(path.join(fixtureDir, 'tsconfig.json'), JSON.stringify({
  compilerOptions: { strict: true, noEmit: true, target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext' },
  include: ['consumer.ts'],
}, null, 2));
writeFileSync(path.join(fixtureDir, 'consumer.ts'), [
  "import { LLM_COMPLETION_V0, LLM_STRUCTURED_TASK_V0, LLM_EMBEDDING_V0, LLM_RERANK_V0, type LlmCompletionRequest } from '@ss-helper/sdk';",
  "import { CORE_PLUGIN_ID } from '@ss-helper/sdk/contracts/core';",
  "const request: LlmCompletionRequest = { messages: [{ role: 'user', content: 'ok' }] };",
  "void [LLM_COMPLETION_V0, LLM_STRUCTURED_TASK_V0, LLM_EMBEDDING_V0, LLM_RERANK_V0, CORE_PLUGIN_ID, request];",
].join('\n'));
execFileSync('pnpm', ['install', '--offline', '--ignore-workspace'], { cwd: fixtureDir, stdio: 'inherit', shell: process.platform === 'win32' });
execFileSync(path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc'), ['-p', 'tsconfig.json'], { cwd: fixtureDir, stdio: 'inherit', shell: process.platform === 'win32' });
if (!existsSync(path.join(fixtureDir, 'node_modules/@ss-helper/sdk/dist/index.d.ts'))) throw new Error('Installed tarball is missing declarations');
console.log(`PASS package verification: ${path.basename(tarball)}; ${listing.length} entries; isolated consumer typechecked`);
