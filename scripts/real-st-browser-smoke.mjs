import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ST_TAG = '1.18.0';
const ST_COMMIT = '51ad27fb86d39a3daca3adaa970375c9670c12df';
const ST_REPOSITORY = 'https://github.com/SillyTavern/SillyTavern.git';

function fail(message, processResult) {
  const detail = processResult === undefined ? '' : `\n${processResult.error?.stack || processResult.stderr || processResult.stdout || ''}`;
  throw new Error(`${message}${detail}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: options.cwd, encoding: 'utf8', shell: false });
  if (result.status !== 0) fail(`${command} ${args.join(' ')} failed`, result);
  return result.stdout.trim();
}

function npmInvocation(args) {
  if (process.platform !== 'win32') return { command: 'npm', args };
  const npmCommand = run('where.exe', ['npm.cmd']).split(/\r?\n/u)[0];
  const npmCli = path.join(path.dirname(npmCommand), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  assert.ok(existsSync(npmCli), 'npm CLI entry point is missing');
  return { command: process.execPath, args: [npmCli, ...args] };
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function cacheDirectory() {
  const base = process.platform === 'win32'
    ? (process.env.LOCALAPPDATA || os.tmpdir())
    : (process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'));
  return path.join(base, 'ss-helper-g005-cache', `SillyTavern-${ST_TAG}`);
}

function verifyOfficialCheckout(root) {
  assert.equal(run('git', ['rev-parse', 'HEAD'], { cwd: root }), ST_COMMIT, 'SillyTavern commit mismatch');
  assert.equal(run('git', ['rev-list', '-n', '1', ST_TAG], { cwd: root }), ST_COMMIT, 'SillyTavern tag mismatch');
  assert.equal(run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root }), '', 'SillyTavern tracked checkout is dirty');
  const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(packageJson.version, ST_TAG, 'SillyTavern package version mismatch');
  assert.ok(Number(process.versions.node.split('.')[0]) >= 18, 'SillyTavern requires Node >=18');
}

function prepareOfficialSillyTavern() {
  const root = cacheDirectory();
  mkdirSync(path.dirname(root), { recursive: true });
  if (!existsSync(path.join(root, '.git'))) {
    rmSync(root, { recursive: true, force: true });
    run('git', ['clone', '--depth', '1', '--branch', ST_TAG, ST_REPOSITORY, root]);
  }
  run('git', ['fetch', '--depth', '1', 'origin', `tag`, ST_TAG, '--force'], { cwd: root });
  run('git', ['checkout', '--detach', ST_TAG], { cwd: root });
  verifyOfficialCheckout(root);
  const lockfile = path.join(root, 'package-lock.json');
  assert.ok(existsSync(lockfile), 'Official SillyTavern package-lock.json is missing');
  const lockDigest = sha256File(lockfile);
  const installMarker = path.join(root, 'node_modules', '.ss-helper-g005-lock-sha256');
  if (!existsSync(installMarker) || readFileSync(installMarker, 'utf8').trim() !== lockDigest) {
    const npm = npmInvocation(['ci', '--ignore-scripts=false']);
    run(npm.command, npm.args, { cwd: root });
    writeFileSync(installMarker, `${lockDigest}\n`);
  }
  assert.equal(readFileSync(installMarker, 'utf8').trim(), lockDigest, 'Cached SillyTavern install lockfile mismatch');
  verifyOfficialCheckout(root);
  return { root, lockDigest };
}

function browserExecutable() {
  const candidates = process.platform === 'win32' ? [
    ['Chrome', path.join(process.env.PROGRAMFILES || '', 'Google/Chrome/Application/chrome.exe')],
    ['Chrome', path.join(process.env['PROGRAMFILES(X86)'] || '', 'Google/Chrome/Application/chrome.exe')],
    ['Chrome', path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe')],
    ['Edge', path.join(process.env.PROGRAMFILES || '', 'Microsoft/Edge/Application/msedge.exe')],
    ['Edge', path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft/Edge/Application/msedge.exe')],
  ] : process.platform === 'darwin' ? [
    ['Chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    ['Edge', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  ] : [
    ['Chrome', '/usr/bin/google-chrome'],
    ['Chrome', '/usr/bin/google-chrome-stable'],
    ['Chromium', '/usr/bin/chromium'],
    ['Edge', '/usr/bin/microsoft-edge'],
  ];
  const found = candidates.find(([, executable]) => executable !== '' && existsSync(executable));
  if (found === undefined) throw new Error('No approved Chrome or Edge executable was found');
  return { name: found[0], executable: found[1] };
}

async function freePort() {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitFor(description, callback, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await callback();
      if (value) return value;
    } catch (error) { lastError = error; }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${description}${lastError === undefined ? '' : `: ${lastError.message}`}`);
}

const WINDOWS_CLEANUP_RETRY_CODES = new Set(['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM']);
const WINDOWS_CLEANUP_ATTEMPTS = 4;
const WINDOWS_CLEANUP_RETRY_DELAY_MS = 200;

function isTransientWindowsCleanupError(error) {
  return process.platform === 'win32' && WINDOWS_CLEANUP_RETRY_CODES.has(error?.code);
}

async function removeAfterChildrenStopped(entries, stopChildren) {
  let lastError;
  for (let attempt = 0; attempt <= WINDOWS_CLEANUP_ATTEMPTS; attempt += 1) {
    await stopChildren();
    for (const { root } of entries) {
      try {
        rmSync(root, {
          recursive: true,
          force: true,
          // Node retries only these documented transient recursive-removal errors.
          maxRetries: WINDOWS_CLEANUP_ATTEMPTS,
          retryDelay: WINDOWS_CLEANUP_RETRY_DELAY_MS,
        });
      } catch (error) {
        if (!isTransientWindowsCleanupError(error)) throw error;
        lastError = error;
      }
    }
    const remaining = entries.filter(({ root }) => existsSync(root));
    if (remaining.length === 0) {
      if (process.platform !== 'win32') return;
      // taskkill can report the root process gone before a descendant releases
      // its plugin namespace. Require all staged removals to remain stable for
      // one bounded backoff interval rather than accepting a transient absence.
      await new Promise((resolve) => setTimeout(resolve, WINDOWS_CLEANUP_RETRY_DELAY_MS * (attempt + 1)));
      if (entries.every(({ root }) => !existsSync(root))) return;
    }
    if (process.platform !== 'win32' || attempt === WINDOWS_CLEANUP_ATTEMPTS) break;
    await new Promise((resolve) => setTimeout(resolve, WINDOWS_CLEANUP_RETRY_DELAY_MS * (attempt + 1)));
  }
  const detail = lastError === undefined ? 'directory persisted after removal' : `${lastError.code}: ${lastError.message}`;
  const remaining = entries.filter(({ root }) => existsSync(root)).map(({ description }) => description).join(', ');
  throw new Error(`Failed to remove ${remaining || 'staged directories'} after child-tree shutdown: ${detail}`);
}

function processAlive(child) {
  if (child === undefined || child.exitCode !== null) return false;
  try { process.kill(child.pid, 0); return true; } catch { return false; }
}

async function stop(child) {
  if (!processAlive(child)) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
  else child.kill('SIGTERM');
  await waitFor(`process ${child.pid} cleanup`, () => !processAlive(child), 10_000);
}

class CdpSession {
  constructor(url) {
    if (typeof WebSocket !== 'function') throw new Error('This gate requires Node built-in WebSocket support');
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', () => reject(new Error('CDP WebSocket failed to open')), { once: true });
      this.socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data));
        if (message.id === undefined) {
          this.events.push(message);
          if (this.events.length > 200) this.events.shift();
          return;
        }
        const pending = this.pending.get(message.id);
        if (pending === undefined) return;
        this.pending.delete(message.id);
        if (message.error !== undefined) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      });
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.socket.close(); }
}

async function evaluate(session, expression) {
  const result = await session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails !== undefined) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

function parseArguments() {
  const values = Object.fromEntries(process.argv.slice(2).map((argument) => {
    const split = argument.indexOf('=');
    if (split < 1) throw new Error(`Invalid argument: ${argument}`);
    return [argument.slice(2, split), argument.slice(split + 1)];
  }));
  for (const name of ['coreZip', 'consumerA', 'consumerB', 'contentDigest']) {
    if (!values[name]) throw new Error(`Missing --${name}=...`);
  }
  if (Boolean(values.llmRoot) !== Boolean(values.memoryRoot)) {
    throw new Error('--llmRoot and --memoryRoot must be provided together');
  }
  return values;
}

async function main() {
  const args = parseArguments();
  const st = prepareOfficialSillyTavern();
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'ss-helper-real-st-'));
  let server;
  let browser;
  let cdp;
  let serverPluginRoot;
  let jointArtifacts;
  let result;
  let cleanup;
  let profile;
  const stagedExtensionRoots = [];
  const serverOutput = [];
  try {
    const dataRoot = path.join(temporary, 'data');
    const extensionRoot = path.join(dataRoot, 'default-user', 'extensions', 'SS-Helper-SDK');
    const extracted = path.join(temporary, 'core-extracted');
    mkdirSync(extracted, { recursive: true });
    run('tar', ['-xf', path.resolve(args.coreZip), '-C', extracted]);
    cpSync(path.join(extracted, 'third-party', 'SS-Helper-SDK'), extensionRoot, { recursive: true });
    const consumerARoot = path.join(dataRoot, 'default-user', 'extensions', 'SS-Helper-Gate-Consumer-A');
    const consumerBRoot = path.join(dataRoot, 'default-user', 'extensions', 'SS-Helper-Gate-Consumer-B');
    cpSync(path.resolve(args.consumerA), consumerARoot, { recursive: true });
    cpSync(path.resolve(args.consumerB), consumerBRoot, { recursive: true });
    stagedExtensionRoots.push(extensionRoot, consumerARoot, consumerBRoot);
    const jointConsumers = args.llmRoot !== undefined;
    if (jointConsumers) {
      const llmRoot = path.resolve(args.llmRoot);
      const memoryRoot = path.resolve(args.memoryRoot);
      const llmExtension = path.join(dataRoot, 'default-user', 'extensions', 'SS-Helper-LLM');
      const memoryExtension = path.join(dataRoot, 'default-user', 'extensions', 'SS-Helper-Memory');
      mkdirSync(llmExtension, { recursive: true });
      mkdirSync(memoryExtension, { recursive: true });
      stagedExtensionRoots.push(llmExtension, memoryExtension);
      cpSync(path.join(llmRoot, 'manifest.json'), path.join(llmExtension, 'manifest.json'));
      cpSync(path.join(llmRoot, 'dist', 'runtime-entry.js'), path.join(llmExtension, 'index.js'));
      cpSync(path.join(memoryRoot, 'manifest.json'), path.join(memoryExtension, 'manifest.json'));
      cpSync(path.join(memoryRoot, 'dist', 'index.js'), path.join(memoryExtension, 'index.js'));
      cpSync(path.join(memoryRoot, 'dist', 'style.css'), path.join(memoryExtension, 'style.css'));
      for (const file of [
        path.join(llmExtension, 'index.js'),
        path.join(memoryExtension, 'index.js'),
        path.join(memoryExtension, 'style.css'),
      ]) assert.ok(existsSync(file), `Joint release output is missing: ${file}`);

      const llmManifest = JSON.parse(readFileSync(path.join(llmExtension, 'manifest.json'), 'utf8'));
      const memoryManifest = JSON.parse(readFileSync(path.join(memoryExtension, 'manifest.json'), 'utf8'));
      assert.deepEqual({ order: llmManifest.loading_order, js: llmManifest.js, minimumClientVersion: llmManifest.minimum_client_version }, {
        order: -900, js: 'index.js', minimumClientVersion: '1.18.0',
      });
      assert.deepEqual({ order: memoryManifest.loading_order, js: memoryManifest.js, css: memoryManifest.css, minimumClientVersion: memoryManifest.minimum_client_version }, {
        order: -9, js: 'index.js', css: 'style.css', minimumClientVersion: '1.18.0',
      });
      const artifactHash = (source, staged) => {
        const sourceSha256 = sha256File(source);
        const stagedSha256 = sha256File(staged);
        assert.equal(stagedSha256, sourceSha256, `Staged artifact hash mismatch: ${staged}`);
        return sourceSha256;
      };
      jointArtifacts = {
        llm: {
          extension: 'third-party/SS-Helper-LLM', version: llmManifest.version,
          runtimeSha256: artifactHash(path.join(llmRoot, 'dist', 'runtime-entry.js'), path.join(llmExtension, 'index.js')),
        },
        memory: {
          extension: 'third-party/SS-Helper-Memory', version: memoryManifest.version,
          runtimeSha256: artifactHash(path.join(memoryRoot, 'dist', 'index.js'), path.join(memoryExtension, 'index.js')),
          styleSha256: artifactHash(path.join(memoryRoot, 'dist', 'style.css'), path.join(memoryExtension, 'style.css')),
        },
      };
    }
    assert.ok(existsSync(path.join(extensionRoot, 'manifest.json')), 'Core extension root does not directly contain manifest.json');
    const artifactManifest = JSON.parse(readFileSync(path.join(extensionRoot, 'artifact-manifest.json'), 'utf8'));
    assert.equal(artifactManifest.contentDigest, args.contentDigest);

    serverPluginRoot = path.join(st.root, 'plugins', 'ss-helper-gate-binary');
    rmSync(serverPluginRoot, { recursive: true, force: true });
    mkdirSync(serverPluginRoot, { recursive: true });
    writeFileSync(path.join(serverPluginRoot, 'index.mjs'), [
      "import { createHash } from 'node:crypto';",
      "export const info = { id:'ss-helper-gate-binary', name:'SS Helper binary gate', description:'Ephemeral authenticated SQLite export/import routes for artifact verification' };",
      "const expected = Buffer.from('U1FMaXRlIGZvcm1hdCAzAEcwMTEgYmluYXJ5IGdhdGU=', 'base64');",
      "const expectedSha256 = createHash('sha256').update(expected).digest('hex');",
      'export async function init(router) {',
      "  router.post('/export', async (request, response) => {",
      "    if (typeof request.headers['x-csrf-token'] !== 'string' || request.headers['x-csrf-token'].length === 0) return response.sendStatus(403);",
      "    response.status(200).set('Content-Type', 'application/vnd.sqlite3').set('Content-Length', String(expected.length)).set('Content-Disposition', 'attachment; filename=gate.sqlite3').send(expected);",
      '  });',
      "  router.post('/import', async (request, response) => {",
      "    if (typeof request.headers['x-csrf-token'] !== 'string' || request.headers['x-csrf-token'].length === 0) return response.sendStatus(403);",
      '    const chunks = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));',
      '    const bytes = Buffer.concat(chunks);',
      "    const receivedSha256 = request.headers['x-content-sha256'];",
      "    response.status(200).json({ ok:true, data:{ bytesMatched:bytes.equals(expected), hashMatched:receivedSha256===expectedSha256, byteLength:bytes.length } });",
      '  });',
      '}',
    ].join('\n'));

    const port = await freePort();
    const configPath = path.join(temporary, 'config.yaml');
    const defaultConfigPath = existsSync(path.join(st.root, 'config.yaml'))
      ? path.join(st.root, 'config.yaml')
      : path.join(st.root, 'default', 'config.yaml');
    const gateConfig = readFileSync(defaultConfigPath, 'utf8')
      .replace(/enableServerPlugins:\s*false/u, 'enableServerPlugins: true')
      .replace(/enableServerPluginsAutoUpdate:\s*true/u, 'enableServerPluginsAutoUpdate: false');
    assert.match(gateConfig, /enableServerPlugins:\s*true/u);
    writeFileSync(configPath, gateConfig);
    server = spawn(process.execPath, [
      'server.js', '--dataRoot', dataRoot, '--configPath', configPath, '--port', String(port),
      '--listen', 'false', '--enableIPv4', 'true', '--enableIPv6', 'false', '--browserLaunchEnabled', 'false',
    ], { cwd: st.root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    for (const stream of [server.stdout, server.stderr]) stream.on('data', (chunk) => serverOutput.push(String(chunk)));
    const pageUrl = `http://127.0.0.1:${port}/`;
    await waitFor('official SillyTavern server', async () => {
      if (server.exitCode !== null) throw new Error(`SillyTavern exited ${server.exitCode}: ${serverOutput.join('').slice(-4000)}`);
      const response = await fetch(pageUrl);
      return response.ok;
    });

    const selectedBrowser = browserExecutable();
    profile = path.join(temporary, 'browser-profile');
    const debuggingPort = await freePort();
    browser = spawn(selectedBrowser.executable, [
      '--headless=new', '--disable-extensions', '--disable-component-extensions-with-background-pages',
      '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-background-networking',
      '--window-size=1488,1057', '--force-device-scale-factor=1',
      `--user-data-dir=${profile}`, `--remote-debugging-port=${debuggingPort}`, pageUrl,
    ], { stdio: 'ignore', windowsHide: true });
    const target = await waitFor('real browser CDP page', async () => {
      if (browser.exitCode !== null) throw new Error(`Browser exited ${browser.exitCode}`);
      const response = await fetch(`http://127.0.0.1:${debuggingPort}/json/list`);
      if (!response.ok) return undefined;
      const targets = await response.json();
      return targets.find((candidate) => candidate.type === 'page' && candidate.url.startsWith(pageUrl));
    });
    cdp = new CdpSession(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1488, height: 1057, deviceScaleFactor: 1, mobile: false });
    const browserVersion = await cdp.send('Browser.getVersion');
    let measured;
    try {
      measured = await waitFor('Core and artifact consumers in SillyTavern', async () => {
      const value = await evaluate(cdp, `(async () => {
        const discoverySymbol = Symbol.for('@ss-helper/core.discovery');
        const discovery = globalThis[discoverySymbol];
        const consumers = globalThis.__SSHelperArtifactConsumers;
        if (discovery?.descriptor?.state !== 'ready' || consumers?.a?.state !== 'ready' || consumers?.b?.state !== 'ready') return null;
        const onboardingConfirm = [...document.querySelectorAll('dialog[open] button, .popup button')]
          .find((button) => /^(确定|确认|confirm|ok)$/iu.test(button.textContent?.trim() ?? ''));
        if (onboardingConfirm instanceof HTMLButtonElement) {
          const onboardingDialog = onboardingConfirm.closest('dialog');
          if (onboardingDialog instanceof HTMLDialogElement && onboardingDialog.open) onboardingDialog.close();
          else onboardingConfirm.click();
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }
        const launcher = document.querySelector('#ss-helper-open-settings-center');
        if (!(launcher instanceof HTMLButtonElement)) return null;
        launcher.click();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        let center = document.querySelector('#ss-helper-settings-center');
        if (!(center instanceof HTMLElement)) return null;
        const jointSections = [...center.querySelectorAll('.stx-center-nav-item[data-plugin-id]')]
          .filter((section) => section.dataset.pluginId === 'ss-helper.llm' || section.dataset.pluginId === 'ss-helper.memory')
          .map((section) => ({ id: section.dataset.pluginId, health: section.dataset.health, title: section.querySelector('strong')?.textContent }));
        if (${jointConsumers} && jointSections.length !== 2) return null;
        const targetPlugin = center.querySelector('.stx-center-nav-item[data-plugin-id="ss-helper.memory"]')
          ?? center.querySelector('.stx-center-nav-item[data-plugin-id="ss-helper.llm"]')
          ?? center.querySelector('.stx-center-nav-item[data-plugin-id]:not([data-plugin-id="overview"])');
        targetPlugin?.click();
        const selectedTitle = center.querySelector('.stx-center-page-heading h3')?.textContent;
        const closeButton = center.querySelector('.stx-center-close');
        closeButton?.click();
        const closed = document.querySelectorAll('#ss-helper-settings-center-overlay').length === 0;
        launcher.click();
        await new Promise((resolve) => requestAnimationFrame(resolve));
        center = document.querySelector('#ss-helper-settings-center');
        return {
          pageTitle: document.title,
          userAgent: navigator.userAgent,
          discovery: discovery.descriptor,
          discoveryBeforeConsumers: consumers.a.discoveryBefore,
          discoveryAfterConsumerA: consumers.a.discoveryAfter,
          discoveryBeforeConsumerB: consumers.b.discoveryBefore,
          discoveryAfterConsumerB: consumers.b.discoveryAfter,
          sameDiscoveryAfterConsumerA: consumers.a.sameDiscovery,
          sameDiscoveryAfterConsumerB: consumers.b.sameDiscovery,
          generationBeforeConsumers: consumers.a.generationBefore,
          generationAfterConsumerA: consumers.a.generationAfter,
          generationAfterConsumerB: consumers.b.generationAfter,
          consumerResponse: consumers.b.response,
          consumerHostA: consumers.a.host,
          consumerHostB: consumers.b.host,
          consumers: [consumers.a.id, consumers.b.id],
          settingsRoots: document.querySelectorAll('#ss-helper-settings-root').length,
          settingsLaunchers: document.querySelectorAll('#ss-helper-open-settings-center').length,
          settingsCenter: {
            overlays: document.querySelectorAll('#ss-helper-settings-center-overlay').length,
            dialogs: document.querySelectorAll('#ss-helper-settings-center').length,
            closed,
            selectedTitle,
            navItems: center?.querySelectorAll('.stx-center-nav-item').length ?? 0,
          },
          coreInstances: Object.getOwnPropertySymbols(globalThis).filter((symbol) => Symbol.keyFor(symbol) === '@ss-helper/core.discovery').length,
          capabilities: discovery.descriptor.capabilities,
          worldbooks: consumers.a.host.worldbooks,
          diagnostics: discovery.port.diagnostics(),
          jointConsumers: jointSections,
        };
      })()`);
      return value;
      });
    } catch (error) {
      const debugState = await evaluate(cdp, `(() => ({
        readyState: document.readyState,
        discovery: globalThis[Symbol.for('@ss-helper/core.discovery')]?.descriptor ?? null,
        consumers: globalThis.__SSHelperArtifactConsumers ?? null,
        settingsRoot: document.querySelectorAll('#ss-helper-settings-root').length,
        extensionScripts: [...document.scripts].map((script) => script.src).filter((src) => src.includes('SS-Helper')),
      }))()`);
      const runtimeEvents = cdp.events
        .filter((event) => event.method === 'Runtime.exceptionThrown' || event.method === 'Runtime.consoleAPICalled')
        .slice(-40);
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nDEBUG ${JSON.stringify(debugState)}\nBROWSER ${JSON.stringify(runtimeEvents)}\nSERVER ${serverOutput.join('').slice(-6000)}`);
    }
    assert.equal(measured.discovery.artifact.contentDigest, args.contentDigest);
    assert.equal(measured.discovery.state, 'ready');
    assert.deepEqual(measured.discoveryBeforeConsumers, measured.discoveryAfterConsumerA);
    assert.deepEqual(measured.discoveryBeforeConsumerB, measured.discoveryAfterConsumerB);
    assert.deepEqual(measured.discoveryBeforeConsumers, measured.discoveryAfterConsumerB);
    assert.equal(measured.sameDiscoveryAfterConsumerA, true);
    assert.equal(measured.sameDiscoveryAfterConsumerB, true);
    assert.equal(measured.generationBeforeConsumers, measured.generationAfterConsumerA);
    assert.equal(measured.generationAfterConsumerA, measured.generationAfterConsumerB);
    assert.equal(measured.discovery.generation, measured.generationAfterConsumerB);
    assert.deepEqual(measured.consumerResponse, { value: 'artifact' });
    assert.deepEqual(measured.consumerHostA.requested, ['tavern.context.read', 'tavern.chat.read', 'tavern.chat.events', 'tavern.worldbooks.read', 'tavern.worldbooks.write', 'tavern.generation.read', 'tavern.prompt.contribute', 'tavern.plugin.request', 'tavern.plugin.binary-request.v1']);
    assert.deepEqual(measured.consumerHostA.granted, measured.consumerHostA.requested);
    assert.equal(measured.consumerHostA.events.subscribedAndRemoved, true);
    assert.equal(measured.consumerHostA.prompt.setAndRemoved, true);
    assert.equal(measured.consumerHostA.request.ok, true);
    assert.deepEqual(measured.consumerHostA.binaryRequest, {
      export: {
        status: 200, ok: true, contentType: 'application/vnd.sqlite3', data: 'U1FMaXRlIGZvcm1hdCAzAEcwMTEgYmluYXJ5IGdhdGU=', byteLength: 32,
        sha256: '0c05ece4802d8aba9072dcd878fcf3ba519e67c66c82ff0754e6749ca87216c1', filename: 'gate.sqlite3',
      },
      import: { status: 200, ok: true, body: { ok: true, data: { bytesMatched: true, hashMatched: true, byteLength: 32 } } },
    });
    assert.deepEqual(measured.consumerHostA.legacyMemoryRoute, { status: 404, ok: false });
    assert.deepEqual(measured.consumerHostB.requested, ['tavern.context.read']);
    assert.deepEqual(measured.consumerHostB.granted, measured.consumerHostB.requested);
    assert.deepEqual(measured.consumers.sort(), ['fixture.consumer-a', 'fixture.consumer-b']);
    assert.equal(measured.settingsRoots, 1);
    assert.equal(measured.settingsLaunchers, 1);
    assert.equal(measured.settingsCenter.overlays, 1);
    assert.equal(measured.settingsCenter.dialogs, 1);
    assert.equal(measured.settingsCenter.closed, true);
    assert.ok(measured.settingsCenter.navItems >= (jointConsumers ? 3 : 1));
    assert.equal(measured.coreInstances, 1);
    assert.ok(measured.diagnostics.events.length <= 256);
    const diagnosticsEvidence = JSON.stringify(measured.diagnostics);
    for (const forbidden of [
      'GATE_API_KEY_SENTINEL', 'GATE_PROMPT_SENTINEL', 'GATE_COOKIE_SENTINEL', 'GATE_CSRF_SENTINEL',
      'GATE_AUTH_SENTINEL', 'U1FMaXRlIEdBVEVfU1FMSVRFX1NFTlRJTkVM', 'GATE_USER_CONTENT_SENTINEL',
      'apiKey', 'prompt', 'cookie', 'csrf', 'authorization', 'sqliteBase64', 'userContent',
    ]) assert.equal(diagnosticsEvidence.includes(forbidden), false);
    if (jointConsumers) {
      if (measured.jointConsumers.length !== 2) {
        const runtimeEvents = cdp.events.filter((event) => event.method === 'Runtime.exceptionThrown' || event.method === 'Runtime.consoleAPICalled');
        throw new Error(`Joint consumers did not register: ${JSON.stringify(runtimeEvents.slice(-30))}`);
      }
      if (measured.jointConsumers.some((consumer) => consumer.health !== 'healthy')) {
        const runtimeEvents = cdp.events.filter((event) => event.method === 'Runtime.exceptionThrown' || (event.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(event.params?.type)));
        throw new Error(`Joint consumer settings degraded: ${JSON.stringify({ consumers: measured.jointConsumers, runtimeEvents: runtimeEvents.slice(-30) })}`);
      }
      assert.deepEqual(measured.jointConsumers, [
        { id: 'ss-helper.llm', health: 'healthy', title: 'SS-Helper [AI 调度中枢]' },
        { id: 'ss-helper.memory', health: 'healthy', title: 'SS-Helper [记忆]' },
      ]);
      assert.equal(measured.settingsCenter.selectedTitle, 'SS-Helper [记忆]');
      assert.equal(measured.diagnostics.plugins, 4);
    } else {
      assert.deepEqual(measured.jointConsumers, []);
      assert.equal(measured.diagnostics.plugins, 2);
    }
    assert.ok(measured.capabilities.length > 0);
    assert.deepEqual(measured.worldbooks, {
      granted: true, listed: true,
      loadedEntry: { id: '1', keys: ['gate'], secondaryKeys: ['proof'], content: 'created', enabled: true, position: 0, order: 10 },
      active: true,
      updatedEntry: { id: '1', keys: ['gate'], secondaryKeys: ['proof'], content: 'updated', enabled: false, position: 0, order: 10 },
      deleted: true,
    });
    assert.match(measured.pageTitle, /SillyTavern/iu);
    const publicEvidence = JSON.stringify(measured);
    for (const forbidden of ['X-CSRF-Token', 'X-Content-SHA256', 'Cookie', 'Authorization', 'headers', 'getRequestHeaders', 'eventSource', 'SillyTavern.getContext', 'rawContext']) assert.equal(publicEvidence.includes(forbidden), false);
    await evaluate(cdp, `(() => {
      for (const dialog of document.querySelectorAll('dialog[open]')) {
        try { dialog.close(); } catch {}
        dialog.style.display = 'none';
      }
      for (const popup of document.querySelectorAll('.popup, .popup_background')) popup.style.display = 'none';
      document.querySelector('#ss-helper-settings-center .stx-ui-select-trigger')?.click();
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const visualMetrics = await evaluate(cdp, `(() => {
      const overlay = document.querySelector('#ss-helper-settings-center-overlay');
      const dialog = document.querySelector('#ss-helper-settings-center');
      const heading = dialog?.querySelector('.stx-center-header');
      const selectTrigger = dialog?.querySelector('.stx-ui-select-trigger');
      const selectListbox = dialog?.querySelector('.stx-ui-select-listbox');
      const styles = (node) => node ? ((value) => ({ display:value.display, visibility:value.visibility, opacity:value.opacity, color:value.color, background:value.backgroundColor, width:value.width, height:value.height, zIndex:value.zIndex }))(getComputedStyle(node)) : null;
      return { overlay: styles(overlay), dialog: styles(dialog), heading: styles(heading), select:{ trigger:styles(selectTrigger), listbox:styles(selectListbox), expanded:selectTrigger?.getAttribute('aria-expanded') ?? null, options:selectListbox?.querySelectorAll('[role="option"]').length ?? 0 }, text: dialog?.innerText?.slice(0, 1200) ?? '', childCount: dialog?.querySelectorAll('*').length ?? 0 };
    })()`);
    assert.equal(visualMetrics.select.expanded, 'true');
    assert.ok(visualMetrics.select.options > 0);
    assert.notEqual(visualMetrics.select.listbox?.display, 'none');
    await cdp.send('Page.bringToFront');
    await new Promise((resolve) => setTimeout(resolve, 250));
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
    const screenshotPath = path.join(process.cwd(), 'artifacts', 'settings-center-smoke.png');
    mkdirSync(path.dirname(screenshotPath), { recursive: true });
    writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
    writeFileSync(path.join(process.cwd(), 'artifacts', 'settings-center-smoke.json'), `${JSON.stringify(visualMetrics, null, 2)}\n`);
    await evaluate(cdp, 'globalThis.__SSHelperSmokeBeforeReload = true');
    await cdp.send('Page.reload', { ignoreCache: true });
    const reload = await waitFor('clean Core/consumer reload', async () => evaluate(cdp, `(() => {
      if (globalThis.__SSHelperSmokeBeforeReload === true) return null;
      const discovery = globalThis[Symbol.for('@ss-helper/core.discovery')];
      const consumers = globalThis.__SSHelperArtifactConsumers;
      if (discovery?.descriptor?.state !== 'ready' || consumers?.a?.state !== 'ready' || consumers?.b?.state !== 'ready') return null;
      const plugins = discovery.port.diagnostics().plugins;
      if (${jointConsumers} && plugins !== 4) return null;
      return {
        generation: discovery.descriptor.generation,
        plugins,
        settingsRoots: document.querySelectorAll('#ss-helper-settings-root').length,
        settingsLaunchers: document.querySelectorAll('#ss-helper-open-settings-center').length,
        settingsCenters: document.querySelectorAll('#ss-helper-settings-center').length,
        coreInstances: Object.getOwnPropertySymbols(globalThis).filter((symbol) => Symbol.keyFor(symbol) === '@ss-helper/core.discovery').length,
      };
    })()`));
    assert.deepEqual(reload, { generation: 1, plugins: jointConsumers ? 4 : 2, settingsRoots: 1, settingsLaunchers: 1, settingsCenters: 0, coreInstances: 1 });
    const npm = npmInvocation(['--version']);
    const npmVersion = run(npm.command, npm.args);
    result = {
      coreOnly: 'PASS', dualConsumer: 'PASS', jointConsumers: jointConsumers ? 'PASS' : 'NOT_REQUESTED', jointArtifacts, st: { tag: ST_TAG, commit: ST_COMMIT, lockfileSha256: st.lockDigest },
      browser: { requested: selectedBrowser.name, product: browserVersion.product, revision: browserVersion.revision, userAgent: measured.userAgent, reload },
      runtime: { node: process.version, npm: npmVersion }, ...measured,
    };
  } finally {
    cdp?.close();
    const stopChildren = async () => {
      await stop(browser);
      await stop(server);
    };
    await stopChildren();
    const cleanupEntries = [
      ...(serverPluginRoot === undefined ? [] : [{ root: serverPluginRoot, description: 'staged binary server plugin' }]),
      { root: temporary, description: 'temporary smoke directory' },
    ];
    await removeAfterChildrenStopped(cleanupEntries, stopChildren);
    assert.equal(existsSync(temporary), false);
    assert.equal(profile !== undefined && existsSync(profile), false);
    assert.equal(stagedExtensionRoots.some((root) => existsSync(root)), false);
    assert.equal(serverPluginRoot !== undefined && existsSync(serverPluginRoot), false);
    cleanup = { browserStopped: !processAlive(browser), serverStopped: !processAlive(server), profileRemoved: true, clientExtensionsRemoved: true, temporaryRemoved: true, serverPluginsRemoved: true };
  }
  console.log(JSON.stringify({ ...result, cleanup }));
}

await main();
