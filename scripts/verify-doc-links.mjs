import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';

const trackedDocs = execFileSync('git', ['ls-files', 'README.md', 'docs'], { encoding: 'utf8' })
  .trim().split(/\r?\n/).filter((file) => file.endsWith('.md'));
const failures = [];
for (const file of trackedDocs) {
  const content = readFileSync(file, 'utf8');
  for (const match of content.matchAll(/\[[^\]]+\]\(([^)#]+)(?:#[^)]+)?\)/g)) {
    const target = match[1];
    if (/^[a-z]+:/i.test(target) || target.startsWith('/') || target.startsWith('../.omx/') || target.startsWith('../artifacts/')) continue;
    const path = resolve(dirname(file), target);
    if (!existsSync(path) || !statSync(path).isFile()) failures.push(`${file} -> ${target}`);
  }
}
if (failures.length) throw new Error(`Broken documentation links:\n${failures.join('\n')}`);
console.log(`PASS: ${trackedDocs.length} Markdown files have valid local links`);
