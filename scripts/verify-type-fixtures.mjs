import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(readFileSync(path.join(root, 'packages', 'sdk', 'package.json'), 'utf8')).version;
const archive = path.join(root, 'artifacts', `ss-helper-sdk-${version}.tgz`);
const temp = mkdtempSync(path.join(os.tmpdir(), 'ss-helper-sdk-types-'));
const extracted = path.join(temp, 'extracted');
const sdkTarget = path.join(temp, 'node_modules', '@ss-helper', 'sdk');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

try {
  execFileSync(process.execPath, [path.join(root, 'scripts', 'pack-sdk.mjs')], { cwd: root, stdio: 'inherit' });
  mkdirSync(extracted, { recursive: true });
  execFileSync('tar', ['-xzf', archive, '-C', extracted], { stdio: 'inherit' });
  mkdirSync(path.dirname(sdkTarget), { recursive: true });
  cpSync(path.join(extracted, 'package'), sdkTarget, { recursive: true });
  cpSync(path.join(root, 'tests', 'fixtures', 'compile', 'positive.ts'), path.join(temp, 'positive.ts'));
  cpSync(path.join(root, 'tests', 'fixtures', 'compile', 'negative.ts'), path.join(temp, 'negative.ts'));
  writeFileSync(path.join(temp, 'package.json'), '{"private":true,"type":"module"}\n');
  const base = { compilerOptions: { target: 'ES2022', strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, noUncheckedSideEffectImports: true, verbatimModuleSyntax: true, isolatedModules: true, skipLibCheck: true, noEmit: true }, files: ['positive.ts', 'negative.ts'] };
  for (const [name, module, moduleResolution] of [['nodenext', 'NodeNext', 'NodeNext'], ['bundler', 'ESNext', 'Bundler']]) {
    const config = path.join(temp, `tsconfig.${name}.json`);
    writeFileSync(config, `${JSON.stringify({ ...base, compilerOptions: { ...base.compilerOptions, module, moduleResolution } }, null, 2)}\n`);
    execFileSync(pnpm, ['exec', 'tsc', '-p', config, '--pretty', 'false'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
    console.log(`PASS isolated packed type fixture: ${name}`);
  }
} finally { rmSync(temp, { recursive: true, force: true }); }
