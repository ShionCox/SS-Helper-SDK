import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { contentDigest, createDeterministicZip, inventory, rewriteSdkImports, sha256File, verifyInventory, walkFiles } from './artifact-lib.mjs';
import { createEvidenceSanitizer } from './evidence-sanitizer.mjs';

const root = process.cwd();
const artifactDirectory = path.join(root, 'artifacts');
const startedAt = new Date().toISOString();
const externalRoot = mkdtempSync(path.join(os.tmpdir(), 'ss-helper-g005-'));
const commandLog = [];
const llmRoot = process.env.SS_HELPER_LLM_ROOT;
const memoryRoot = process.env.SS_HELPER_MEMORY_ROOT;
const { sanitizeText: sanitizeEvidenceText, sanitizeValue: sanitizeEvidenceValue } = createEvidenceSanitizer({
  repoRoot: root,
  temporaryRoot: externalRoot,
  llmRoot: llmRoot === undefined ? undefined : path.resolve(llmRoot),
  memoryRoot: memoryRoot === undefined ? undefined : path.resolve(memoryRoot),
  userProfile: os.homedir(),
});

function directCommand(commandName, args) {
  if (process.platform !== 'win32') return { commandName, args };
  if (commandName === 'pnpm') {
    let cli = process.env.npm_execpath;
    if (cli === undefined || !/pnpm\.(?:c?js)$/iu.test(cli)) {
      const located = spawnSync('where.exe', ['pnpm.cmd'], { encoding: 'utf8' });
      if (located.status !== 0) throw new Error('pnpm.cmd could not be located');
      cli = path.join(path.dirname(located.stdout.trim().split(/\r?\n/u)[0]), 'node_modules', 'pnpm', 'bin', 'pnpm.cjs');
    }
    return { commandName: process.execPath, args: [cli, ...args] };
  }
  if (/tsc\.cmd$/iu.test(commandName)) {
    return { commandName: process.execPath, args: [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), ...args] };
  }
  return { commandName, args };
}

function command(commandName, args, options = {}) {
  const cwd = options.cwd ?? root;
  const started = new Date().toISOString();
  const direct = directCommand(commandName, args);
  const result = spawnSync(direct.commandName, direct.args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    stdio: options.capture === true ? 'pipe' : 'inherit',
  });
  commandLog.push({
    command: sanitizeEvidenceText([commandName, ...args].join(' ')),
    cwd: cwd === root ? '.' : sanitizeEvidenceText(cwd),
    startedAt: started,
    completedAt: new Date().toISOString(),
    exitCode: result.status ?? 1,
  });
  if (result.status !== 0) {
    throw new Error(`${sanitizeEvidenceText([commandName, ...args].join(' '))} failed (${result.status ?? 'no exit code'})\n${sanitizeEvidenceText(result.stderr ?? '')}`);
  }
  return (result.stdout ?? '').trim();
}

function relativeArtifact(file) {
  return path.relative(root, file).replaceAll('\\', '/');
}

function copyJavaScriptTree(sourceRoot, targetRoot, transform) {
  for (const relative of walkFiles(sourceRoot).filter((file) => file.endsWith('.js'))) {
    const source = path.join(sourceRoot, ...relative.split('/'));
    const target = path.join(targetRoot, ...relative.split('/'));
    mkdirSync(path.dirname(target), { recursive: true });
    const contents = readFileSync(source, 'utf8');
    const output = transform === undefined ? contents : transform(contents, target);
    writeFileSync(target, output.replace(/\r\n?/gu, '\n'));
  }
}

function createZip(stageRoot, zipFile) {
  createDeterministicZip(stageRoot, zipFile);
}

function extractArchive(archive, destination) {
  mkdirSync(destination, { recursive: true });
  command('tar', ['-xf', archive, '-C', destination]);
}

function assertCanonicalPackedText(tarball) {
  const extracted = path.join(externalRoot, 'canonical-sdk-text');
  extractArchive(tarball, extracted);
  for (const relative of ['README.md', 'LICENSE', 'package.json']) {
    const contents = readFileSync(path.join(extracted, 'package', relative), 'utf8');
    if (/\r/u.test(contents)) throw new Error(`SDK tarball ${relative} is not canonical LF text`);
  }
}

function sdkGate() {
  command('pnpm', ['build:sdk']);
  command('pnpm', ['pack:sdk']);
  const tarballs = readdirSync(artifactDirectory).filter((name) => name.endsWith('.tgz'));
  if (tarballs.length !== 1) throw new Error(`Expected exactly one SDK tarball, got ${tarballs.length}`);
  const tarball = path.join(artifactDirectory, tarballs[0]);
  const firstPackSha256 = sha256File(tarball);
  command('pnpm', ['pack:sdk']);
  if (sha256File(tarball) !== firstPackSha256) throw new Error('SDK tarball bytes are not reproducible');
  assertCanonicalPackedText(tarball);
  const listing = command('tar', ['-tf', tarball], { capture: true }).split(/\r?\n/u).filter(Boolean).sort();
  for (const entry of listing) {
    if (!/^package\/(?:dist\/|README\.md$|LICENSE$|package\.json$)/u.test(entry)) {
      throw new Error(`Unexpected SDK tarball entry: ${entry}`);
    }
    if (/(?:^|\/)src\/|(?:^|\/)tests\/|\.omx|node_modules/u.test(entry)) {
      throw new Error(`Private SDK tarball entry: ${entry}`);
    }
  }
  const packageJson = JSON.parse(readFileSync(path.join(root, 'packages/sdk/package.json'), 'utf8'));
  for (const [exportName, target] of Object.entries(packageJson.exports)) {
    if (Object.keys(target)[0] !== 'types') throw new Error(`SDK export ${exportName} is not types-first`);
    for (const field of ['types', 'import', 'default']) {
      const packed = `package/${target[field].replace(/^\.\//u, '')}`;
      if (!listing.includes(packed)) throw new Error(`SDK export ${exportName} is missing ${field}: ${packed}`);
    }
  }

  const consumer = path.join(externalRoot, 'tarball-consumer');
  mkdirSync(consumer, { recursive: true });
  const externalTarball = path.join(consumer, path.basename(tarball));
  copyFileSync(tarball, externalTarball);
  writeFileSync(path.join(consumer, 'package.json'), `${JSON.stringify({
    name: 'ss-helper-artifact-consumer',
    private: true,
    type: 'module',
    dependencies: { '@ss-helper/sdk': `file:./${path.basename(externalTarball)}` },
  }, null, 2)}\n`);
  writeFileSync(path.join(consumer, 'consumer.ts'), [
    "import { LLM_COMPLETION_V1, LLM_STRUCTURED_TASK_V1, LLM_EMBEDDING_V1, LLM_RERANK_V1, LLM_ROUTE_DIAGNOSTICS_V1, type LlmCompletionRequest } from '@ss-helper/sdk';",
    "import { CORE_PLUGIN_ID } from '@ss-helper/sdk/contracts/core';",
    "const request: LlmCompletionRequest = { messages: [{ role: 'user', content: 'artifact' }] };",
    "if (CORE_PLUGIN_ID !== 'ss-helper.core' || [LLM_COMPLETION_V1, LLM_STRUCTURED_TASK_V1, LLM_EMBEDDING_V1, LLM_RERANK_V1, LLM_ROUTE_DIAGNOSTICS_V1].some(token => token.version !== 1) || request.messages.length !== 1) throw new Error('runtime export smoke failed');",
  ].join('\n'));
  writeFileSync(path.join(consumer, 'tsconfig.nodenext.json'), `${JSON.stringify({
    compilerOptions: { strict: true, noEmit: true, target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext' },
    include: ['consumer.ts'],
  }, null, 2)}\n`);
  writeFileSync(path.join(consumer, 'tsconfig.bundler.json'), `${JSON.stringify({
    compilerOptions: { strict: true, noEmit: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler' },
    include: ['consumer.ts'],
  }, null, 2)}\n`);
  command('pnpm', ['install', '--lockfile-only', '--ignore-workspace'], { cwd: consumer });
  command('pnpm', ['install', '--frozen-lockfile', '--ignore-workspace'], { cwd: consumer });
  const tsc = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
  command(tsc, ['-p', 'tsconfig.nodenext.json'], { cwd: consumer });
  command(tsc, ['-p', 'tsconfig.bundler.json'], { cwd: consumer });
  renameSync(externalTarball, `${externalTarball}.verified`);
  writeFileSync(path.join(consumer, 'runtime.mjs'), "import { CORE_PLUGIN_ID } from '@ss-helper/sdk';\nif (CORE_PLUGIN_ID !== 'ss-helper.core') process.exit(1);\n");
  command('node', ['runtime.mjs'], { cwd: consumer });
  const installedSdk = realpathSync(path.join(consumer, 'node_modules/@ss-helper/sdk'));
  if (installedSdk.startsWith(realpathSync(root))) throw new Error('Fresh SDK consumer resolved into the repository');
  return {
    tarball,
    listing,
    sha256: sha256File(tarball),
    size: readFileSync(tarball).byteLength,
    installedSdk,
  };
}

function buildCoreArtifact() {
  command('pnpm', ['build:core']);
  const stage = path.join(externalRoot, 'core-stage');
  const extensionRoot = path.join(stage, 'third-party', 'SS-Helper-SDK');
  const libraryRoot = path.join(extensionRoot, 'lib');
  const sdkRoot = path.join(extensionRoot, 'vendor', 'sdk');
  mkdirSync(libraryRoot, { recursive: true });
  mkdirSync(sdkRoot, { recursive: true });
  copyJavaScriptTree(path.join(root, 'packages/sdk/dist'), sdkRoot);
  copyJavaScriptTree(
    path.join(root, 'apps/core-extension/dist'),
    libraryRoot,
    (source, output) => rewriteSdkImports(source, output, sdkRoot),
  );

  const baseManifest = JSON.parse(readFileSync(path.join(root, 'apps/core-extension/manifest.json'), 'utf8'));
  const extensionManifest = { ...baseManifest, js: 'index.js', css: 'styles.css' };
  writeFileSync(path.join(extensionRoot, 'manifest.json'), `${JSON.stringify(extensionManifest, null, 2)}\n`);
  writeFileSync(path.join(extensionRoot, 'styles.css'), readFileSync(path.join(root, 'apps/core-extension/assets/styles.css'), 'utf8').replace(/\r\n?/gu, '\n'));
  writeFileSync(path.join(extensionRoot, 'index.js'), [
    "import { installCoreRuntime } from './lib/runtime/install-core-runtime.js';",
    "import { createSillyTavernHostBridge } from './lib/host/silly-tavern-adapter.js';",
    "const response = await fetch(new URL('./artifact-manifest.json', import.meta.url));",
    "if (!response.ok) throw new Error(`SS-Helper Core artifact manifest could not be loaded (${response.status})`);",
    'const artifact = await response.json();',
    'const host = createSillyTavernHostBridge(globalThis);',
    'if (host.capabilities.length === 0) throw new Error("SS-Helper Core found no supported SillyTavern host capabilities");',
    'export const coreRuntime = installCoreRuntime({',
    '  coreVersion: artifact.coreVersion,',
    '  sdkPackageVersion: artifact.sdkPackageVersion,',
    '  apiMajor: artifact.apiMajor,',
    '  apiMinor: artifact.apiMinor,',
    '  buildId: artifact.buildId,',
    '  contentDigest: artifact.contentDigest,',
    '  capabilities: host.capabilities,',
    "}, globalThis, { hostAdapter: host.hostAdapter, document: globalThis.document, settingsContainer: globalThis.document?.querySelector?.('#extensions_settings') ?? globalThis.document?.body });",
  ].join('\n'));

  const packageJson = JSON.parse(readFileSync(path.join(root, 'packages/sdk/package.json'), 'utf8'));
  const tsc = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
  const toolchain = {
    node: process.version,
    pnpm: command('pnpm', ['--version'], { capture: true }),
    typescript: command(tsc, ['--version'], { capture: true }),
    os: `${os.type()} ${os.release()} ${os.arch()}`,
  };
  const files = inventory(extensionRoot, new Set(['artifact-manifest.json']));
  const manifest = {
    schemaVersion: 1,
    artifactName: '@ss-helper/core-extension',
    installDirectory: 'third-party/SS-Helper-SDK',
    coreVersion: extensionManifest.version,
    sdkPackageVersion: packageJson.version,
    apiMajor: 1,
    apiMinor: 3,
    buildId: `core-${extensionManifest.version}-sdk-${packageJson.version}-api-1.3`,
    contentDigest: contentDigest(files),
    toolchain,
    files,
  };
  writeFileSync(path.join(extensionRoot, 'artifact-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  verifyInventory(extensionRoot, manifest);
  const zipFile = path.join(artifactDirectory, `ss-helper-core-${extensionManifest.version}.zip`);
  createZip(stage, zipFile);
  const reproducedZip = path.join(externalRoot, `reproduced-${path.basename(zipFile)}`);
  createZip(stage, reproducedZip);
  if (sha256File(reproducedZip) !== sha256File(zipFile)) throw new Error('Core archive bytes are not reproducible');
  return {
    zipFile,
    manifest,
    archiveSha256: sha256File(zipFile),
    size: readFileSync(zipFile).byteLength,
    reproducible: true,
  };
}

function makeConsumerBundle(name, installedSdk, source) {
  const bundle = path.join(externalRoot, name);
  cpSync(path.join(installedSdk, 'dist'), path.join(bundle, 'sdk'), { recursive: true });
  writeFileSync(path.join(bundle, 'manifest.json'), `${JSON.stringify({
    display_name: name,
    loading_order: 100,
    requires: [],
    optional: [],
    js: 'index.js',
    author: 'SS-Helper artifact gate',
    version: '1.0.0',
    auto_update: false,
  }, null, 2)}\n`);
  writeFileSync(path.join(bundle, 'index.js'), source);
  for (const file of walkFiles(bundle)) {
    const contents = readFileSync(path.join(bundle, ...file.split('/')), 'utf8');
    if (/core-extension|apps\/core|node_modules/u.test(file)
      || /(?:workspace:(?:\*|\^|~|\d)|link:(?:\.|\/))/u.test(contents)) {
      throw new Error(`${name} embeds Core or uses a workspace/sibling dependency`);
    }
  }
  return bundle;
}

function artifactSmoke(core, sdk) {
  const installed = path.join(externalRoot, 'core-install');
  extractArchive(core.zipFile, installed);
  const extension = path.join(installed, 'third-party', 'SS-Helper-SDK');
  const manifest = JSON.parse(readFileSync(path.join(extension, 'artifact-manifest.json'), 'utf8'));
  verifyInventory(extension, manifest);
  if (JSON.stringify(manifest) !== JSON.stringify(core.manifest)) {
    throw new Error('Installed Core manifest differs from the built manifest');
  }

  const consumerA = makeConsumerBundle('gate-consumer-a', sdk.installedSdk, [
    "import * as sdk from './sdk/index.js';",
    "const discoverySymbol = Symbol.for('@ss-helper/core.discovery');",
    'globalThis.__SSHelperArtifactConsumers ??= {};',
    'const state = globalThis.__SSHelperArtifactConsumers.a = { id: "fixture.consumer-a", state: "loading" };',
    'try {',
    '  const discoveryBefore = globalThis[discoverySymbol];',
    '  state.discoveryBefore = discoveryBefore?.descriptor;',
    '  state.generationBefore = discoveryBefore?.descriptor?.generation;',
    "  const requested = ['tavern.context.read','tavern.chat.read','tavern.chat.events','tavern.worldbooks.read','tavern.worldbooks.write','tavern.generation.read','tavern.prompt.contribute','tavern.plugin.request','tavern.plugin.binary-request.v1'];",
    "  const session = await sdk.connectSSHelper({ id:'fixture.consumer-a', displayName:'A', pluginVersion:'1.0.0', sdkPackageVersion:'1.0.0', apiMajor:1, minApiMinor:0, capabilities:requested }, { target: globalThis, timeoutMs:10000 });",
    '  const context = await session.host.context.read();',
    '  const chat = await session.host.chat.readCurrent();',
    '  const unsubscribe = session.host.events.subscribe("chat-changed", () => {}); unsubscribe();',
    "  const worldbookName = 'SS Helper Gate Worldbook';",
    "  await session.host.worldbooks.save({ id:worldbookName, name:worldbookName, active:false, entries:[{ id:'1', keys:['gate'], secondaryKeys:['proof'], content:'created', enabled:true, position:0, order:10 }] });",
    '  const worldbookListed = (await session.host.worldbooks.list()).some((book) => book.id === worldbookName);',
    '  const worldbookLoaded = await session.host.worldbooks.load(worldbookName);',
    '  await session.host.worldbooks.setActive(worldbookName, true);',
    '  const worldbookActive = (await session.host.worldbooks.active()).some((book) => book.id === worldbookName);',
    "  await session.host.worldbooks.save({ id:worldbookName, name:worldbookName, active:true, entries:[{ id:'1', keys:['gate'], secondaryKeys:['proof'], content:'updated', enabled:false, position:0, order:10 }] });",
    '  const worldbookUpdated = await session.host.worldbooks.load(worldbookName);',
    '  await session.host.worldbooks.setActive(worldbookName, false); await session.host.worldbooks.delete(worldbookName);',
    '  const worldbookDeleted = !(await session.host.worldbooks.list()).some((book) => book.id === worldbookName);',
    '  const generation = await session.host.generation.current();',
    '  const generationAvailable = await session.host.generation.available();',
    "  await session.host.prompt.set({ id:'fixture.consumer-a.gate', content:'artifact gate' }); await session.host.prompt.remove('fixture.consumer-a.gate');",
    "  const requestResponse = await session.host.request.send({ path:'/api/settings/get', method:'POST', body:{} });",
    "  const binaryBody = { encoding:'base64', contentType:'application/vnd.sqlite3', data:'U1FMaXRlIGZvcm1hdCAzAEcwMTEgYmluYXJ5IGdhdGU=', byteLength:32, sha256:'0c05ece4802d8aba9072dcd878fcf3ba519e67c66c82ff0754e6749ca87216c1' };",
    "  const binaryExport = await session.host.binaryRequest.send({ version:1, path:'/api/plugins/ss-helper-gate-binary/export', method:'POST', responseMode:'binary' });",
    "  const binaryImport = await session.host.binaryRequest.send({ version:1, path:'/api/plugins/ss-helper-gate-binary/import', method:'POST', responseMode:'json', body:binaryBody });",
    "  const legacyMemoryRoute = await session.host.request.send({ path:'/api/plugins/ss-helper-sdk/v1/memory/health', method:'GET' });",
    '  state.host = { requested, granted:[...session.host.capabilities], context:{ chatKey:context.chatKey }, chat:chat===null?null:{ key:chat.key, messageCount:chat.messageCount }, events:{ subscribedAndRemoved:true }, worldbooks:{ granted:true, listed:worldbookListed, loadedEntry:worldbookLoaded?.entries?.[0], active:worldbookActive, updatedEntry:worldbookUpdated?.entries?.[0], deleted:worldbookDeleted }, generation:{ available:generationAvailable, active:generation.active, provider:generation.provider, model:generation.model }, prompt:{ setAndRemoved:true }, request:{ status:requestResponse.status, ok:requestResponse.ok }, binaryRequest:{ export:{ status:binaryExport.status, ok:binaryExport.ok, contentType:binaryExport.contentType, data:binaryExport.data, byteLength:binaryExport.byteLength, sha256:binaryExport.sha256, filename:binaryExport.filename }, import:{ status:binaryImport.status, ok:binaryImport.ok, body:binaryImport.body } }, legacyMemoryRoute:{ status:legacyMemoryRoute.status, ok:legacyMemoryRoute.ok } };',
    "  const contract = Object.freeze({ kind:'service', provider:'fixture.consumer-a', name:'echo', version:1, schemaId:'fixture.consumer-a.echo.v1' });",
    "  session.registerSettings({ id:'fixture.consumer-a', title:'A', fields:[{ kind:'text', id:'value', label:'Value' }] }, { load:()=>({value:'a'}), save:()=>{}, reset:()=>({value:'a'}) });",
    '  session.services.expose(contract, (request) => ({ value:request.value }));',
    '  state.discoveryAfter = globalThis[discoverySymbol].descriptor;',
    '  state.sameDiscovery = globalThis[discoverySymbol] === discoveryBefore;',
    '  state.generationAfter = globalThis[discoverySymbol].descriptor.generation;',
    '  state.state = "ready";',
    '} catch (error) { state.state = "failed"; state.error = String(error?.stack ?? error); throw error; }',
  ].join('\n'));
  const consumerB = makeConsumerBundle('gate-consumer-b', sdk.installedSdk, [
    "import * as sdk from './sdk/index.js';",
    "const discoverySymbol = Symbol.for('@ss-helper/core.discovery');",
    'globalThis.__SSHelperArtifactConsumers ??= {};',
    'const state = globalThis.__SSHelperArtifactConsumers.b = { id: "fixture.consumer-b", state: "loading" };',
    'try {',
    '  const discoveryBefore = globalThis[discoverySymbol];',
    '  state.discoveryBefore = discoveryBefore?.descriptor;',
    "  const requested = ['tavern.context.read'];",
    "  const session = await sdk.connectSSHelper({ id:'fixture.consumer-b', displayName:'B', pluginVersion:'1.0.0', sdkPackageVersion:'1.0.0', apiMajor:1, minApiMinor:0, capabilities:requested }, { target: globalThis, timeoutMs:10000 });",
    '  const context = await session.host.context.read(); state.host = { requested, granted:[...session.host.capabilities], context:{ chatKey:context.chatKey } };',
    "  const contract = Object.freeze({ kind:'service', provider:'fixture.consumer-a', name:'echo', version:1, schemaId:'fixture.consumer-a.echo.v1' });",
    '  await session.services.waitFor(contract, { timeoutMs:10000 });',
    "  state.response = await session.services.call(contract, { value:'artifact', apiKey:'GATE_API_KEY_SENTINEL', prompt:'GATE_PROMPT_SENTINEL', cookie:'GATE_COOKIE_SENTINEL', csrf:'GATE_CSRF_SENTINEL', authorization:'Bearer GATE_AUTH_SENTINEL', sqliteBase64:'U1FMaXRlIEdBVEVfU1FMSVRFX1NFTlRJTkVM', userContent:'GATE_USER_CONTENT_SENTINEL' }, { timeoutMs:10000 });",
    '  state.discoveryAfter = globalThis[discoverySymbol].descriptor;',
    '  state.sameDiscovery = globalThis[discoverySymbol] === discoveryBefore;',
    '  state.generationAfter = globalThis[discoverySymbol].descriptor.generation;',
    '  state.state = "ready";',
    '} catch (error) { state.state = "failed"; state.error = String(error?.stack ?? error); throw error; }',
  ].join('\n'));

  const browserSmokeArgs = [
    path.join(root, 'scripts', 'real-st-browser-smoke.mjs'),
    `--coreZip=${core.zipFile}`,
    `--consumerA=${consumerA}`,
    `--consumerB=${consumerB}`,
    `--contentDigest=${core.manifest.contentDigest}`,
  ];
  if (Boolean(llmRoot) !== Boolean(memoryRoot)) {
    throw new Error('SS_HELPER_LLM_ROOT and SS_HELPER_MEMORY_ROOT must be set together');
  }
  if (llmRoot !== undefined && memoryRoot !== undefined) {
    browserSmokeArgs.push(`--llmRoot=${path.resolve(llmRoot)}`, `--memoryRoot=${path.resolve(memoryRoot)}`);
  }
  const output = command('node', browserSmokeArgs, { capture: true });
  return JSON.parse(output.split(/\r?\n/u).at(-1));
}

try {
  command('pnpm', ['install', '--frozen-lockfile']);
  rmSync(artifactDirectory, { recursive: true, force: true });
  rmSync(path.join(root, 'packages/sdk/dist'), { recursive: true, force: true });
  rmSync(path.join(root, 'apps/core-extension/dist'), { recursive: true, force: true });
  mkdirSync(artifactDirectory, { recursive: true });
  const sdk = sdkGate();
  const core = buildCoreArtifact();
  const smoke = artifactSmoke(core, sdk);
  const evidence = {
    schemaVersion: 1,
    gate: 'G009-g5a-host-llm-artifact',
    status: 'PASS',
    startedAt,
    completedAt: new Date().toISOString(),
    sdk: {
      path: relativeArtifact(sdk.tarball),
      size: sdk.size,
      sha256: sdk.sha256,
      files: sdk.listing,
      freshInstall: 'PASS',
      nodeNextTypecheck: 'PASS',
      bundlerTypecheck: 'PASS',
      runtimeSmoke: 'PASS',
    },
    core: {
      path: relativeArtifact(core.zipFile),
      size: core.size,
      archiveSha256: core.archiveSha256,
      contentDigest: core.manifest.contentDigest,
      archiveReproducible: core.reproducible,
      files: core.manifest.files,
      artifactManifest: core.manifest,
      coreOnlySmoke: smoke.coreOnly,
      officialSillyTavern: smoke.st,
      browser: smoke.browser,
    },
    dualConsumer: smoke,
    commands: commandLog,
  };
  writeFileSync(path.join(artifactDirectory, 'g009-release-evidence.json'), `${JSON.stringify(sanitizeEvidenceValue(evidence), null, 2)}\n`);
  writeFileSync(path.join(artifactDirectory, 'README.md'), `# G009 artifact gate\n\nStatus: PASS\n\n- Host capabilities: ${smoke.discovery.capabilities.join(', ')}\n- LLM contracts: completion, structured-task, embedding, rerank, route-diagnostics\n- SDK: \`${relativeArtifact(sdk.tarball)}\`\n  - SHA-256: \`${sdk.sha256}\`\n- Core: \`${relativeArtifact(core.zipFile)}\`\n  - archive SHA-256: \`${core.archiveSha256}\`\n  - contentDigest: \`${core.manifest.contentDigest}\`\n- Fresh install: PASS (NodeNext + Bundler + runtime)\n- Core-only smoke: PASS (official SillyTavern ${smoke.st.tag} at ${smoke.st.commit})\n- Real browser: ${smoke.browser.product}\n- Dual-consumer smoke: PASS (generation ${smoke.discovery.generation}, settings roots ${smoke.settingsRoots}, Core instances ${smoke.coreInstances})\n\nReproduce from the repository root with \`pnpm artifact:gate\`.\n`);
  console.log(`PASS G009 artifact gate\nSDK ${relativeArtifact(sdk.tarball)} ${sdk.sha256}\nCore ${relativeArtifact(core.zipFile)} ${core.archiveSha256}\ncontentDigest ${core.manifest.contentDigest}`);
} finally {
  rmSync(externalRoot, { recursive: true, force: true });
}
