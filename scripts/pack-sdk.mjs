import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { walkFiles } from './artifact-lib.mjs';

const textExtensions = new Set(['.css', '.html', '.js', '.json', '.map', '.md', '.ts', '.txt']);

export function canonicalText(value) {
  return value.replace(/\r\n?/gu, '\n');
}

function isTextFile(relative) {
  return path.basename(relative) === 'LICENSE' || textExtensions.has(path.extname(relative));
}

function copyCanonicalFile(source, target, relative) {
  mkdirSync(path.dirname(target), { recursive: true });
  if (isTextFile(relative)) {
    writeFileSync(target, canonicalText(readFileSync(source, 'utf8')));
  } else {
    writeFileSync(target, readFileSync(source));
  }
}

function directPnpm(args) {
  let cli = process.env.npm_execpath;
  if (cli === undefined || !/pnpm\.(?:c?js)$/iu.test(cli)) {
    const located = spawnSync('where.exe', ['pnpm.cmd'], { encoding: 'utf8' });
    if (located.status !== 0) throw new Error('pnpm.cmd could not be located');
    cli = path.join(path.dirname(located.stdout.trim().split(/\r?\n/u)[0]), 'node_modules', 'pnpm', 'bin', 'pnpm.cjs');
  }
  return { command: process.execPath, args: [cli, ...args] };
}

export function packSdkPackage({ packageDirectory, artifactDirectory }) {
  const stageParent = mkdtempSync(path.join(os.tmpdir(), 'ss-helper-sdk-pack-'));
  const stage = path.join(stageParent, 'package');
  try {
    mkdirSync(stage, { recursive: true });
    for (const relative of ['README.md', 'LICENSE']) {
      copyCanonicalFile(path.join(packageDirectory, relative), path.join(stage, relative), relative);
    }
    for (const relative of walkFiles(path.join(packageDirectory, 'dist'))) {
      copyCanonicalFile(
        path.join(packageDirectory, 'dist', ...relative.split('/')),
        path.join(stage, 'dist', ...relative.split('/')),
        relative,
      );
    }
    const packageJson = JSON.parse(readFileSync(path.join(packageDirectory, 'package.json'), 'utf8'));
    writeFileSync(path.join(stage, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
    mkdirSync(artifactDirectory, { recursive: true });
    const archivePrefix = `${packageJson.name.replace(/^@/u, '').replace('/', '-')}-`;
    for (const entry of readdirSync(artifactDirectory, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.startsWith(archivePrefix) && entry.name.endsWith('.tgz')) {
        rmSync(path.join(artifactDirectory, entry.name), { force: true });
      }
    }
    const pnpm = directPnpm(['--dir', stage, 'pack', '--pack-destination', artifactDirectory]);
    const result = spawnSync(pnpm.command, pnpm.args, { encoding: 'utf8', shell: false });
    if (result.status !== 0) {
      throw new Error(`Canonical SDK pack failed (${result.status ?? 'no exit code'})\n${result.stderr ?? ''}`);
    }
    const filename = `${packageJson.name.replace(/^@/u, '').replace('/', '-')}-${packageJson.version}.tgz`;
    return path.join(artifactDirectory, filename);
  } finally {
    rmSync(stageParent, { recursive: true, force: true });
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const tarball = packSdkPackage({
    packageDirectory: path.join(root, 'packages', 'sdk'),
    artifactDirectory: path.join(root, 'artifacts'),
  });
  console.log(tarball);
}
