import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import dns from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import net from 'node:net';
import { AsyncLocalStorage } from 'node:async_hooks';
import { SERVER_DIAGNOSTICS, SERVER_REASON_CODES } from './diagnostics.generated.js';

const PLUGIN_ID = 'ss-helper-sdk';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
function resolveDatabasePath({ stRoot = process.env.SS_HELPER_ST_ROOT, dataRoot = globalThis.DATA_ROOT } = {}) {
  const resolvedDataRoot = stRoot
    ? path.join(path.resolve(stRoot), 'data')
    : typeof dataRoot === 'string' && dataRoot.trim()
      ? path.resolve(dataRoot)
      : path.join(ROOT, 'data');
  return path.join(resolvedDataRoot, '_ss-helper-v0', 'ss-helper.sqlite3');
}
const DB_PATH = resolveDatabasePath();
const SECRET_KEY_PATH = path.join(path.dirname(DB_PATH), 'ss-helper-secrets.key');
const WORKSPACE_ROOT = path.dirname(DB_PATH);
const DATA_ROOT = path.dirname(WORKSPACE_ROOT);
const TAVERN_ROOT = path.dirname(DATA_ROOT);
const RECOVERY_BACKUP_ROOT = path.join(TAVERN_ROOT, 'backups');
const PLUGIN_ROOT = path.dirname(fileURLToPath(import.meta.url));
const BROWSER_ROOT = path.join(PLUGIN_ROOT, 'browser');
const MAX_VALUE_BYTES = 1024 * 1024;
const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
const MAX_PAGE_SIZE = 1000;
const MAX_TRANSACTION_OPERATIONS = 5000;
const MAX_ARCHIVE_WORKSPACES = 5000;
const MAX_ARCHIVE_COLLECTIONS = 10_000;
const MAX_ARCHIVE_RECORDS = 100_000;
const MAX_ARCHIVE_VECTORS = 100_000;
const MAX_VECTOR_DIMENSIONS = 16_384;
const MAX_HTTP_BODY_BYTES = 1024 * 1024;
const MAX_HTTP_RESPONSE_BYTES = 4 * 1024 * 1024;
const SCHEMA_VERSION = 0;
const SECRET_KEY_VERSION = 0;
const SERVER_BROKER_SYMBOL = Symbol.for('@ss-helper/sdk.server.v0');
const SERVER_CAPABILITIES = new Set(['workspace.read', 'workspace.write', 'workspace.recovery', 'secrets.read', 'secrets.write', 'services.register', 'network.request']);
const PUBLIC_ERROR_CODES = new Set(SERVER_REASON_CODES);

function readBridgeCapabilityPolicy() {
  const candidates = [
    path.join(BROWSER_ROOT, 'lib', 'bridge', 'bridge-policy.json'),
    path.join(ROOT, 'SS-Helper-SDK', 'apps', 'core-extension', 'src', 'bridge', 'bridge-policy.json'),
  ];
  try {
    const source = candidates.find((candidate) => fs.existsSync(candidate));
    if (!source) throw new Error('bridge policy is missing');
    const parsed = JSON.parse(fs.readFileSync(source, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.version !== 0 || !parsed.plugins || typeof parsed.plugins !== 'object') throw new Error('bridge policy is invalid');
    return Object.freeze(Object.fromEntries(Object.entries(parsed.plugins).flatMap(([pluginId, capabilities]) => {
      if (!/^[-\w.]{1,128}$/u.test(pluginId) || !Array.isArray(capabilities)) return [];
      const allowed = [...new Set(capabilities.filter((capability) => typeof capability === 'string' && SERVER_CAPABILITIES.has(capability)))];
      return allowed.length ? [[pluginId, Object.freeze(allowed)]] : [];
    })));
  } catch { return Object.freeze({}); }
}
const BRIDGE_CAPABILITY_POLICY = readBridgeCapabilityPolicy();
const BRIDGE_ROUTE = '/internal/bridge/v0/call';

export const info = Object.freeze({
  id: PLUGIN_ID,
  name: 'SS-Helper SDK',
  description: 'SS-Helper Core runtime and shared workspace storage',
});

function createStorage(dataRoot, recoveryBackupRoot) {
  const workspaceRoot = path.join(dataRoot, '_ss-helper-v0');
  return {
    DB_PATH: path.join(workspaceRoot, 'ss-helper.sqlite3'),
    SECRET_KEY_PATH: path.join(workspaceRoot, 'ss-helper-secrets.key'),
    WORKSPACE_ROOT: workspaceRoot,
    DATA_ROOT: dataRoot,
    RECOVERY_BACKUP_ROOT: recoveryBackupRoot,
    database: undefined, initialized: false, initError: undefined,
    secretKey: undefined, secretKeyError: undefined, recoveryInProgress: false,
  };
}
const defaultStorage = createStorage(DATA_ROOT, RECOVERY_BACKUP_ROOT);
const userStores = new Map([[DATA_ROOT, defaultStorage]]);
const storageContext = new AsyncLocalStorage();
function storage() { return storageContext.getStore() ?? defaultStorage; }

function requestStorage(req) {
  const handle = req.user?.profile?.handle;
  const root = req.user?.directories?.root;
  if (typeof handle !== 'string' || !handle || typeof root !== 'string' || !root) throw failure('WORKSPACE_ACCESS_DENIED');
  const userRoot = path.resolve(root);
  if (userRoot !== path.join(DATA_ROOT, handle)
    || path.dirname(userRoot) !== DATA_ROOT) throw failure('WORKSPACE_ACCESS_DENIED');
  // Preserve the existing single-user data and key; other accounts get their
  // own storage, including health, recovery backups and resets.
  if (handle === 'default-user') return defaultStorage;
  let state = userStores.get(userRoot);
  if (!state) {
    state = createStorage(userRoot, path.join(userRoot, 'backups'));
    userStores.set(userRoot, state);
  }
  return state;
}
let warmupHandle;
let serverActive = false;

function now() { return Date.now(); }
function json(value) { return JSON.stringify(value ?? null); }
function parse(value) { return value === null || value === undefined ? null : JSON.parse(value); }
function fileSize(file) { try { return fs.statSync(file).size; } catch { return 0; } }
function databaseSizeBytes() { const { DB_PATH } = storage(); return fileSize(DB_PATH) + fileSize(`${DB_PATH}-wal`); }
function stageFor(reasonCode) {
  if (reasonCode.startsWith('HTTP_')) return 'server.http';
  if (reasonCode.startsWith('BRIDGE_') || reasonCode.startsWith('SERVER_')) return 'server.bridge';
  if (reasonCode.startsWith('WORKSPACE_') || reasonCode.startsWith('BACKUP_')) return 'server.workspace';
  if (reasonCode === 'INVALID_PAYLOAD') return 'server.validation';
  return 'server.internal';
}
function failure(reasonCode, _privateMessage = reasonCode, details = {}) {
  return Object.assign(new Error(reasonCode), {
    name: 'SSHelperError',
    code: SERVER_DIAGNOSTICS[reasonCode]?.transportCode ?? 'INTERNAL',
    details: { ...details, reasonCode, stage: stageFor(reasonCode) },
  });
}
function publicErrorCode(error) {
  const reasonCode = typeof error?.details?.reasonCode === 'string' ? error.details.reasonCode : '';
  return PUBLIC_ERROR_CODES.has(reasonCode) ? reasonCode : 'INTERNAL_ERROR';
}
function invalidPayload(_message) { throw failure('INVALID_PAYLOAD', 'server.validation'); }
function text(value, name) {
  if (typeof value !== 'string' || value.trim() === '') invalidPayload(`${name} is required`);
  if (value.length > 128 || !/^[\w.:-]+$/u.test(value)) invalidPayload(`${name} is invalid`);
  return value;
}
function workspaceText(value, name = 'workspaceId') {
  if (typeof value !== 'string' || value.trim() === '') invalidPayload(`${name} is required`);
  const normalized = value.trim();
  if (normalized.length > 256 || /[\u0000-\u001f\u007f]/u.test(normalized)) invalidPayload(`${name} is invalid`);
  return normalized;
}
function recordText(value, name = 'recordId') {
  if (typeof value !== 'string' || value.trim() === '') invalidPayload(`${name} is required`);
  if (value.length > 1024 || !/^[A-Za-z0-9_.!~*'()%:-]+$/u.test(value)) invalidPayload(`${name} is invalid`);
  return value;
}
function fieldText(value, name = 'field') {
  if (typeof value !== 'string' || !/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/u.test(value) || value.length > 128) invalidPayload(`${name} is invalid`);
  return value;
}
function bodyOf(req) { return req.body && typeof req.body === 'object' ? req.body : {}; }
function sizeOf(value) { return Buffer.byteLength(json(value), 'utf8'); }
function clampLimit(value, fallback = 100) { return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(Number(value ?? fallback) || fallback))); }
function encodeCursor(value) { return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url'); }
function decodeCursor(value) {
  if (typeof value !== 'string' || !value) return null;
  try { const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); return parsed && typeof parsed === 'object' ? parsed : null; }
  catch { invalidPayload('cursor is invalid'); }
}
function readField(value, field) { return field.split('.').reduce((current, key) => current && typeof current === 'object' ? current[key] : undefined, value); }
function scalar(value, name = 'indexed value') {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  invalidPayload(`${name} must be a scalar`);
}
function sqliteScalar(value) { return typeof value === 'boolean' ? (value ? 1 : 0) : value; }

function ensureSecretKey() {
  const state = storage();
  const { SECRET_KEY_PATH } = state;
  if (state.secretKey) return state.secretKey;
  if (state.secretKeyError) throw state.secretKeyError;
  try {
    fs.mkdirSync(path.dirname(SECRET_KEY_PATH), { recursive: true });
    let bytes;
    if (fs.existsSync(SECRET_KEY_PATH)) {
      bytes = fs.readFileSync(SECRET_KEY_PATH);
      if (bytes.length !== 32) throw failure('WORKSPACE_SECRET_UNAVAILABLE', 'Secret key has invalid length');
    } else {
      bytes = crypto.randomBytes(32);
      const temp = `${SECRET_KEY_PATH}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temp, bytes, { mode: 0o600, flag: 'wx' });
      try { fs.renameSync(temp, SECRET_KEY_PATH); } catch (error) { try { fs.unlinkSync(temp); } catch {} ; if (!fs.existsSync(SECRET_KEY_PATH)) throw error; }
    }
    try { fs.chmodSync(SECRET_KEY_PATH, 0o600); } catch {}
    state.secretKey = bytes;
    return state.secretKey;
  } catch (error) {
    state.secretKeyError = publicErrorCode(error) === 'WORKSPACE_SECRET_UNAVAILABLE' ? error : failure('WORKSPACE_SECRET_UNAVAILABLE');
    throw state.secretKeyError;
  }
}

function maskSecret(value) {
  const textValue = String(value);
  if (textValue.length <= 8) return `${textValue.slice(0, 2)}***${textValue.slice(-2)}`;
  return `${textValue.slice(0, 4)}***${textValue.slice(-4)}`;
}

function encryptSecret(owner, workspace, secretId, value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ensureSecretKey(), iv);
  cipher.setAAD(Buffer.from(`${owner}\0${workspace}\0${secretId}\0${SECRET_KEY_VERSION}`, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') };
}

function decryptSecret(owner, workspace, secretId, row) {
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', ensureSecretKey(), Buffer.from(row.iv, 'base64'));
    decipher.setAAD(Buffer.from(`${owner}\0${workspace}\0${secretId}\0${Number(row.key_version)}`, 'utf8'));
    decipher.setAuthTag(Buffer.from(row.auth_tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final()]).toString('utf8');
  } catch (error) {
    throw failure('WORKSPACE_SECRET_UNAVAILABLE', error instanceof Error ? error.message : String(error));
  }
}

function addColumnIfMissing(db, table, column, declaration) {
  const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((item) => item.name));
  if (!columns.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
}

function createSchema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
  `);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS workspaces(
      owner_plugin_id TEXT NOT NULL, workspace_id TEXT NOT NULL, metadata_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY(owner_plugin_id, workspace_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS workspace_collections(
      owner_plugin_id TEXT NOT NULL, workspace_id TEXT NOT NULL, name TEXT NOT NULL, indexes_json TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY(owner_plugin_id, workspace_id, name),
      FOREIGN KEY(owner_plugin_id, workspace_id) REFERENCES workspaces(owner_plugin_id, workspace_id) ON DELETE CASCADE
    ) STRICT;
    CREATE TABLE IF NOT EXISTS workspace_records(
      owner_plugin_id TEXT NOT NULL, workspace_id TEXT NOT NULL, collection TEXT NOT NULL, record_id TEXT NOT NULL,
      value_json TEXT, revision INTEGER NOT NULL DEFAULT 1, tombstone INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY(owner_plugin_id, workspace_id, collection, record_id),
      FOREIGN KEY(owner_plugin_id, workspace_id, collection) REFERENCES workspace_collections(owner_plugin_id, workspace_id, name) ON DELETE CASCADE
    ) STRICT;
    CREATE TABLE IF NOT EXISTS workspace_record_indexes(
      owner_plugin_id TEXT NOT NULL, workspace_id TEXT NOT NULL, collection TEXT NOT NULL, field_name TEXT NOT NULL,
      field_value TEXT NOT NULL, record_id TEXT NOT NULL,
      PRIMARY KEY(owner_plugin_id, workspace_id, collection, field_name, field_value, record_id),
      FOREIGN KEY(owner_plugin_id, workspace_id, collection, record_id) REFERENCES workspace_records(owner_plugin_id, workspace_id, collection, record_id) ON DELETE CASCADE
    ) STRICT;
    CREATE INDEX IF NOT EXISTS workspace_record_indexes_lookup ON workspace_record_indexes(owner_plugin_id, workspace_id, collection, field_name, record_id);
    CREATE TABLE IF NOT EXISTS workspace_request_dedup_v0(
      caller_plugin_id TEXT NOT NULL, owner_plugin_id TEXT NOT NULL, workspace_id TEXT NOT NULL,
      request_id TEXT NOT NULL, response_json TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(caller_plugin_id, owner_plugin_id, workspace_id, request_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS workspace_vectors(
      owner_plugin_id TEXT NOT NULL, workspace_id TEXT NOT NULL, collection TEXT NOT NULL, record_id TEXT NOT NULL,
      vector_json TEXT NOT NULL, model TEXT, metadata_json TEXT NOT NULL DEFAULT 'null',
      created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
      PRIMARY KEY(owner_plugin_id, workspace_id, collection, record_id),
      FOREIGN KEY(owner_plugin_id, workspace_id, collection, record_id) REFERENCES workspace_records(owner_plugin_id, workspace_id, collection, record_id) ON DELETE CASCADE
    ) STRICT;
    CREATE TABLE IF NOT EXISTS workspace_secrets(
      owner_plugin_id TEXT NOT NULL, workspace_id TEXT NOT NULL, secret_id TEXT NOT NULL,
      ciphertext TEXT NOT NULL, iv TEXT NOT NULL, auth_tag TEXT NOT NULL,
      key_version INTEGER NOT NULL, metadata_json TEXT NOT NULL DEFAULT 'null', updated_at INTEGER NOT NULL,
      PRIMARY KEY(owner_plugin_id, workspace_id, secret_id),
      FOREIGN KEY(owner_plugin_id, workspace_id) REFERENCES workspaces(owner_plugin_id, workspace_id) ON DELETE CASCADE
    ) STRICT;
    `);
    addColumnIfMissing(db, 'workspace_vectors', 'metadata_json', "TEXT NOT NULL DEFAULT 'null'");
    addColumnIfMissing(db, 'workspace_vectors', 'created_at', 'INTEGER NOT NULL DEFAULT 0');
    db.prepare('UPDATE workspace_vectors SET created_at = updated_at WHERE created_at = 0').run();
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(SCHEMA_VERSION, now());
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function ensureDatabase() {
  const state = storage();
  const { DB_PATH } = state;
  if (state.initialized) return;
  if (state.initError) throw state.initError;
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    state.database = new DatabaseSync(DB_PATH);
    createSchema(state.database);
    state.initialized = true;
  } catch (error) {
    try { state.database?.close(); } catch {}
    state.database = undefined;
    state.initError = failure('WORKSPACE_DATABASE_UNAVAILABLE', 'Workspace database is unavailable');
    state.initError.cause = error;
    throw state.initError;
  }
}

function closeWorkspaceDatabase() {
  const state = storage();
  try { state.database?.close(); } finally {
    state.database = undefined;
    state.initialized = false;
    state.initError = undefined;
    state.secretKey = undefined;
    state.secretKeyError = undefined;
  }
}

function recoveryManifest(root) {
  const files = [];
  const walk = (directory, relative = '') => {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const entryRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(file, entryRelative);
      } else if (entry.isFile()) {
        files.push({
          path: entryRelative,
          bytes: fs.statSync(file).size,
          sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
        });
      } else {
        throw failure('WORKSPACE_RECOVERY_BACKUP_FAILED', 'Workspace backup contains an unsupported entry');
      }
    }
  };
  walk(root);
  return files;
}

function recoveryBackupPathIsSafe(candidate) {
  const { RECOVERY_BACKUP_ROOT } = storage();
  const relative = path.relative(RECOVERY_BACKUP_ROOT, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function windowsSystemTool(name) {
  if (process.platform !== 'win32') return name;
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (typeof systemRoot !== 'string' || systemRoot.trim() === '') throw new Error('Windows system root is unavailable');
  const candidate = path.join(systemRoot, 'System32', name);
  if (!fs.existsSync(candidate)) throw new Error(`Windows system tool is missing: ${candidate}`);
  return candidate;
}

function currentWindowsUserSid() {
  try {
    const output = execFileSync(windowsSystemTool('whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const sid = output.match(/S-\d-(?:\d+-){1,14}\d+/u)?.[0];
    if (!sid) throw new Error('SID was not returned');
    return sid;
  } catch {
    throw failure('WORKSPACE_RECOVERY_BACKUP_FAILED', 'Windows backup access control could not be determined');
  }
}

function restrictRecoveryBackupAcl(backupPath) {
  try {
    if (process.platform !== 'win32') {
      const harden = (directory) => {
        fs.chmodSync(directory, 0o700);
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const target = path.join(directory, entry.name);
          if (entry.isDirectory()) harden(target);
          else if (entry.isFile()) fs.chmodSync(target, 0o600);
        }
      };
      harden(backupPath);
      return;
    }
    const sid = currentWindowsUserSid();
    const grants = [
      `*${sid}:F`,
      `*${sid}:(OI)(CI)F`,
      '*S-1-5-18:F',
      '*S-1-5-18:(OI)(CI)F',
      '*S-1-5-32-544:F',
      '*S-1-5-32-544:(OI)(CI)F',
    ];
    execFileSync(windowsSystemTool('icacls.exe'), [backupPath, '/inheritance:r', '/grant:r', ...grants, '/T', '/C', '/Q'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    execFileSync(windowsSystemTool('icacls.exe'), [backupPath, '/verify', '/T', '/C', '/Q'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (publicErrorCode(error) === 'WORKSPACE_RECOVERY_BACKUP_FAILED') throw error;
    throw failure('WORKSPACE_RECOVERY_BACKUP_FAILED', 'Windows backup access control could not be verified');
  }
}

function copyWorkspaceInto(source, destination) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    fs.cpSync(path.join(source, entry.name), path.join(destination, entry.name), {
      recursive: entry.isDirectory(), force: false, errorOnExist: true, preserveTimestamps: true,
    });
  }
}

function createRecoveryBackup() {
  const { WORKSPACE_ROOT, RECOVERY_BACKUP_ROOT } = storage();
  if (!fs.existsSync(WORKSPACE_ROOT)) throw failure('WORKSPACE_RECOVERY_NOT_REQUIRED');
  const createdAt = new Date().toISOString();
  const backupId = `ss-helper-recovery-${createdAt.replace(/[:.]/gu, '-')}-${crypto.randomBytes(4).toString('hex')}`;
  const backupPath = path.join(RECOVERY_BACKUP_ROOT, backupId);
  try {
    fs.mkdirSync(RECOVERY_BACKUP_ROOT, { recursive: true });
    fs.mkdirSync(backupPath, { recursive: false });
    restrictRecoveryBackupAcl(backupPath);
    copyWorkspaceInto(WORKSPACE_ROOT, backupPath);
    restrictRecoveryBackupAcl(backupPath);
    const sourceFiles = recoveryManifest(WORKSPACE_ROOT);
    const copiedFiles = recoveryManifest(backupPath);
    if (JSON.stringify(sourceFiles) !== JSON.stringify(copiedFiles)) {
      throw failure('WORKSPACE_RECOVERY_BACKUP_FAILED', 'Workspace backup hash verification failed');
    }
    const manifest = {
      format: 'ss-helper-recovery-manifest', version: 0, backupId, createdAt,
      source: '_ss-helper-v0', files: copiedFiles,
    };
    const serialized = `${JSON.stringify(manifest, null, 2)}\n`;
    const manifestPath = path.join(backupPath, 'ss-helper-recovery-manifest.json');
    fs.writeFileSync(manifestPath, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    const expectedDigest = crypto.createHash('sha256').update(serialized, 'utf8').digest('hex');
    const actualDigest = crypto.createHash('sha256').update(fs.readFileSync(manifestPath)).digest('hex');
    if (expectedDigest !== actualDigest) throw failure('WORKSPACE_RECOVERY_BACKUP_FAILED', 'Workspace backup manifest verification failed');
    restrictRecoveryBackupAcl(backupPath);
    return { backupId };
  } catch (error) {
    if (recoveryBackupPathIsSafe(backupPath)) {
      try { fs.rmSync(backupPath, { recursive: true, force: true, maxRetries: 2, retryDelay: 25 }); } catch {}
    }
    if (publicErrorCode(error) === 'WORKSPACE_RECOVERY_BACKUP_FAILED') throw error;
    throw failure('WORKSPACE_RECOVERY_BACKUP_FAILED', 'Workspace backup could not be created');
  }
}

function isRecoveryAvailable() {
  const state = storage();
  return Boolean((state.initError || state.secretKeyError) && fs.existsSync(state.WORKSPACE_ROOT));
}

function workspaceHealth() {
  const state = storage();
  const { DB_PATH } = state;
  try {
    ensureDatabase();
  } catch (error) {
    const failureContext = safeFailureDetails(error);
    return {
      ok: true, ready: false, status: 'degraded', failure: failureContext, recoverable: isRecoveryAvailable(),
      database: path.basename(DB_PATH), schemaVersion: SCHEMA_VERSION,
      nodeVersion: process.version, databaseSizeBytes: databaseSizeBytes(), secretReady: false,
      secretFailure: failureContext,
    };
  }
  const sqliteVersion = storage().database.prepare('SELECT sqlite_version() AS version').get().version;
  const walMode = storage().database.prepare('PRAGMA journal_mode').get().journal_mode;
  let secretReady = false;
  let secretFailure;
  try { ensureSecretKey(); secretReady = true; } catch (error) { secretFailure = safeFailureDetails(error); }
  return {
    ok: true,
    ready: state.initialized,
    status: secretFailure === undefined ? 'ready' : 'degraded',
    ...(secretFailure === undefined ? {} : { failure: secretFailure, recoverable: isRecoveryAvailable(), secretFailure }),
    database: path.basename(DB_PATH), schemaVersion: SCHEMA_VERSION, nodeVersion: process.version,
    sqliteVersion, walMode, databaseSizeBytes: databaseSizeBytes(), secretReady,
  };
}

function repairWorkspace() {
  const state = storage();
  const { WORKSPACE_ROOT, DATA_ROOT } = state;
  if (state.recoveryInProgress) throw failure('WORKSPACE_RECOVERY_IN_PROGRESS');
  const health = workspaceHealth();
  if (health.recoverable !== true) throw failure('WORKSPACE_RECOVERY_NOT_REQUIRED');
  state.recoveryInProgress = true;
  let isolatedRoot;
  try {
    closeWorkspaceDatabase();
    const backup = createRecoveryBackup();
    try {
      isolatedRoot = path.join(DATA_ROOT, `._ss-helper-recovery-isolated-${backup.backupId}-${crypto.randomBytes(4).toString('hex')}`);
      fs.renameSync(WORKSPACE_ROOT, isolatedRoot);
      fs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
      ensureDatabase();
      ensureSecretKey();
      const rebuiltHealth = workspaceHealth();
      if (rebuiltHealth.ready !== true || rebuiltHealth.secretReady !== true) throw failure('WORKSPACE_RECOVERY_REBUILD_FAILED');
    } catch (error) {
      closeWorkspaceDatabase();
      if (isolatedRoot && fs.existsSync(isolatedRoot)) {
        try {
          if (fs.existsSync(WORKSPACE_ROOT)) fs.rmSync(WORKSPACE_ROOT, { recursive: true, force: true, maxRetries: 2, retryDelay: 25 });
          fs.renameSync(isolatedRoot, WORKSPACE_ROOT);
          isolatedRoot = undefined;
        } catch {
          throw failure('WORKSPACE_RECOVERY_REBUILD_FAILED', 'Workspace reinitialisation rollback failed');
        }
      }
      throw failure('WORKSPACE_RECOVERY_REBUILD_FAILED', 'Workspace reinitialisation failed');
    }
    if (isolatedRoot && fs.existsSync(isolatedRoot)) {
      try { fs.rmSync(isolatedRoot, { recursive: true, force: false, maxRetries: 2, retryDelay: 25 }); } catch { /* keep the isolated copy; the verified backup remains authoritative */ }
    }
    return { backupId: backup.backupId, requiresReload: true };
  } finally {
    state.recoveryInProgress = false;
  }
}

function requireWorkspace(input, caller) {
  const owner = caller;
  const workspace = workspaceText(input.workspaceId);
  const row = storage().database.prepare('SELECT * FROM workspaces WHERE owner_plugin_id = ? AND workspace_id = ?').get(owner, workspace);
  if (!row) throw failure('WORKSPACE_NOT_FOUND');
  return { owner, workspace, row };
}

function safeFailureDetails(error, requestId) {
  const source = error?.details && typeof error.details === 'object' && !Array.isArray(error.details) ? error.details : {};
  const details = {
    reasonCode: publicErrorCode(error),
    stage: typeof source.stage === 'string' && source.stage.length <= 128 ? source.stage : stageFor(publicErrorCode(error)),
    ...(typeof requestId === 'string' && requestId.length <= 256 ? { requestId } : {}),
  };
  for (const key of ['attemptId', 'collection', 'path', 'keyword', 'expected', 'providerKind', 'resourceId', 'model']) {
    if (typeof source[key] === 'string' && source[key].length <= 256) details[key] = source[key];
  }
  for (const key of ['batchIndex', 'httpStatus']) {
    if (typeof source[key] === 'number' && Number.isFinite(source[key]) && source[key] >= 0) details[key] = source[key];
  }
  return details;
}

function httpResponseResult(response) {
  let responseBody = null;
  if (response.bytes.length > 0) {
    const textBody = response.bytes.toString('utf8');
    if (response.incomplete) responseBody = textBody;
    else {
      try { responseBody = JSON.parse(textBody); } catch { responseBody = textBody; }
    }
  }
  return {
    status: response.status,
    ok: response.status >= 200 && response.status < 300,
    body: responseBody,
    contentType: response.contentType ?? 'application/octet-stream',
    receivedBytes: response.bytes.length,
    ...(response.incomplete ? { incomplete: true } : {}),
  };
}

function routeError(res, error, requestId) {
  const code = publicErrorCode(error);
  // The private Bridge is an RPC endpoint. A missing workspace is a normal,
  // handled lookup result (for example when a recent-chat indicator probes a
  // chat that has never used Memory), not a missing HTTP route. Keep the JSON
  // error contract while returning 200 so browsers do not emit a misleading
  // resource 404. A genuinely unregistered Express route remains a raw 404.
  const status = code === 'WORKSPACE_NOT_FOUND'
    ? 200
    : code === 'WORKSPACE_ACCESS_DENIED' || code === 'WORKSPACE_RECOVERY_DENIED' || code === 'SERVER_CAPABILITY_DENIED'
      ? 403
      : code === 'WORKSPACE_CONFLICT' || code === 'WORKSPACE_RECOVERY_IN_PROGRESS'
        ? 409
        : (code === 'WORKSPACE_UNAVAILABLE' || code === 'WORKSPACE_DATABASE_UNAVAILABLE' || code === 'WORKSPACE_SECRET_UNAVAILABLE')
          ? 503
          : 400;
  res.status(status).json({
    ok: false,
    error: code,
    details: safeFailureDetails(error, requestId),
  });
}

function archiveDigest(archive) { return crypto.createHash('sha256').update(JSON.stringify(archive)).digest('hex'); }

function collectionDefinition(owner, workspace, collection) {
  const row = storage().database.prepare('SELECT indexes_json FROM workspace_collections WHERE owner_plugin_id = ? AND workspace_id = ? AND name = ?').get(owner, workspace, collection);
  if (!row) throw failure('WORKSPACE_NOT_FOUND', `Collection ${collection} does not exist`);
  return parse(row.indexes_json) ?? [];
}

function assertExpectedVersion(current, expectedVersion) {
  if (expectedVersion === undefined || expectedVersion === null) return;
  const expected = Number(expectedVersion);
  if (!Number.isInteger(expected) || expected < 0 || Number(current?.revision ?? current?.version ?? 0) !== expected) throw failure('WORKSPACE_CONFLICT');
}

function expectedRevisionOf(input) { return input.expectedRevision ?? input.expectedVersion; }

function updateRecordIndexes(owner, workspace, collection, recordId, value) {
  const indexes = collectionDefinition(owner, workspace, collection);
  storage().database.prepare('DELETE FROM workspace_record_indexes WHERE owner_plugin_id = ? AND workspace_id = ? AND collection = ? AND record_id = ?').run(owner, workspace, collection, recordId);
  const insert = storage().database.prepare('INSERT INTO workspace_record_indexes(owner_plugin_id, workspace_id, collection, field_name, field_value, record_id) VALUES (?, ?, ?, ?, ?, ?)');
  for (const field of indexes) {
    const fieldValue = readField(value, field);
    if (fieldValue !== undefined) insert.run(owner, workspace, collection, field, json(scalar(fieldValue, field)), recordId);
  }
}

function writeRecord(owner, workspace, input) {
  const collection = text(input.collection ?? 'default', 'collection');
  const recordId = recordText(input.recordId, `recordId(${collection})`);
  if (sizeOf(input.value) > MAX_VALUE_BYTES) invalidPayload('record value is too large');
  collectionDefinition(owner, workspace, collection);
  const current = storage().database.prepare('SELECT revision, tombstone, created_at FROM workspace_records WHERE owner_plugin_id = ? AND workspace_id = ? AND collection = ? AND record_id = ?').get(owner, workspace, collection, recordId);
  const logicalCurrent = Number(current?.tombstone ?? 0) === 1 ? undefined : current;
  try {
    assertExpectedVersion(logicalCurrent, expectedRevisionOf(input));
  } catch (error) {
    if (publicErrorCode(error) === 'WORKSPACE_CONFLICT') {
      console.warn('[SS-Helper SDK] Workspace revision conflict', {
        operation: 'put',
        collection,
        recordId,
        expectedRevision: expectedRevisionOf(input),
        actualRevision: Number(logicalCurrent?.revision ?? 0),
        tombstoneRevision: Number(current?.tombstone ?? 0) === 1 ? Number(current.revision) : undefined,
      });
    }
    throw error;
  }
  const t = now(); const revision = Number(current?.revision ?? 0) + 1;
  storage().database.prepare('INSERT INTO workspace_records(owner_plugin_id, workspace_id, collection, record_id, value_json, revision, tombstone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?) ON CONFLICT(owner_plugin_id, workspace_id, collection, record_id) DO UPDATE SET value_json = excluded.value_json, revision = excluded.revision, tombstone = 0, updated_at = excluded.updated_at').run(owner, workspace, collection, recordId, json(input.value), revision, Number(current?.created_at ?? t), t);
  updateRecordIndexes(owner, workspace, collection, recordId, input.value);
  return { collection, recordId, value: input.value, version: revision, revision, updatedAt: t };
}

function removeRecord(owner, workspace, input) {
  const collection = text(input.collection ?? 'default', 'collection'); const recordId = recordText(input.recordId, `recordId(${collection})`);
  collectionDefinition(owner, workspace, collection);
  const current = storage().database.prepare('SELECT revision, tombstone FROM workspace_records WHERE owner_plugin_id = ? AND workspace_id = ? AND collection = ? AND record_id = ?').get(owner, workspace, collection, recordId);
  const logicalCurrent = Number(current?.tombstone ?? 0) === 1 ? undefined : current;
  try {
    assertExpectedVersion(logicalCurrent, expectedRevisionOf(input));
  } catch (error) {
    if (publicErrorCode(error) === 'WORKSPACE_CONFLICT') {
      console.warn('[SS-Helper SDK] Workspace revision conflict', {
        operation: 'delete',
        collection,
        recordId,
        expectedRevision: expectedRevisionOf(input),
        actualRevision: Number(logicalCurrent?.revision ?? 0),
        tombstoneRevision: Number(current?.tombstone ?? 0) === 1 ? Number(current.revision) : undefined,
      });
    }
    throw error;
  }
  if (!current || Number(current.tombstone) === 1) return { removed: false, revision: Number(current?.revision ?? 0) };
  const revision = Number(current.revision) + 1;
  storage().database.prepare('UPDATE workspace_records SET value_json = NULL, revision = ?, tombstone = 1, updated_at = ? WHERE owner_plugin_id = ? AND workspace_id = ? AND collection = ? AND record_id = ?').run(revision, now(), owner, workspace, collection, recordId);
  storage().database.prepare('DELETE FROM workspace_record_indexes WHERE owner_plugin_id = ? AND workspace_id = ? AND collection = ? AND record_id = ?').run(owner, workspace, collection, recordId);
  storage().database.prepare('DELETE FROM workspace_vectors WHERE owner_plugin_id = ? AND workspace_id = ? AND collection = ? AND record_id = ?').run(owner, workspace, collection, recordId);
  return { removed: true, revision };
}

function rebuildCollectionIndexes(owner, workspace, collection) {
  storage().database.prepare('DELETE FROM workspace_record_indexes WHERE owner_plugin_id = ? AND workspace_id = ? AND collection = ?').run(owner, workspace, collection);
  const records = storage().database.prepare('SELECT record_id, value_json FROM workspace_records WHERE owner_plugin_id = ? AND workspace_id = ? AND collection = ? AND tombstone = 0').all(owner, workspace, collection);
  for (const record of records) updateRecordIndexes(owner, workspace, collection, record.record_id, parse(record.value_json));
}

function queryRecords(owner, workspace, input) {
  const collection = text(input.collection ?? 'default', 'collection');
  const declared = new Set(collectionDefinition(owner, workspace, collection));
  const filter = input.filter && typeof input.filter === 'object' && !Array.isArray(input.filter) ? input.filter : {};
  const predicates = Array.isArray(input.where) ? input.where : [];
  const order = input.orderBy && typeof input.orderBy === 'object' ? input.orderBy : { field: 'updatedAt', direction: 'desc' };
  const orderField = String(order.field ?? 'updatedAt'); const direction = order.direction === 'asc' ? 'ASC' : 'DESC';
  const builtInOrder = orderField === 'updatedAt' || orderField === 'recordId';
  for (const field of [...Object.keys(filter), ...predicates.map((item) => item?.field), ...(builtInOrder ? [] : [orderField])]) {
    fieldText(field);
    if (field !== 'recordId' && !declared.has(field)) throw failure('WORKSPACE_INDEX_REQUIRED', `Index ${field} must be declared first`);
  }
  const joins = []; const joinParams = []; const where = ['r.owner_plugin_id = ?', 'r.workspace_id = ?', 'r.collection = ?', 'r.tombstone = 0']; const params = [owner, workspace, collection];
  let sortExpression = orderField === 'recordId' ? 'r.record_id' : 'r.updated_at';
  if (!builtInOrder) {
    joins.push('JOIN workspace_record_indexes ord ON ord.owner_plugin_id = r.owner_plugin_id AND ord.workspace_id = r.workspace_id AND ord.collection = r.collection AND ord.record_id = r.record_id AND ord.field_name = ?');
    joinParams.push(orderField); sortExpression = "json_extract(ord.field_value, '$')";
  }
  const addPredicate = (field, op, rawValue, index) => {
    fieldText(field);
    if (field === 'recordId') {
      if (op === 'in') {
        if (!Array.isArray(rawValue) || rawValue.length === 0) invalidPayload('recordId in requires values');
        const values = rawValue.map((value) => recordText(value, 'recordId'));
        where.push(`r.record_id IN (${values.map(() => '?').join(',')})`);
        params.push(...values);
        return;
      }
      if (op !== 'eq') invalidPayload(`recordId only supports eq/in, received ${op}`);
      where.push('r.record_id IS ?');
      params.push(recordText(rawValue, 'recordId'));
      return;
    }
    const alias = `i${index}`; let condition;
    if (op === 'in') {
      if (!Array.isArray(rawValue) || rawValue.length === 0) invalidPayload(`${field} in requires values`);
      const values = rawValue.map((value) => sqliteScalar(scalar(value, field)));
      condition = `json_extract(${alias}.field_value, '$') IN (${values.map(() => '?').join(',')})`; params.push(field, ...values);
    } else {
      const value = sqliteScalar(scalar(rawValue, field));
      const operator = op === 'eq' ? 'IS' : op === 'neq' ? 'IS NOT' : op === 'gt' ? '>' : op === 'gte' ? '>=' : op === 'lt' ? '<' : op === 'lte' ? '<=' : null;
      if (!operator) invalidPayload(`Unsupported query operator ${op}`);
      condition = `json_extract(${alias}.field_value, '$') ${operator} ?`; params.push(field, value);
    }
    where.push(`EXISTS (SELECT 1 FROM workspace_record_indexes ${alias} WHERE ${alias}.owner_plugin_id = r.owner_plugin_id AND ${alias}.workspace_id = r.workspace_id AND ${alias}.collection = r.collection AND ${alias}.record_id = r.record_id AND ${alias}.field_name = ? AND ${condition})`);
  };
  let predicateIndex = 0;
  for (const [field, value] of Object.entries(filter)) addPredicate(field, 'eq', value, predicateIndex++);
  for (const predicate of predicates) {
    if (!predicate || typeof predicate.field !== 'string' || !['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in'].includes(predicate.op)) invalidPayload('query predicate is invalid');
    addPredicate(predicate.field, predicate.op, predicate.value, predicateIndex++);
  }
  const totalWhere = [...where];
  const totalParams = [...params];
  const cursor = decodeCursor(input.cursor);
  if (cursor) {
    const comparison = direction === 'ASC' ? '>' : '<';
    if (cursor.sort === null) {
      where.push(`(${direction === 'ASC' ? `${sortExpression} IS NOT NULL OR ` : ''}(${sortExpression} IS NULL AND r.record_id ${comparison} ?))`);
      params.push(String(cursor.recordId ?? ''));
    } else {
      where.push(`(${sortExpression} ${comparison} ?${direction === 'DESC' ? ` OR ${sortExpression} IS NULL` : ''} OR (${sortExpression} IS ? AND r.record_id ${comparison} ?))`);
      params.push(sqliteScalar(cursor.sort), sqliteScalar(cursor.sort), String(cursor.recordId ?? ''));
    }
  }
  const limit = clampLimit(input.limit);
  const sql = `SELECT r.record_id, r.value_json, r.revision, r.updated_at, ${sortExpression} AS sort_value FROM workspace_records r ${joins.join(' ')} WHERE ${where.join(' AND ')} ORDER BY ${sortExpression} ${direction}, r.record_id ${direction} LIMIT ?`;
  const rows = storage().database.prepare(sql).all(...joinParams, ...params, limit + 1);
  const page = rows.slice(0, limit);
  const result = {
    records: page.map((row) => ({ recordId: row.record_id, value: parse(row.value_json), version: row.revision, revision: row.revision, updatedAt: row.updated_at })),
    nextCursor: rows.length > limit && page.length ? encodeCursor({ sort: page.at(-1).sort_value, recordId: page.at(-1).record_id }) : null,
  };
  if (input.includeTotal === true) {
    const countSql = `SELECT COUNT(*) AS total FROM workspace_records r ${joins.join(' ')} WHERE ${totalWhere.join(' AND ')}`;
    result.total = Number(storage().database.prepare(countSql).get(...joinParams, ...totalParams)?.total ?? 0);
  }
  return result;
}

function vectorMatches(row, input) {
  if (input.collection && row.collection !== input.collection) return false;
  if (input.model && row.model !== input.model) return false;
  const metadata = parse(row.metadata_json);
  if (input.metadata && Object.entries(input.metadata).some(([field, value]) => readField(metadata, field) !== value)) return false;
  return true;
}

function snapshotWorkspace(owner, workspace, row) {
  const collections = storage().database.prepare('SELECT name, indexes_json FROM workspace_collections WHERE owner_plugin_id = ? AND workspace_id = ? ORDER BY name').all(owner, workspace);
  const records = storage().database.prepare('SELECT collection, record_id, value_json, revision, created_at, updated_at FROM workspace_records WHERE owner_plugin_id = ? AND workspace_id = ? AND tombstone = 0 ORDER BY collection, record_id').all(owner, workspace);
  const vectors = storage().database.prepare('SELECT v.collection, v.record_id, v.vector_json, v.model, v.metadata_json, v.created_at, v.updated_at FROM workspace_vectors v JOIN workspace_records r ON r.owner_plugin_id = v.owner_plugin_id AND r.workspace_id = v.workspace_id AND r.collection = v.collection AND r.record_id = v.record_id AND r.tombstone = 0 WHERE v.owner_plugin_id = ? AND v.workspace_id = ? ORDER BY v.collection, v.record_id').all(owner, workspace);
  return {
    format: 'ss-helper-workspace', version: 0, ownerPluginId: owner, workspaceId: workspace,
    metadata: parse(row.metadata_json), workspaceVersion: row.version,
    collections: collections.map((item) => ({ name: item.name, indexes: parse(item.indexes_json) ?? [] })),
    records: records.map((item) => ({ collection: item.collection, recordId: item.record_id, value: parse(item.value_json), revision: item.revision, createdAt: item.created_at, updatedAt: item.updated_at })),
    vectors: vectors.map((item) => ({ collection: item.collection, recordId: item.record_id, vector: parse(item.vector_json), model: item.model, metadata: parse(item.metadata_json), createdAt: item.created_at, updatedAt: item.updated_at })),
  };
}

const BRIDGE_OPERATION_CAPABILITIES = Object.freeze({
  'workspace.health': 'workspace.read', 'workspace.integrity': 'workspace.read',
  'workspace.open': 'workspace.write', 'workspace.commit': 'workspace.write',
  'workspace.reset': 'workspace.recovery', 'workspace.backup': 'workspace.recovery', 'workspace.repair': 'workspace.recovery',
  'workspace.get': 'workspace.read', 'workspace.query': 'workspace.read',
  'workspace.vectorUpsert': 'workspace.write', 'workspace.vectorSearch': 'workspace.read',
  'workspace.vectorDelete': 'workspace.write', 'workspace.vectorList': 'workspace.read', 'workspace.vectorClear': 'workspace.write',
  'secrets.set': 'secrets.write', 'secrets.get': 'secrets.read', 'secrets.delete': 'secrets.write', 'secrets.list': 'secrets.read',
  'http.request': 'network.request',
});

function isPrivateAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168);
  }
  if (net.isIP(address) === 6) {
    const normalized = address.toLowerCase();
    return normalized === '::' || normalized === '::1' || normalized.startsWith('fe8')
      || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')
      || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('::ffff:');
  }
  return true;
}

function normalizedHostname(value) {
  return String(value).trim().replace(/\.$/u, '').toLowerCase();
}

function createPinnedLookup(hostname, addresses) {
  const expectedHostname = normalizedHostname(hostname);
  const pinned = Object.freeze(addresses.map(({ address, family }) => Object.freeze({ address, family: Number(family) })));
  return (requestedHostname, options, callback) => {
    const actualCallback = typeof options === 'function' ? options : callback;
    const lookupOptions = typeof options === 'number' ? { family: options } : (options ?? {});
    if (typeof actualCallback !== 'function') return;
    if (normalizedHostname(requestedHostname) !== expectedHostname) {
      actualCallback(Object.assign(new Error('Pinned DNS hostname mismatch'), { code: 'ENOTFOUND' }));
      return;
    }
    const requestedFamily = Number(lookupOptions.family ?? 0);
    const eligible = requestedFamily === 4 || requestedFamily === 6
      ? pinned.filter(item => item.family === requestedFamily)
      : pinned;
    if (eligible.length === 0) {
      actualCallback(Object.assign(new Error('Pinned DNS family unavailable'), { code: 'ENOTFOUND' }));
      return;
    }
    if (lookupOptions.all === true) actualCallback(null, eligible.map(item => ({ ...item })));
    else actualCallback(null, eligible[0].address, eligible[0].family);
  };
}

async function safeOutboundUrl(value, lookup = dns.lookup) {
  if (typeof value !== 'string' || value.length > 2048) throw failure('HTTP_URL_INVALID');
  let url;
  try { url = new URL(value); } catch { throw failure('HTTP_URL_INVALID'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw failure('HTTP_URL_INVALID');
  if (url.port) {
    const port = Number(url.port);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) throw failure('HTTP_URL_INVALID');
  }
  let addresses;
  try {
    addresses = await lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw failure('HTTP_DNS_FAILED');
  }
  if (addresses.length === 0) throw failure('HTTP_DNS_FAILED');
  if (addresses.some(({ address }) => isPrivateAddress(address))) throw failure('HTTP_ADDRESS_FORBIDDEN');
  return { url, addresses: addresses.map(item => ({ address: item.address, family: Number(item.family) })), lookup: createPinnedLookup(url.hostname, addresses) };
}

function transportFailure(error) {
  if (error?.name === 'TimeoutError') return failure('HTTP_REQUEST_TIMEOUT');
  if (error?.name === 'AbortError') return failure('HTTP_REQUEST_ABORTED');
  const causeCode = typeof error?.code === 'string'
    ? error.code
    : typeof error?.cause?.code === 'string'
      ? error.cause.code
      : '';
  if (['ENOTFOUND', 'EAI_AGAIN', 'EAI_FAIL'].includes(causeCode)) return failure('HTTP_DNS_FAILED');
  if (['ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET'].includes(causeCode)) {
    return failure(causeCode.includes('TIMEOUT') || causeCode === 'ETIMEDOUT' ? 'HTTP_REQUEST_TIMEOUT' : 'HTTP_CONNECT_FAILED');
  }
  if (causeCode.startsWith('ERR_TLS_') || causeCode.startsWith('CERT_') || causeCode.includes('CERTIFICATE')) return failure('HTTP_TLS_FAILED');
  return failure('HTTP_TRANSPORT_ERROR');
}

async function executeHttpRequest(input) {
  const outbound = await safeOutboundUrl(input.url);
  const { url } = outbound;
  const method = input.method === 'POST' ? 'POST' : input.method === 'GET' ? 'GET' : null;
  if (!method) throw failure('HTTP_METHOD_INVALID');
  const sourceHeaders = input.headers && typeof input.headers === 'object' && !Array.isArray(input.headers) ? input.headers : {};
  const allowedHeaders = new Set(['authorization', 'content-type', 'x-api-key', 'anthropic-version', 'x-goog-api-key']);
  const headers = {};
  for (const [rawName, rawValue] of Object.entries(sourceHeaders)) {
    const name = rawName.toLowerCase();
    if (!allowedHeaders.has(name) || typeof rawValue !== 'string' || rawValue.length > 65_536) throw failure('HTTP_HEADERS_INVALID');
    headers[name] = rawValue;
  }
  const body = input.body === undefined ? undefined : input.body;
  if (body !== undefined && (typeof body !== 'string' || Buffer.byteLength(body, 'utf8') > MAX_HTTP_BODY_BYTES)) throw failure('HTTP_BODY_INVALID');
  const timeoutMs = Math.max(1_000, Math.min(600_000, Math.trunc(Number(input.timeoutMs) || 30_000)));
  const idleTimeoutMs = Math.max(1_000, Math.min(120_000, Math.trunc(Number(input.idleTimeoutMs) || 30_000)));
  let timedOut = false;
  const controller = new AbortController();
  const totalTimer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  let idleTimer;
  const resetIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, idleTimeoutMs);
  };
  let response;
  try {
    response = await new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
        method,
        headers,
        lookup: outbound.lookup,
        signal: controller.signal,
      }, (incoming) => {
        const status = Number(incoming.statusCode ?? 0);
        const contentType = Array.isArray(incoming.headers['content-type'])
          ? incoming.headers['content-type'][0]
          : incoming.headers['content-type'];
        if (status >= 300 && status < 400) {
          incoming.resume();
          finish(reject, failure('HTTP_REDIRECT_REJECTED', undefined, { httpStatus: status }));
          return;
        }
        const declaredLength = Number(incoming.headers['content-length'] ?? 0);
        if (declaredLength > MAX_HTTP_RESPONSE_BYTES) {
          incoming.resume();
          finish(reject, failure('HTTP_RESPONSE_TOO_LARGE'));
          return;
        }
        const chunks = [];
        let byteLength = 0;
        incoming.on('data', (chunk) => {
          if (settled) return;
          resetIdleTimer();
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          byteLength += bytes.length;
          if (byteLength > MAX_HTTP_RESPONSE_BYTES) {
            incoming.destroy();
            finish(reject, failure('HTTP_RESPONSE_TOO_LARGE'));
            return;
          }
          chunks.push(bytes);
        });
        incoming.on('aborted', () => {
          if (status < 200 || status >= 300) {
            finish(reject, failure('HTTP_RESPONSE_PROTOCOL_INVALID', undefined, { httpStatus: status }));
            return;
          }
          finish(resolve, { status, bytes: Buffer.concat(chunks, byteLength), contentType, incomplete: true });
        });
        incoming.on('error', error => finish(reject, error));
        incoming.on('end', () => finish(resolve, {
          status,
          bytes: Buffer.concat(chunks, byteLength),
          contentType,
        }));
      });
      request.on('error', error => finish(reject, error));
      if (body !== undefined) request.write(body);
      request.end();
    });
  } catch (error) {
    if (publicErrorCode(error) !== 'INTERNAL_ERROR') throw error;
    if (timedOut) throw failure('HTTP_REQUEST_TIMEOUT');
    throw transportFailure(error);
  } finally {
    clearTimeout(totalTimer);
    clearTimeout(idleTimer);
  }
  return httpResponseResult(response);
}

function assertBridgeEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('BRIDGE_ENVELOPE_INVALID');
  const keys = Object.keys(value);
  if (keys.length !== 5 || !keys.every((key) => ['version', 'pluginId', 'operation', 'requestId', 'input'].includes(key)) || value.version !== 0) {
    throw failure('BRIDGE_ENVELOPE_INVALID');
  }
  const pluginId = text(value.pluginId, 'pluginId');
  const operation = text(value.operation, 'operation');
  const requestId = text(value.requestId, 'requestId');
  const input = value.input;
  if (!input || typeof input !== 'object' || Array.isArray(input) || sizeOf(input) > MAX_BACKUP_BYTES) throw failure('BRIDGE_ENVELOPE_INVALID');
  return { pluginId, operation, requestId, input };
}

function requireBridgeCapability(pluginId, operation) {
  const capability = BRIDGE_OPERATION_CAPABILITIES[operation];
  if (!capability) throw failure('BRIDGE_OPERATION_DENIED');
  if (!(BRIDGE_CAPABILITY_POLICY[pluginId] ?? []).includes(capability)) throw failure('SERVER_CAPABILITY_DENIED');
  return capability;
}

function validateVector(vector) {
  if (!Array.isArray(vector) || vector.length === 0 || vector.length > MAX_VECTOR_DIMENSIONS || vector.some((value) => !Number.isFinite(Number(value)))) {
    invalidPayload('vector is invalid');
  }
  return vector.map(Number);
}

function clearOwnedWorkspaces(caller, input) {
  const preserve = Array.isArray(input.preserveWorkspaceIds) ? input.preserveWorkspaceIds.map((value) => workspaceText(value)) : [];
  const idempotencyKey = input.idempotencyKey === undefined ? '' : text(input.idempotencyKey, 'idempotencyKey');
  storage().database.exec('BEGIN IMMEDIATE');
  try {
    const cached = idempotencyKey ? storage().database.prepare('SELECT response_json FROM workspace_request_dedup_v0 WHERE caller_plugin_id = ? AND owner_plugin_id = ? AND workspace_id = ? AND request_id = ?').get(caller, caller, '*', idempotencyKey) : null;
    if (cached) { storage().database.exec('COMMIT'); return { ...parse(cached.response_json), replayed: true }; }
    const sql = `DELETE FROM workspaces WHERE owner_plugin_id = ? ${preserve.length ? `AND workspace_id NOT IN (${preserve.map(() => '?').join(',')})` : ''}`;
    const removed = Number(storage().database.prepare(sql).run(caller, ...preserve).changes);
    const result = { removed, replayed: false };
    if (idempotencyKey) storage().database.prepare('INSERT INTO workspace_request_dedup_v0(caller_plugin_id, owner_plugin_id, workspace_id, request_id, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(caller, caller, '*', idempotencyKey, json(result), now());
    storage().database.exec('COMMIT');
    return result;
  } catch (error) { storage().database.exec('ROLLBACK'); throw error; }
}

function transactWorkspace(caller, input) {
  const { owner, workspace } = requireWorkspace(input, caller, 'write');
  const operations = Array.isArray(input.operations) ? input.operations : [];
  if (operations.length > MAX_TRANSACTION_OPERATIONS) invalidPayload('too many transaction operations');
  const idempotencyKey = input.idempotencyKey === undefined ? '' : text(input.idempotencyKey, 'idempotencyKey');
  const results = [];
  storage().database.exec('BEGIN IMMEDIATE');
  try {
    const previous = idempotencyKey ? storage().database.prepare('SELECT response_json FROM workspace_request_dedup_v0 WHERE caller_plugin_id = ? AND owner_plugin_id = ? AND workspace_id = ? AND request_id = ?').get(caller, owner, workspace, idempotencyKey) : null;
    if (previous) { storage().database.exec('COMMIT'); return { ...parse(previous.response_json), replayed: true }; }
    for (const operation of operations) {
      if (operation?.action === 'put') {
        const record = writeRecord(owner, workspace, operation);
        results.push({ collection: record.collection, recordId: record.recordId, action: 'put', revision: record.revision });
      } else if (operation?.action === 'delete') {
        const collection = text(operation.collection ?? 'default', 'collection');
        const recordId = recordText(operation.recordId);
        const deleted = removeRecord(owner, workspace, operation);
        results.push({ collection, recordId, action: 'delete', removed: deleted.removed, revision: deleted.revision });
      } else invalidPayload('commit operation is invalid');
    }
    storage().database.prepare('UPDATE workspaces SET version = version + 1, updated_at = ? WHERE owner_plugin_id = ? AND workspace_id = ?').run(now(), owner, workspace);
    const result = { operationCount: operations.length, replayed: false, results };
    if (idempotencyKey) storage().database.prepare('INSERT INTO workspace_request_dedup_v0(caller_plugin_id, owner_plugin_id, workspace_id, request_id, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(caller, owner, workspace, idempotencyKey, json(result), now());
    storage().database.exec('COMMIT');
    return result;
  } catch (error) { storage().database.exec('ROLLBACK'); throw error; }
}

function executeBridgeOperation(caller, operation, input) {
  requireBridgeCapability(caller, operation);
  if (operation === 'http.request') return executeHttpRequest(input);
  if (operation === 'workspace.health') return workspaceHealth();
  if (operation === 'workspace.repair') return repairWorkspace();
  ensureDatabase();
  if (operation === 'workspace.integrity') {
    const messages = storage().database.prepare('PRAGMA integrity_check').all().map((row) => String(row.integrity_check));
    return { ok: messages.length === 1 && messages[0] === 'ok', messages };
  }
  if (operation === 'workspace.open') {
    const workspaceId = workspaceText(input.id ?? input.workspaceId); const owner = caller; const t = now();
    const existing = storage().database.prepare('SELECT * FROM workspaces WHERE owner_plugin_id = ? AND workspace_id = ?').get(owner, workspaceId);
    const declaredCollections = Array.isArray(input.schema?.collections)
      ? input.schema.collections
      : [{ name: 'default', indexes: [] }];
    if (declaredCollections.length === 0) invalidPayload('workspace schema requires collections');
    storage().database.exec('BEGIN IMMEDIATE');
    try {
      if (!existing) {
        storage().database.prepare('INSERT INTO workspaces(owner_plugin_id, workspace_id, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(owner, workspaceId, json(input.metadata ?? {}), t, t);
      }
      const declareCollection = storage().database.prepare('INSERT INTO workspace_collections(owner_plugin_id, workspace_id, name, indexes_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner_plugin_id, workspace_id, name) DO UPDATE SET indexes_json = excluded.indexes_json, updated_at = excluded.updated_at');
      for (const declaration of declaredCollections) {
        const name = text(declaration?.name, 'collection');
        const indexes = Array.isArray(declaration?.indexes) ? [...new Set(declaration.indexes.map((field) => fieldText(field)))] : [];
        declareCollection.run(owner, workspaceId, name, json(indexes), t, t);
        rebuildCollectionIndexes(owner, workspaceId, name);
      }
      storage().database.exec('COMMIT');
    } catch (error) { storage().database.exec('ROLLBACK'); throw error; }
    const row = existing ?? storage().database.prepare('SELECT * FROM workspaces WHERE owner_plugin_id = ? AND workspace_id = ?').get(owner, workspaceId);
    return { ownerPluginId: owner, workspaceId, created: !existing, metadata: parse(row.metadata_json), version: row.version };
  }
  if (operation === 'workspace.commit') {
    const workspaceId = workspaceText(input.id);
    const idempotencyKey = text(input.idempotencyKey, 'idempotencyKey');
    if (!Array.isArray(input.operations) || input.operations.some(item => !item || !['put', 'delete'].includes(item.action))) invalidPayload('commit operation is invalid');
    const result = transactWorkspace(caller, {
      workspaceId,
      idempotencyKey,
      operations: input.operations.map((item) => item.action === 'put'
        ? { action: 'put', collection: item.collection, recordId: item.id, value: item.value, expectedRevision: item.expectedRevision }
        : { action: 'delete', collection: item.collection, recordId: item.id, expectedRevision: item.expectedRevision }),
    });
    return {
      requestId: idempotencyKey,
      replayed: result.replayed,
      results: result.results.map((item) => ({
        collection: item.collection,
        recordId: item.recordId,
        action: item.action,
        revision: item.revision ?? 0,
        ...(item.removed === undefined ? {} : { removed: item.removed }),
      })),
    };
  }
  if (operation === 'workspace.reset') return clearOwnedWorkspaces(caller, {
    preserveWorkspaceIds: input.preserveIds,
    idempotencyKey: input.idempotencyKey,
  }).removed;
  if (operation === 'workspace.backup') {
    const { owner, workspace, row } = requireWorkspace({ workspaceId: input.id }, caller);
    const archive = snapshotWorkspace(owner, workspace, row);
    return { archive, sha256: archiveDigest(archive) };
  }
  if (operation === 'workspace.get') {
    const { owner, workspace } = requireWorkspace(input, caller); const collection = text(input.collection ?? 'default', 'collection'); const recordId = recordText(input.recordId, `recordId(${collection})`); collectionDefinition(owner, workspace, collection);
    const row = storage().database.prepare('SELECT value_json, revision, updated_at FROM workspace_records WHERE owner_plugin_id = ? AND workspace_id = ? AND collection = ? AND record_id = ? AND tombstone = 0').get(owner, workspace, collection, recordId);
    return row ? { recordId, value: parse(row.value_json), version: row.revision, revision: row.revision, updatedAt: row.updated_at } : null;
  }
  if (operation === 'workspace.query') { const { owner, workspace } = requireWorkspace(input, caller); return queryRecords(owner, workspace, input); }
  if (operation === 'workspace.vectorUpsert' || operation === 'workspace.vectorDelete') {
    const { owner, workspace } = requireWorkspace(input, caller, 'vector'); const collection = text(input.collection ?? 'default', 'collection'); const recordId = recordText(input.recordId, `recordId(${collection})`);
    if (operation === 'workspace.vectorDelete') return Number(storage().database.prepare('DELETE FROM workspace_vectors WHERE owner_plugin_id = ? AND workspace_id = ? AND collection = ? AND record_id = ?').run(owner, workspace, collection, recordId).changes) > 0;
    collectionDefinition(owner, workspace, collection);
    if (!storage().database.prepare('SELECT 1 FROM workspace_records WHERE owner_plugin_id = ? AND workspace_id = ? AND collection = ? AND record_id = ? AND tombstone = 0').get(owner, workspace, collection, recordId)) throw failure('WORKSPACE_NOT_FOUND');
    const vector = validateVector(input.vector); const current = storage().database.prepare('SELECT created_at FROM workspace_vectors WHERE owner_plugin_id = ? AND workspace_id = ? AND collection = ? AND record_id = ?').get(owner, workspace, collection, recordId); const t = now();
    storage().database.prepare('INSERT INTO workspace_vectors(owner_plugin_id, workspace_id, collection, record_id, vector_json, model, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_plugin_id, workspace_id, collection, record_id) DO UPDATE SET vector_json = excluded.vector_json, model = excluded.model, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at').run(owner, workspace, collection, recordId, json(vector), input.model ?? null, json(input.metadata), Number(current?.created_at ?? t), t);
    return undefined;
  }
  if (operation === 'workspace.vectorSearch') {
    const { owner, workspace } = requireWorkspace(input, caller, 'vector'); const query = validateVector(input.vector);
    const rows = storage().database.prepare('SELECT v.collection, v.record_id, v.vector_json, v.model, v.metadata_json FROM workspace_vectors v JOIN workspace_records r ON r.owner_plugin_id = v.owner_plugin_id AND r.workspace_id = v.workspace_id AND r.collection = v.collection AND r.record_id = v.record_id AND r.tombstone = 0 WHERE v.owner_plugin_id = ? AND v.workspace_id = ?').all(owner, workspace).filter((row) => vectorMatches(row, input));
    const norm = Math.sqrt(query.reduce((sum, value) => sum + value * value, 0)) || 1;
    return rows.map((row) => {
      const vector = parse(row.vector_json) ?? []; if (!Array.isArray(vector) || vector.length !== query.length) return null;
      const denominator = (Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1) * norm;
      return { collection: row.collection, recordId: row.record_id, score: vector.reduce((sum, value, index) => sum + value * query[index], 0) / denominator, model: row.model ?? undefined, metadata: parse(row.metadata_json) };
    }).filter(Boolean).sort((a, b) => b.score - a.score || a.recordId.localeCompare(b.recordId)).slice(0, clampLimit(input.limit, 10));
  }
  if (operation === 'workspace.vectorList') {
    const { owner, workspace } = requireWorkspace(input, caller, 'vector'); const limit = clampLimit(input.limit); const cursor = decodeCursor(input.cursor);
    let rows = storage().database.prepare('SELECT v.collection, v.record_id, v.vector_json, v.model, v.metadata_json, v.created_at, v.updated_at FROM workspace_vectors v JOIN workspace_records r ON r.owner_plugin_id = v.owner_plugin_id AND r.workspace_id = v.workspace_id AND r.collection = v.collection AND r.record_id = v.record_id AND r.tombstone = 0 WHERE v.owner_plugin_id = ? AND v.workspace_id = ? ORDER BY v.updated_at DESC, v.record_id DESC').all(owner, workspace).filter((row) => vectorMatches(row, input));
    if (cursor) { const index = rows.findIndex((row) => row.collection === cursor.collection && row.record_id === cursor.recordId); if (index >= 0) rows = rows.slice(index + 1); }
    const page = rows.slice(0, limit);
    return { vectors: page.map((row) => ({ collection: row.collection, recordId: row.record_id, model: row.model ?? undefined, metadata: parse(row.metadata_json), dimensions: (parse(row.vector_json) ?? []).length, createdAt: row.created_at, updatedAt: row.updated_at })), nextCursor: rows.length > limit && page.length ? encodeCursor({ collection: page.at(-1).collection, recordId: page.at(-1).record_id }) : null };
  }
  if (operation === 'workspace.vectorClear') {
    const { owner, workspace } = requireWorkspace(input, caller, 'vector'); const rows = storage().database.prepare('SELECT collection, record_id, model, metadata_json FROM workspace_vectors WHERE owner_plugin_id = ? AND workspace_id = ?').all(owner, workspace).filter((row) => vectorMatches(row, input));
    const remove = storage().database.prepare('DELETE FROM workspace_vectors WHERE owner_plugin_id = ? AND workspace_id = ? AND collection = ? AND record_id = ?'); storage().database.exec('BEGIN IMMEDIATE');
    try { for (const row of rows) remove.run(owner, workspace, row.collection, row.record_id); storage().database.exec('COMMIT'); } catch (error) { storage().database.exec('ROLLBACK'); throw error; }
    return rows.length;
  }
  if (operation === 'secrets.set' || operation === 'secrets.get' || operation === 'secrets.delete' || operation === 'secrets.list') {
    const workspace = workspaceText(input.workspaceId);
    if (!storage().database.prepare('SELECT 1 FROM workspaces WHERE owner_plugin_id = ? AND workspace_id = ?').get(caller, workspace)) throw failure('WORKSPACE_NOT_FOUND');
    if (operation === 'secrets.list') return storage().database.prepare('SELECT secret_id, metadata_json, ciphertext, iv, auth_tag, updated_at, key_version FROM workspace_secrets WHERE owner_plugin_id = ? AND workspace_id = ? ORDER BY secret_id').all(caller, workspace).map((row) => { const value = decryptSecret(caller, workspace, row.secret_id, row); return { secretId: row.secret_id, metadata: parse(row.metadata_json), maskedValue: maskSecret(value), updatedAt: row.updated_at, keyVersion: row.key_version }; });
    const secretId = text(input.secretId, 'secretId');
    if (operation === 'secrets.get') { const row = storage().database.prepare('SELECT * FROM workspace_secrets WHERE owner_plugin_id = ? AND workspace_id = ? AND secret_id = ?').get(caller, workspace, secretId); if (!row) return null; const value = decryptSecret(caller, workspace, secretId, row); return { secretId, metadata: parse(row.metadata_json), maskedValue: maskSecret(value), value, updatedAt: row.updated_at, keyVersion: row.key_version }; }
    if (operation === 'secrets.delete') return Number(storage().database.prepare('DELETE FROM workspace_secrets WHERE owner_plugin_id = ? AND workspace_id = ? AND secret_id = ?').run(caller, workspace, secretId).changes) > 0;
    if (typeof input.value !== 'string' || input.value.length > MAX_VALUE_BYTES) invalidPayload('secret value is invalid');
    const encrypted = encryptSecret(caller, workspace, secretId, input.value); const t = now(); storage().database.prepare('INSERT INTO workspace_secrets(owner_plugin_id, workspace_id, secret_id, ciphertext, iv, auth_tag, key_version, metadata_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_plugin_id, workspace_id, secret_id) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, auth_tag = excluded.auth_tag, key_version = excluded.key_version, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at').run(caller, workspace, secretId, encrypted.ciphertext, encrypted.iv, encrypted.authTag, SECRET_KEY_VERSION, json(input.metadata), t); return { secretId, metadata: input.metadata ?? null, maskedValue: maskSecret(input.value), updatedAt: t, keyVersion: SECRET_KEY_VERSION };
  }
  throw failure('BRIDGE_OPERATION_DENIED');
}

function browserAssetPath(req) {
  try {
    const raw = String(req.path ?? req.url ?? '').split('?')[0].replace(/^\/+/, '');
    const target = path.resolve(BROWSER_ROOT, decodeURIComponent(raw)); const relative = path.relative(BROWSER_ROOT, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return target;
  } catch { return null; }
}

function registerWorkspaceRoutes(router) {
  const sendBrowserFile = (res, file) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(file);
  };
  router.get('/artifact-manifest.json', (_req, res) => sendBrowserFile(res, path.join(PLUGIN_ROOT, 'artifact-manifest.json')));
  router.get('/browser/core.js', (_req, res) => sendBrowserFile(res, path.join(BROWSER_ROOT, 'core.js')));
  router.get('/browser/core.css', (_req, res) => sendBrowserFile(res, path.join(BROWSER_ROOT, 'core.css')));
  if (typeof router.use === 'function') router.use('/browser', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const file = browserAssetPath(req); if (!file) return res.status(404).end();
    res.setHeader('Cache-Control', 'no-store');
    return res.sendFile(file, (error) => { if (error && !res.headersSent) res.status(error.statusCode === 403 ? 403 : 404).end(); });
  });
  router.post(BRIDGE_ROUTE, async (req, res) => {
    let requestId;
    try {
      const envelope = assertBridgeEnvelope(bodyOf(req));
      requestId = envelope.requestId;
      const { pluginId, operation, input } = envelope;
      const state = requestStorage(req);
      const data = await storageContext.run(state, () => executeBridgeOperation(pluginId, operation, input));
      res.json({ ok: true, data: data ?? null });
    } catch (error) { routeError(res, error, requestId); }
  });
}

function serverWorkspaceSession(pluginId, capabilities, assertActive) {
  const invoke = (operation, input = {}) => {
    assertActive();
    const capability = BRIDGE_OPERATION_CAPABILITIES[operation];
    if (!capability) throw failure('BRIDGE_OPERATION_DENIED');
    if (!capabilities.has(capability)) throw failure('SERVER_CAPABILITY_DENIED');
    return executeBridgeOperation(pluginId, operation, input);
  };
  return Object.freeze({
    open: async (input) => {
      const workspaceId = workspaceText(input.id);
      await invoke('workspace.open', input);
      return Object.freeze({
        id: workspaceId,
        get: async (collection, id) => {
          const record = invoke('workspace.get', { workspaceId, collection, recordId: id });
          return record ? { id: record.recordId, value: record.value, revision: record.revision, updatedAt: record.updatedAt } : null;
        },
        query: async (collection, options = {}) => {
          const page = invoke('workspace.query', { workspaceId, collection, ...options });
          return {
            records: page.records.map((record) => ({ id: record.recordId, value: record.value, revision: record.revision, updatedAt: record.updatedAt })),
            nextCursor: page.nextCursor,
            ...(page.total === undefined ? {} : { total: page.total }),
          };
        },
        commit: async (request) => {
          const result = invoke('workspace.commit', { id: workspaceId, ...request });
          return { ...result, results: result.results.map(({ recordId, ...item }) => ({ ...item, id: recordId })) };
        },
        vectors: Object.freeze({
          upsert: async (request) => invoke('workspace.vectorUpsert', {
            workspaceId, collection: request.collection, recordId: request.id,
            vector: request.vector, model: request.model, metadata: request.metadata,
          }),
          search: async (request) => invoke('workspace.vectorSearch', { workspaceId, ...request })
            .map(({ recordId, ...hit }) => ({ ...hit, id: recordId })),
          delete: async (collection, id) => invoke('workspace.vectorDelete', { workspaceId, collection, recordId: id }),
          list: async (options = {}) => {
            const page = invoke('workspace.vectorList', { workspaceId, ...options });
            return { vectors: page.vectors.map(({ recordId, ...vector }) => ({ ...vector, id: recordId })), nextCursor: page.nextCursor };
          },
          clear: async (filter = {}) => invoke('workspace.vectorClear', { workspaceId, ...filter }),
        }),
      });
    },
    admin: Object.freeze({
      health: async () => invoke('workspace.health'),
      integrity: async () => invoke('workspace.integrity'),
      reset: async (request = {}) => invoke('workspace.reset', request),
      backup: async (id) => invoke('workspace.backup', { id }),
      repair: async () => invoke('workspace.repair'),
    }),
  });
}

function serverSecretSession(pluginId, capabilities, assertActive) {
  const requireCapability = (capability) => { assertActive(); if (!capabilities.has(capability)) throw failure('SERVER_CAPABILITY_DENIED'); ensureDatabase(); ensureSecretKey(); };
  const requireOwnedWorkspace = (workspaceId) => {
    const workspace = workspaceText(workspaceId);
    if (!storage().database.prepare('SELECT 1 FROM workspaces WHERE owner_plugin_id = ? AND workspace_id = ?').get(pluginId, workspace)) throw failure('WORKSPACE_NOT_FOUND');
    return workspace;
  };
  return Object.freeze({
    set: async (input) => {
      requireCapability('secrets.write'); const workspace = requireOwnedWorkspace(input.workspaceId); const secretId = text(input.secretId, 'secretId');
      if (typeof input.value !== 'string' || input.value.length > MAX_VALUE_BYTES) invalidPayload('secret value is invalid');
      const encrypted = encryptSecret(pluginId, workspace, secretId, input.value); const t = now();
      storage().database.prepare('INSERT INTO workspace_secrets(owner_plugin_id, workspace_id, secret_id, ciphertext, iv, auth_tag, key_version, metadata_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_plugin_id, workspace_id, secret_id) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, auth_tag = excluded.auth_tag, key_version = excluded.key_version, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at').run(pluginId, workspace, secretId, encrypted.ciphertext, encrypted.iv, encrypted.authTag, SECRET_KEY_VERSION, json(input.metadata), t);
      return { secretId, metadata: input.metadata ?? null, maskedValue: maskSecret(input.value), updatedAt: t, keyVersion: SECRET_KEY_VERSION };
    },
    get: async (input) => {
      requireCapability('secrets.read'); const workspace = requireOwnedWorkspace(input.workspaceId); const secretId = text(input.secretId, 'secretId');
      const row = storage().database.prepare('SELECT * FROM workspace_secrets WHERE owner_plugin_id = ? AND workspace_id = ? AND secret_id = ?').get(pluginId, workspace, secretId);
      if (!row) return null; const value = decryptSecret(pluginId, workspace, secretId, row);
      return { secretId, metadata: parse(row.metadata_json), maskedValue: maskSecret(value), value, updatedAt: row.updated_at, keyVersion: row.key_version };
    },
    delete: async (input) => { requireCapability('secrets.write'); const workspace = requireOwnedWorkspace(input.workspaceId); const secretId = text(input.secretId, 'secretId'); return Number(storage().database.prepare('DELETE FROM workspace_secrets WHERE owner_plugin_id = ? AND workspace_id = ? AND secret_id = ?').run(pluginId, workspace, secretId).changes) > 0; },
    list: async (input) => {
      requireCapability('secrets.read'); const workspace = requireOwnedWorkspace(input.workspaceId);
      return storage().database.prepare('SELECT secret_id, metadata_json, ciphertext, iv, auth_tag, updated_at, key_version FROM workspace_secrets WHERE owner_plugin_id = ? AND workspace_id = ? ORDER BY secret_id').all(pluginId, workspace).map((row) => { const value = decryptSecret(pluginId, workspace, row.secret_id, row); return { secretId: row.secret_id, metadata: parse(row.metadata_json), maskedValue: maskSecret(value), updatedAt: row.updated_at, keyVersion: row.key_version }; });
    },
  });
}

const serverBroker = Object.freeze({
  connect(input) {
    const pluginId = text(input?.pluginId, 'pluginId'); const allowed = new Set(BRIDGE_CAPABILITY_POLICY[pluginId] ?? []); const requested = Array.isArray(input?.capabilities) ? input.capabilities : [];
    if (requested.some((capability) => !allowed.has(capability))) throw failure('SERVER_CAPABILITY_DENIED');
    const capabilities = new Set(requested); let active = true; const assertActive = () => { if (!active) throw failure('SERVER_SESSION_CLOSED'); };
    return Object.freeze({ pluginId, capabilities, workspace: serverWorkspaceSession(pluginId, capabilities, assertActive), secrets: serverSecretSession(pluginId, capabilities, assertActive), dispose() { active = false; } });
  },
});

export async function init(router) {
  // Register the route before warming SQLite/secret storage. Browser extensions
  // can load while SillyTavern is still initializing server plugins; registering
  // last created a window where the Core existed but every workspace call got
  // an HTTP 404. The route is now available immediately and storage remains
  // lazily initialized by the first health/operation call.
  serverActive = true;
  registerWorkspaceRoutes(router);
  Object.defineProperty(globalThis, SERVER_BROKER_SYMBOL, { value: serverBroker, configurable: true, enumerable: false, writable: false });
  warmupHandle = setImmediate(() => {
    warmupHandle = undefined;
    if (!serverActive) return;
    try { ensureDatabase(); } catch { /* health route reports the failure */ }
    try { ensureSecretKey(); } catch { /* Secret API reports the failure without disabling the workspace */ }
  });
}

export function exit() {
  serverActive = false;
  if (warmupHandle !== undefined) { clearImmediate(warmupHandle); warmupHandle = undefined; }
  try { delete globalThis[SERVER_BROKER_SYMBOL]; } finally {
    for (const state of userStores.values()) storageContext.run(state, () => { closeWorkspaceDatabase(); state.recoveryInProgress = false; });
    userStores.clear();
    userStores.set(DATA_ROOT, defaultStorage);
  }
}

export const __test = Object.freeze({
  DB_PATH, SECRET_KEY_PATH, WORKSPACE_ROOT, RECOVERY_BACKUP_ROOT, createSchema, ROOT, resolveDatabasePath,
  safeOutboundUrl, createPinnedLookup, httpResponseResult,
  hash: (value) => crypto.createHash('sha256').update(String(value)).digest('hex'),
});
