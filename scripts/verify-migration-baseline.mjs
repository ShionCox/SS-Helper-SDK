import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const sdkRoot = process.cwd();
const workspaceRoot = path.resolve(sdkRoot, '..');
const memoryRoot = path.resolve(process.env.SS_HELPER_MEMORY_ROOT ?? path.join(workspaceRoot, 'SS-Helper-Memory'));
const buildScript = readFileSync(path.join(workspaceRoot, 'scripts', 'build-all.mjs'), 'utf8');
const sdkServer = readFileSync(path.join(sdkRoot, 'server-plugin', 'index.js'), 'utf8');
const workspaceContract = readFileSync(path.join(sdkRoot, 'packages', 'sdk', 'src', 'contracts', 'workspace.ts'), 'utf8');
const memoryRepository = readFileSync(path.join(memoryRoot, 'src', 'infrastructure', 'memory-repository.ts'), 'utf8');
const memoryRuntime = readFileSync(path.join(memoryRoot, 'src', 'host', 'memory-runtime.ts'), 'utf8');

const checks = [];
const check = (name, condition, evidence) => checks.push({ name, ok: Boolean(condition), evidence });

const currentRouteMarkers = [
  "router.get('/artifact-manifest.json'",
  "router.get('/browser/core.js'",
  "router.get('/browser/core.css'",
  'router.post(BRIDGE_ROUTE',
];
check(
  'SDK registers current browser assets and internal bridge route',
  currentRouteMarkers.every((marker) => sdkServer.includes(marker)) && sdkServer.includes("const BRIDGE_ROUTE = '/internal/bridge/v0/call'"),
  'server-plugin/index.js',
);
check(
  'SDK does not register retired workspace routes',
  !/(?:\/v[12]\/|X-SS-Helper-Plugin)/u.test(sdkServer),
  'server-plugin/index.js',
);
check('SDK does not load Memory implementation', !/SS-Helper-Memory|server[\\/]memory|import\([^)]*memory/iu.test(sdkServer), 'server-plugin/index.js');
check('SDK schema is workspace-generic', /CREATE TABLE IF NOT EXISTS workspace_records/u.test(sdkServer) && !/(?:facts|evidence|recall_logs|fact_vectors)/u.test(sdkServer), 'server-plugin/index.js');
check('WorkspacePort exposes generic owner operations', ['health()', 'integrity()', 'list(', 'clearOwned(', 'exportAll()', 'importAll('].every((token) => workspaceContract.includes(token)), 'packages/sdk/src/contracts/workspace.ts');
check('Memory repository depends on WorkspacePort', /WorkspacePort/u.test(memoryRepository) && !/MemorySqliteClient|\/api\/plugins\/ss-helper-sdk\//u.test(memoryRepository), 'SS-Helper-Memory/src/infrastructure/memory-repository.ts');
check('Memory runtime injects session.workspace', /new MemoryRepository\(session\.workspace\)/u.test(memoryRuntime), 'SS-Helper-Memory/src/host/memory-runtime.ts');
const memoryServer = path.join(memoryRoot, 'server');
check('Memory has no server plugin files', !existsSync(memoryServer) || readdirSync(memoryServer).length === 0, 'SS-Helper-Memory/server');
check('Root build never embeds Memory in SDK', !/server[\\/]memory|SS-Helper-Memory[^\n]*server/iu.test(buildScript), 'scripts/build-all.mjs');

const failed = checks.filter((item) => !item.ok);
console.log(JSON.stringify({ counts: { total: checks.length, passed: checks.length - failed.length, failed: failed.length }, checks }, null, 2));
if (failed.length) process.exitCode = 1;
