import { existsSync } from 'node:fs';
import path from 'node:path';

/** Resolve native Windows utilities without Git Bash command shadowing. */
export function systemTool(name) {
  if (process.platform !== 'win32') return name.replace(/\.exe$/iu, '');
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (typeof systemRoot !== 'string' || systemRoot.trim() === '') {
    throw new Error(`Windows system root is unavailable while resolving ${name}`);
  }
  const candidate = path.join(systemRoot, 'System32', name);
  if (!existsSync(candidate)) throw new Error(`Windows system tool is missing: ${candidate}`);
  return candidate;
}
