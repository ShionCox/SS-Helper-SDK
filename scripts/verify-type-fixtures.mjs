import { execFileSync } from 'node:child_process';

for (const config of ['tests/fixtures/compile/tsconfig.nodenext.json', 'tests/fixtures/compile/tsconfig.bundler.json']) {
  execFileSync('pnpm', ['exec', 'tsc', '-p', config, '--pretty', 'false'], { stdio: 'inherit', shell: process.platform === 'win32' });
  console.log(`PASS type fixture: ${config}`);
}
