import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const roots = {
  old: process.env.SS_HELPER_OLD_ROOT || 'I:\\VUE\\SillyTavern-SS-Helper',
  llm: process.env.SS_HELPER_LLM_ROOT || 'I:\\VUE\\SS-Helper-LLM',
  memory: process.env.SS_HELPER_MEMORY_ROOT || 'I:\\VUE\\SS-Helper-Memory',
  sdk: process.cwd(),
};

const checks = [];
function read(root, relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}
function readSources(root, relativeDirectory) {
  const directory = path.join(root, relativeDirectory);
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile() && /\.[cm]?[jt]sx?$/u.test(entry.name))
    .map(entry => readFileSync(path.join(entry.parentPath, entry.name), 'utf8'))
    .join('\n');
}
function check(name, condition, evidence) {
  checks.push({ name, ok: Boolean(condition), evidence });
}
function status(root) {
  return execFileSync('git', ['-C', root, 'status', '--short', '--branch'], { encoding: 'utf8' }).trim();
}
function sourceSchema(source, version) {
  const pattern = 'this\\.version\\(' + version + '\\)\\.stores\\(\\{([\\s\\S]*?)\\n\\s*\\}\\);';
  const match = source.match(new RegExp(pattern, 'u'));
  if (!match) return [];
  return match[1].split('\n').map(line => line.trim().replace(/,$/u, '')).filter(Boolean);
}
function ledgerSchema(source, version) {
  const heading = source.indexOf('SSHelperDatabase v' + version + ' ');
  if (heading < 0) return [];
  const fence = String.fromCharCode(96).repeat(3);
  const blockStart = source.indexOf(fence + 'text', heading);
  if (blockStart < 0) return [];
  const contentStart = source.indexOf('\n', blockStart) + 1;
  const blockEnd = source.indexOf(fence, contentStart);
  return source.slice(contentStart, blockEnd).split('\n').map(line => line.trim()).filter(Boolean);
}

const workspace = read(roots.old, 'pnpm-workspace.yaml');
const database = read(roots.old, 'SDK/db/database.ts');
const rpc = read(roots.old, 'SDK/bus/rpc.ts');
const toolbar = read(roots.old, 'SDK/toolbar.ts');
const tailwind = read(roots.old, 'SDK/tailwind.ts');
const settings = read(roots.old, 'SDK/settings.ts');
const llmSources = readSources(roots.llm, 'src');
const memorySources = readSources(roots.memory, 'src');
const coreSources = readSources(roots.sdk, 'apps/core-extension/src');
const llmDatabase = read(roots.llm, 'src/storage/database.ts');
const memorySchema = read(roots.memory, 'server/schema.js');
const memoryWorker = read(roots.memory, 'server/sqlite-worker.js');
const baseline = read(roots.sdk, 'docs/migration-baseline.md');
const ledger = read(roots.sdk, 'docs/old-sdk-capability-ledger.md');

check('workspace intentionally excludes SDK', !/^\s*-\s*["']?SDK["']?\s*$/mu.test(workspace), 'pnpm-workspace.yaml');
check('mixed DB name frozen', database.includes("super('SSHelperDatabase')"), 'SDK/db/database.ts:307');
for (const version of [1, 2, 3, 4]) {
  const actual = sourceSchema(database, version);
  const frozen = ledgerSchema(ledger, version);
  check('Dexie v' + version + ' exists', actual.length > 0, 'SDK/db/database.ts version ' + version);
  check(
    'ledger exactly matches Dexie v' + version + ' stores/indexes',
    JSON.stringify(actual) === JSON.stringify(frozen),
    'docs/old-sdk-capability-ledger.md v' + version + '; ' + actual.length + ' stores',
  );
}
check(
  'LLM credential index frozen',
  database.includes("llm_credentials: '&providerId, updatedAt'"),
  'SDK/db/database.ts:323/342/361/381',
);
check(
  'LLM request-log indexes frozen',
  database.includes("llm_request_logs: '&logId, requestId, sourcePluginId, sortTs, state, [sourcePluginId+sortTs], [state+sortTs], updatedAt'"),
  'SDK/db/database.ts:324/343/362/382',
);
check('legacy RPC uses window.STX.bus', rpc.includes('(window as any).STX?.bus'), 'SDK/bus/rpc.ts');
check('toolbar crosses into _Components', toolbar.includes('../_Components/sharedButton'), 'SDK/toolbar.ts:1');
check('tailwind uses Vite inline query', tailwind.includes('./tailwind.css?inline'), 'SDK/tailwind.ts:1');
check('settings owns account/local fallback', settings.includes('stx.sdk.settings.v1') && settings.includes('globalThis.localStorage'), 'SDK/settings.ts');
check(
  'LLM cutover has no legacy STX/settings mount',
  !llmSources.includes('globalSTX.llm = this.sdk')
    && !llmSources.includes('window.STX')
    && !llmSources.includes('mountSettings'),
  'SS-Helper-LLM/src/**',
);
check(
  'Memory cutover has no legacy STX/global mount',
  !memorySources.includes('host.STX.memory = this.application')
    && !memorySources.includes('window.STX')
    && memorySources.includes("from '@ss-helper/sdk'"),
  'SS-Helper-Memory/src/**',
);
check(
  'LLM owns a separate Dexie v1 target',
  llmDatabase.includes("export const LLM_DATABASE_NAME = 'SSHelperLLMDatabase'")
    && llmDatabase.includes('export const LLM_DATABASE_VERSION = 1')
    && llmDatabase.includes("migration_evidence: '&key, state, completedAt'"),
  'SS-Helper-LLM/src/storage/database.ts target v1',
);
check(
  'LLM retains the exact legacy Dexie v4 source and rollback ownership',
    llmDatabase.includes("export const LEGACY_DATABASE_NAME = 'SSHelperDatabase'")
    && llmDatabase.includes('expected.version(4).stores(LEGACY_V4_STORES)')
    && llmDatabase.includes("buildEvidence(ROLLBACK_BACKUP_KEY, 'rollback-backup'")
    && llmDatabase.includes("buildEvidence(ROLLBACK_EVIDENCE_KEY, 'rolled-back'"),
  'SS-Helper-LLM/src/storage/database.ts legacy v4/rollback',
);
const expectedMemoryTables = ['facts', 'evidence', 'jobs', 'settings', 'recall_logs', 'job_batch_audits', 'main_chat_usage', 'batch_snapshots', 'fact_vectors'];
check(
  'Memory owns the frozen SQLite schema and protocol',
  memorySchema.includes('export const SCHEMA_VERSION = 2')
    && memorySchema.includes('export const PROTOCOL_VERSION = 1')
    && expectedMemoryTables.every(table => memorySchema.includes(`'${table}'`))
    && memoryWorker.includes("databasePath: '_memory/memory.sqlite3'")
    && memoryWorker.includes('new DatabaseSync(dbPath)'),
  'SS-Helper-Memory/server schema v2, protocol v1, owned database path',
);
check(
  'Core owns no LLM or Memory business persistence',
  !/(?:Dexie|indexedDB|DatabaseSync|node:sqlite|SSHelperLLMDatabase|SSHelperDatabase|CREATE TABLE|llm_credentials|llm_request_logs|fact_vectors)/u.test(coreSources),
  'SS-Helper-SDK/apps/core-extension/src/**',
);
check('baseline document has required inventory', /Workspace、入口、manifest 与构建/u.test(baseline) && /Consumer 越界引用/u.test(baseline), 'docs/migration-baseline.md');
check('ledger freezes cutover and rollback', /Cutover 不变量/u.test(ledger) && /Rollback 不变量/u.test(ledger), 'docs/old-sdk-capability-ledger.md');

const failed = checks.filter((item) => !item.ok);
const report = {
  roots,
  counts: { total: checks.length, passed: checks.length - failed.length, failed: failed.length },
  checks,
  git: {
    oldMonorepo: status(roots.old),
    memory: status(roots.memory),
  },
};
console.log(JSON.stringify(report, null, 2));
if (failed.length > 0) process.exitCode = 1;
