import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const roots = ['packages/sdk/src', 'apps/core-extension/src'];
const forbidden = [
  ['legacy global', /window\.STX|globalThis\.STX/u],
  ['private sibling import', /(?:\.\.\/)+(?:SDK|_Components)\b/u],
  ['inline bundler query', /\?inline(?:['"]|$)/u],
  ['runtime dependency leak', /from ['"](?:dexie|zod)['"]/u],
];
const failures = [];

function walk(directory) {
  for (const name of readdirSync(directory)) {
    const file = path.join(directory, name);
    if (statSync(file).isDirectory()) walk(file);
    else if (file.endsWith('.ts')) {
      const source = readFileSync(file, 'utf8');
      for (const [label, pattern] of forbidden) if (pattern.test(source)) failures.push(`${file}: ${label}`);
    }
  }
}
for (const root of roots) walk(root);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`PASS boundary lint: ${roots.join(', ')}`);
