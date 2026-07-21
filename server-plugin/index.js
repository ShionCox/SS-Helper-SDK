import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const PLUGIN_ID = 'ss-helper-sdk';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
function resolveDatabasePath({ stRoot = process.env.SS_HELPER_ST_ROOT, dataRoot = globalThis.DATA_ROOT } = {}) {
  const resolvedDataRoot = stRoot
    ? path.join(path.resolve(stRoot), 'data')
    : typeof dataRoot === 'string' && dataRoot.trim()
      ? path.resolve(dataRoot)
      : path.join(ROOT, 'data');
  return path.join(resolvedDataRoot, '_ss-helper', 'ss-helper.sqlite3');
}
const DB_PATH = resolveDatabasePath();
const SECRET_KEY_PATH = path.join(path.dirname(DB_PATH), 'ss-helper-secrets.key');
const WORKSPACE_ROOT = path.dirname(DB_PATH);
const DATA_ROOT = path.dirname(WORKSPACE_ROOT);
const TAVERN_ROOT = path.dirname(DATA_ROOT);
const RECOVERY_BACKUP_ROOT = path.join(TAVERN_ROOT, 'backups');
const BROWSER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'browser');
const MAX_VALUE_BYTES = 1024 * 1024;
const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
const MAX_PAGE_SIZE = 1000;
const MAX_TRANSACTION_OPERATIONS = 5000;
const MAX_ARCHIVE_WORKSPACES = 5000;
const MAX_ARCHIVE_COLLECTIONS = 10_000;
const MAX_ARCHIVE_RECORDS = 100_000;
const MAX_ARCHIVE_VECTORS = 100_000;
const MAX_VECTOR_DIMENSIONS = 16_384;
const SCHEMA_VERSION = 4;
const SECRET_KEY_VERSION = 1;
const SERVER_BROKER_SYMBOL = Symbol.for('@ss-helper/sdk.server.v2');
const SERVER_CAPABILITIES = new Set(['workspace.read', 'workspace.write', 'workspace.recovery', 'secrets.read', 'secrets.write', 'services.register']);
const PUBLIC_ERROR_CODES = new Set([
  'PAYLOAD_INVALID', 'WORKSPACE_ACCESS_DENIED', 'WORKSPACE_NOT_FOUND', 'WORKSPACE_CONFLICT', 'WORKSPACE_INDEX_REQUIRED',
  'WORKSPACE_UNAVAILABLE', 'WORKSPACE_DATABASE_UNAVAILABLE', 'WORKSPACE_SECRET_UNAVAILABLE',
  'WORKSPACE_RECOVERY_DENIED', 'WORKSPACE_RECOVERY_CONFIRMATION_REQUIRED',
  'WORKSPACE_RECOVERY_NOT_REQUIRED', 'WORKSPACE_RECOVERY_IN_PROGRESS',
  'WORKSPACE_RECOVERY_BACKUP_FAILED', 'WORKSPACE_RECOVERY_REBUILD_FAILED',
  'SERVER_CAPABILITY_DENIED', 'SERVER_SESSION_CLOSED', 'BACKUP_INTEGRITY_INVALID',
  'BACKUP_TOO_LARGE', 'BACKUP_FORMAT_INVALID', 'BRIDGE_ENVELOPE_INVALID', 'BRIDGE_OPERATION_DENIED',
]);

function readBridgeCapabilityPolicy() {
  const candidates = [
    path.join(BROWSER_ROOT, 'lib', 'bridge', 'bridge-policy.json'),
    path.join(ROOT, 'SS-Helper-SDK', 'apps', 'core-extension', 'src', 'bridge', 'bridge-policy.json'),
  ];
  try {
    const source = candidates.find((candidate) => fs.existsSync(candidate));
    if (!source) throw new Error('bridge policy is missing');
    const parsed = JSON.parse(fs.readFileSync(source, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.version !== 1 || !parsed.plugins || typeof parsed.plugins !== 'object') throw new Error('bridge policy is invalid');
    return Object.freeze(Object.fromEntries(Object.entries(parsed.plugins).flatMap(([pluginId, capabilities]) => {
      if (!/^[-\w.]{1,128}$/u.test(pluginId) || !Array.isArray(capabilities)) return [];
      const allowed = [...new Set(capabilities.filter((capability) => typeof capability === 'string' && SERVER_CAPABILITIES.has(capability)))];
      return allowed.length ? [[pluginId, Object.freeze(allowed)]] : [];
    })));
  } catch { return Object.freeze({}); }
}
const BRIDGE_CAPABILITY_POLICY = readBridgeCapabilityPolicy();
const BRIDGE_ROUTE = '/internal/bridge/v1/call';

export const info = Object.freeze({
  id: PLUGIN_ID,
  name: 'SS-Helper SDK',
  description: 'SS-Helper Core runtime and shared workspace storage',
});

let database;
let initialized = false;
let initError;
let secretKey;
let secretKeyError;
let recoveryInProgress = false;

function now() { return Date.now(); }
function json(value) { return JSON.stringify(value ?? null); }
function parse(value) { return value === null || value === undefined ? null : JSON.parse(value); }
function fileSize(file) { try { return fs.statSync(file).size; } catch { return 0; } }
function databaseSizeBytes() { return fileSize(DB_PATH) + fileSize(`${DB_PATH}-wal`); }
function failure(code, message = code) { const error = new Error(message); error.code = code; return error; }
function publicErrorCode(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  return PUBLIC_ERROR_CODES.has(code) ? code : 'WORKSPACE_UNAVAILABLE';
}
function invalidPayload(message) { throw failure('PAYLOAD_INVALID', message); }
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
  if (secretKey) return secretKey;
  if (secretKeyError) throw secretKeyError;
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
    secretKey = bytes;
    return secretKey;
  } catch (error) {
    secretKeyError = error?.code === 'WORKSPACE_SECRET_UNAVAILABLE' ? error : failure('WORKSPACE_SECRET_UNAVAILABLE', error instanceof Error ? error.message : String(error));
    throw secretKeyError;
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
      value_json TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
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
    CREATE TABLE IF NOT EXISTS workspace_record_revisions(
      owner_plugin_id TEXT NOT NULL, workspace_id TEXT NOT NULL, collection TEXT NOT NULL, record_id TEXT NOT NULL,
      revision INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      PRIMARY KEY(owner_plugin_id, workspace_id, collection, record_id),
      FOREIGN KEY(owner_plugin_id, workspace_id, collection) REFERENCES workspace_collections(owner_plugin_id, workspace_id, name) ON DELETE CASCADE
    ) STRICT;
    CREATE TABLE IF NOT EXISTS workspace_grants(
      owner_plugin_id TEXT NOT NULL, workspace_id TEXT NOT NULL, grantee_plugin_id TEXT NOT NULL,
      actions_json TEXT NOT NULL, expires_at INTEGER,
      PRIMARY KEY(owner_plugin_id, workspace_id, grantee_plugin_id),
      FOREIGN KEY(owner_plugin_id, workspace_id) REFERENCES workspaces(owner_plugin_id, workspace_id) ON DELETE CASCADE
    ) STRICT;
    CREATE TABLE IF NOT EXISTS workspace_request_dedup_v2(
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
    db.exec('INSERT OR IGNORE INTO workspace_record_revisions(owner_plugin_id, workspace_id, collection, record_id, revision, updated_at) SELECT owner_plugin_id, workspace_id, collection, record_id, version, updated_at FROM workspace_records');
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(SCHEMA_VERSION, now());
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function ensureDatabase() {
  if (initialized) return;
  if (initError) throw initError;
  try {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    database = new DatabaseSync(DB_PATH);
    createSchema(database);
    initialized = true;
  } catch (error) {
    try { database?.close(); } catch {}
    database = undefined;
    initError = failure('WORKSPACE_DATABASE_UNAVAILABLE', 'Workspace database is unavailable');
    initError.cause = error;
    throw initError;
  }
}

function closeWorkspaceDatabase() {
  try { database?.close(); } finally {
    database = undefined;
    initialized = false;
    initError = undefined;
    secretKey = undefined;
    secretKeyError = undefined;
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
  const relative = path.relative(RECOVERY_BACKUP_ROOT, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function currentWindowsUserSid() {
  try {
    const output = execFileSync('whoami.exe', ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
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
    execFileSync('icacls.exe', [backupPath, '/inheritance:r', '/grant:r', ...grants, '/T', '/C', '/Q'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    execFileSync('icacls.exe', [backupPath, '/verify', '/T', '/C', '/Q'], {
      encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (error?.code === 'WORKSPACE_RECOVERY_BACKUP_FAILED') throw error;
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
      format: 'ss-helper-recovery-manifest', version: 1, backupId, createdAt,
      source: '_ss-helper', files: copiedFiles,
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
    if (error?.code === 'WORKSPACE_RECOVERY_BACKUP_FAILED') throw error;
    throw failure('WORKSPACE_RECOVERY_BACKUP_FAILED', 'Workspace backup could not be created');
  }
}

function isRecoveryAvailable() {
  return Boolean((initError || secretKeyError) && fs.existsSync(WORKSPACE_ROOT));
}

function workspaceHealth() {
  try {
    ensureDatabase();
  } catch (error) {
    const errorCode = publicErrorCode(error);
    return {
      ok: true, ready: false, status: 'degraded', errorCode, recoverable: isRecoveryAvailable(),
      database: path.basename(DB_PATH), schemaVersion: SCHEMA_VERSION,
      nodeVersion: process.version, databaseSizeBytes: databaseSizeBytes(), secretReady: false,
      secretError: errorCode, error: errorCode,
    };
  }
  const sqliteVersion = database.prepare('SELECT sqlite_version() AS version').get().version;
  const walMode = database.prepare('PRAGMA journal_mode').get().journal_mode;
  let secretReady = false;
  let errorCode;
  try { ensureSecretKey(); secretReady = true; } catch (error) { errorCode = publicErrorCode(error); }
  return {
    ok: true,
    ready: initialized,
    status: errorCode === undefined ? 'ready' : 'degraded',
    ...(errorCode === undefined ? {} : { errorCode, recoverable: isRecoveryAvailable(), error: errorCode, secretError: errorCode }),
    database: path.basename(DB_PATH), schemaVersion: SCHEMA_VERSION, nodeVersion: process.version,
    sqliteVersion, walMode, databaseSizeBytes: databaseSizeBytes(), secretReady,
  };
}

function repairWorkspace() {
  if (recoveryInProgress) throw failure('WORKSPACE_RECOVERY_IN_PROGRESS');
  const health = workspaceHealth();
  if (health.recoverable !== true) throw failure('WORKSPACE_RECOVERY_NOT_REQUIRED');
  recoveryInProgress = true;
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
    recoveryInProgress = false;
  }
}

function hasAccess(owner, workspace, caller, action) {
  if (owner === caller) return true;
  const grant = database.prepare('SELECT actions_json, expires_at FROM workspace_grants WHERE owner_plugin_id = ? AND workspace_id = ? AND grantee_plugin_id = ?').get(owner, workspace, caller);
  if (!grant || (grant.expires_at !== null && Number(grant.expires_at) < now())) return false;
  return parse(grant.actions_json)?.includes(action) === true;
}

function requireWorkspace(input, caller, action = 'read') {
  const owner = text(input.ownerPluginId ?? caller, 'ownerPluginId');
  const workspace = workspaceText(input.workspaceId);
  const row = database.prepare('SELECT * FROM workspaces WHERE owner_plugin_id = ? AND workspace_id = ?').get(owner, workspace);
  if (!row) throw failure('WORKSPACE_NOT_FOUND');
  if (!hasAccess(owner, workspace, caller, action)) throw failure('WORKSPACE_ACCESS_DENIED');
  return { owner, workspace, row };
}

function routeError(res, error) {
  const code = publicErrorCode(error);
  const status = code === 'WORKSPACE_ACCESS_DENIED' || code === 'WORKSPACE_RECOVERY_DENIED' || code === 'SERVER_CAPABILITY_DENIED'
    ? 403
    : code === 'WORKSPACE_NOT_FOUND'
      ? 404
      : code === 'WORKSPACE_CONFLICT' || code === 'WORKSPACE_RECOVERY_IN_PROGRESS'
        ? 409
        : (code === 'WORKSPACE_UNAVAILABLE' || code === 'WORKSPACE_DATABASE_UNAVAILABLE' || code === 'WORKSPACE_SECRET_UNAVAILABLE')
          ? 503
          : 400;
  res.status(status).json({ ok: false, error: code, message: 'The workspace request could not be completed' });
}

function archiveDigest(archive) { return crypto.createHash('sha256').update(JSON.stringify(archive)).digest('hex'); }

function collectionDefinition(owner, workspace, collection) {
  const row = database.prepare('SELECT indexes_json FROM workspace_collections WHERE owner_plugin_id = ? AND workspace_id = ? AND name = ?').get(owner, workspace, collection);
  if (!row) throw failure('WORKSPACE_NOT_FOUND', `Collection ${collection} does not exist`);
  return parse(row.indexes_json) ?? [];
}

function assertExpectedVersion(current, expectedVersion) {
  if (expectedVersion === undefined || expectedVersion === null) return;
  const expected = Number(expectedVersion);
  if (!Number.isInteger(expected) || expected < 0 || Number(current?.version ?? 0) !== expected) throw failure('WORKSPACE_CONFLICT');
}

function expectedRevisionOf(input) { return input.expectedRevision ?? input.expectedVersion; }

function updateRecordIndexes(owner, workspace, collection, recordId, value) {
  const indexes = collectionDefinition(owner, workspace, collection);
  database.prepare('DELETE FROM workspace_record_indexes WHERE owner_plugin_id = ? AND workspace_id = ? AND collection = ? AND record_id = ?').run(owner, workspace, collection, recordId);
  const insert = database.prepare('INSERT INTO workspace_record_indexes(owner_plugin_id, workspace_id, collection, field_name, field_value, record_id) VALUES (?, ?, ?, ?, ?, ?)');
  for (const field of indexes) {
    const fieldValue = readField(value, field);
    if (fieldValue !== undefined) insert.run(owner, workspace, collection, field, json(scalar(fieldValue, field)), recordId);
  }
}

function writeRecord(owner, workspace, input) {
  const collection = text(input.collection ?? 'default', 'collection');
  const recordId = recordText(input.recordId);
  if (sizeOf(input.value) > MAX_VALUE_BYTES) invalidPayload('record value is too large');
  collectionDefinition(owner, workspace, collection);
  const current = database.prepare('SELECT version, created_at FROM workspace_records WHERE owner_plugin_id = ? AND workspace_id = ? AND collection = ? AND record_id = ?').get(owner, workspace, collection, recordId);
  assertExpectedVersion(current, expectedRevisionOf(input));
  const previousRevision = database.prepare('SELECT revision FROM workspace_record_revisions WHERE owner_plugin_id = ? AND workspace_id = ? AND collection = ? AND record_id = ?').get(owner, workspace, collection, recordId);
  const t = now(); const version = Math.max(Number(current?.version ?? 0), Number(previousRevision?.revision ?? 0)) + 1;
  database.prepare('INSERT INTO workspace_records(owner_plugin_id, workspace_id, collection, record_id, value_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_plugin_id, workspace_id, collection, record_id) DO UPDATE SET value_json = excluded.value_json, version = excluded.version, updated_at = excluded.updated_at').run(owner, workspace, collection, recordId, json(input.value), version, Number(current?.created_at ?? t), t);
  updateRecordIndexes(owner, workspace, collection, recordId, input.value);
  database.prepare('INSERT INTO workspace_record_revisions(owner_plugin_id, workspace_id, collection, record_id, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner_plugin_id, workspace_id, collection, record_id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at').run(owner, workspace, collection, recordId, version, t);
  return { collection, recordId, value: input.value, version, revision: version, updatedAt: t };
}

function removeRecord(owner, workspace, input) {
  const collection = text(input.collection ?? 'default', 'collection'); const recordId = recordText(input.recordId);
  collectionDefinition(owner, workspace, collection);
  const current = database.prepare('SELECT version FROM workspace_records WHERE owner_plugin_id = ? AND workspace_id = ? AND collection = ? AND record_id = ?').get(owner, workspace, collection, recordId);
  assertExpectedVersion(current, expectedRevisionOf(input));
  if (!current) return false;
  const revision = Number(current.version) + 1;
  database.prepare('DELETE FROM workspace_records WHERE owner_plugin_id = ? AND workspace_id = ? AND collection = ? AND record_id = ?').run(owner, workspace, collection, recordId);
  database.prepare('DELETE FROM workspace_vectors WHERE owner_plugin_id = ? AND workspace_id = ? AND collection = ? AND record_id = ?').run(owner, workspace, collection, recordId);
  database.prepare('INSERT INTO workspace_record_revisions(owner_plugin_id, workspace_id, collection, record_id, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner_plugin_id, workspace_id, collection, record_id) DO UPDATE SET revision = excluded.revision, updated_at = excluded.updated_at').run(owner, workspace, collection, recordId, revision, now());
  return true;
}

function rebuildCollectionIndexes(owner, workspace, collection) {
  database.prepare('DELETE FROM workspace_record_indexes WHERE owner_plugin_id = ? AND workspace_id = ? AND collection = ?').run(owner, workspace, collection);
  const records = database.prepare('SELECT record_id, value_json FROM workspace_records WHERE owner_plugin_id = ? AND workspace_id = ? AND collection = ?').all(owner, workspace, collection);
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
    if (!declared.has(field)) throw failure('WORKSPACE_INDEX_REQUIRED', `Index ${field} must be declared first`);
  }
  const joins = []; const joinParams = []; const where = ['r.owner_plugin_id = ?', 'r.workspace_id = ?', 'r.collection = ?']; const params = [owner, workspace, collection];
  let sortExpression = orderField === 'recordId' ? 'r.record_id' : 'r.updated_at';
  if (!builtInOrder) {
    joins.push('JOIN workspace_record_indexes ord ON ord.owner_plugin_id = r.owner_plugin_id AND ord.workspace_id = r.workspace_id AND ord.collection = r.collection AND ord.record_id = r.record_id AND ord.field_name = ?');
    joinParams.push(orderField); sortExpression = "json_extract(ord.field_value, '$')";
  }
  const addPredicate = (field, op, rawValue, index) => {
    fieldText(field); const alias = `i${index}`; let condition;
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
  const cursor = decodeCursor(input.cursor);
  if (cursor) {
    const comparison = direction === 'ASC' ? '>' : '<';
    where.push(`(${sortExpression} ${comparison} ? OR (${sortExpression} IS ? AND r.record_id ${comparison} ?))`);
    params.push(sqliteScalar(cursor.sort), sqliteScalar(cursor.sort), String(cursor.recordId ?? ''));
  }
  const limit = clampLimit(input.limit);
  const sql = `SELECT r.record_id, r.value_json, r.version, r.updated_at, ${sortExpression} AS sort_value FROM workspace_records r ${joins.join(' ')} WHERE ${where.join(' AND ')} ORDER BY ${sortExpression} ${direction}, r.record_id ${direction} LIMIT ?`;
  const rows = database.prepare(sql).all(...joinParams, ...params, limit + 1);
  const page = rows.slice(0, limit);
  return {
    records: page.map((row) => ({ recordId: row.record_id, value: parse(row.value_json), version: row.version, revision: row.version, updatedAt: row.updated_at })),
    nextCursor: rows.length > limit && page.length ? encodeCursor({ sort: page.at(-1).sort_value, recordId: page.at(-1).record_id }) : null,
  };
}

function vectorMatches(row, input) {
  if (input.collection && row.collection !== input.collection) return false;
  if (input.model && row.model !== input.model) return false;
  const metadata = parse(row.metadata_json);
  if (input.metadata && Object.entries(input.metadata).some(([field, value]) => readField(metadata, field) !== value)) return false;
  return true;
}

function snapshotWorkspace(owner, workspace, row) {
  const collections = database.prepare('SELECT name, indexes_json FROM workspace_collections WHERE owner_plugin_id = ? AND workspace_id = ? ORDER BY name').all(owner, workspace);
  const records = database.prepare('SELECT collection, record_id, value_json, version, created_at, updated_at FROM workspace_records WHERE owner_plugin_id = ? AND workspace_id = ? ORDER BY collection, record_id').all(owner, workspace);
  const vectors = database.prepare('SELECT collection, record_id, vector_json, model, metadata_json, created_at, updated_at FROM workspace_vectors WHERE owner_plugin_id = ? AND workspace_id = ? ORDER BY collection, record_id').all(owner, workspace);
  return {
    format: 'ss-helper-workspace', version: 1, ownerPluginId: owner, workspaceId: workspace,
    metadata: parse(row.metadata_json), workspaceVersion: row.version,
    collections: collections.map((item) => ({ name: item.name, indexes: parse(item.indexes_json) ?? [] })),
    records: records.map((item) => ({ collection: item.collection, recordId: item.record_id, value: parse(item.value_json), version: item.version, createdAt: item.created_at, updatedAt: item.updated_at })),
    vectors: vectors.map((item) => ({ collection: item.collection, recordId: item.record_id, vector: parse(item.vector_json), model: item.model, metadata: parse(item.metadata_json), createdAt: item.created_at, updatedAt: item.updated_at })),
  };
}

function captureWorkspaceSecrets(owner, workspaceIds) {
  if (!workspaceIds.length) return [];
  const placeholders = workspaceIds.map(() => '?').join(',');
  return database.prepare(`SELECT * FROM workspace_secrets WHERE owner_plugin_id = ? AND workspace_id IN (${placeholders})`).all(owner, ...workspaceIds);
}

function restoreWorkspaceSecrets(rows) {
  const insert = database.prepare('INSERT INTO workspace_secrets(owner_plugin_id, workspace_id, secret_id, ciphertext, iv, auth_tag, key_version, metadata_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const row of rows) insert.run(row.owner_plugin_id, row.workspace_id, row.secret_id, row.ciphertext, row.iv, row.auth_tag, row.key_version, row.metadata_json, row.updated_at);
}

function restoreWorkspace(owner, workspaceId, archive) {
  const workspace = workspaceText(workspaceId); const t = now();
  database.prepare('INSERT INTO workspaces(owner_plugin_id, workspace_id, metadata_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(owner, workspace, json(archive.metadata ?? {}), Number(archive.workspaceVersion) || 1, t, t);
  const collections = Array.isArray(archive.collections) ? archive.collections : [];
  for (const collection of collections) database.prepare('INSERT INTO workspace_collections(owner_plugin_id, workspace_id, name, indexes_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(owner, workspace, text(collection.name, 'collection'), json(Array.isArray(collection.indexes) ? collection.indexes.map((field) => fieldText(field)) : []), t, t);
  if (!collections.some((item) => item?.name === 'default')) database.prepare('INSERT INTO workspace_collections(owner_plugin_id, workspace_id, name, indexes_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(owner, workspace, 'default', '[]', t, t);
  for (const record of Array.isArray(archive.records) ? archive.records : []) {
    const collection = text(record.collection, 'collection'); const recordId = recordText(record.recordId);
    database.prepare('INSERT INTO workspace_records(owner_plugin_id, workspace_id, collection, record_id, value_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(owner, workspace, collection, recordId, json(record.value), Number(record.version) || 1, Number(record.createdAt) || t, Number(record.updatedAt) || t);
    database.prepare('INSERT INTO workspace_record_revisions(owner_plugin_id, workspace_id, collection, record_id, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(owner, workspace, collection, recordId, Number(record.revision ?? record.version) || 1, Number(record.updatedAt) || t);
    updateRecordIndexes(owner, workspace, collection, recordId, record.value);
  }
  for (const vector of Array.isArray(archive.vectors) ? archive.vectors : []) database.prepare('INSERT INTO workspace_vectors(owner_plugin_id, workspace_id, collection, record_id, vector_json, model, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(owner, workspace, text(vector.collection, 'collection'), recordText(vector.recordId), json(vector.vector), vector.model ?? null, json(vector.metadata), Number(vector.createdAt) || t, Number(vector.updatedAt) || t);
}

const BRIDGE_OPERATION_CAPABILITIES = Object.freeze({
  'workspace.health': 'workspace.read', 'workspace.integrity': 'workspace.read',
  'workspace.open': 'workspace.write', 'workspace.list': 'workspace.read', 'workspace.remove': 'workspace.write',
  'workspace.clearOwned': 'workspace.write', 'workspace.defineCollection': 'workspace.write',
  'workspace.get': 'workspace.read', 'workspace.upsert': 'workspace.write', 'workspace.delete': 'workspace.write',
  'workspace.query': 'workspace.read', 'workspace.transaction': 'workspace.write',
  'workspace.vectorUpsert': 'workspace.write', 'workspace.vectorSearch': 'workspace.read',
  'workspace.vectorDelete': 'workspace.write', 'workspace.vectorList': 'workspace.read', 'workspace.vectorClear': 'workspace.write',
  'workspace.grant': 'workspace.write', 'workspace.revoke': 'workspace.write',
  'workspace.export': 'workspace.read', 'workspace.import': 'workspace.write',
  'workspace.exportAll': 'workspace.read', 'workspace.importAll': 'workspace.write',
  'workspace.repair': 'workspace.recovery',
  'secrets.set': 'secrets.write', 'secrets.get': 'secrets.read', 'secrets.delete': 'secrets.write', 'secrets.list': 'secrets.read',
});

function assertBridgeEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw failure('BRIDGE_ENVELOPE_INVALID');
  const keys = Object.keys(value);
  if (keys.length !== 4 || !keys.every((key) => ['version', 'pluginId', 'operation', 'input'].includes(key)) || value.version !== 1) {
    throw failure('BRIDGE_ENVELOPE_INVALID');
  }
  const pluginId = text(value.pluginId, 'pluginId');
  const operation = text(value.operation, 'operation');
  const input = value.input;
  if (!input || typeof input !== 'object' || Array.isArray(input) || sizeOf(input) > MAX_BACKUP_BYTES) throw failure('BRIDGE_ENVELOPE_INVALID');
  return { pluginId, operation, input };
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

function validateWorkspaceArchive(archive) {
  if (!archive || typeof archive !== 'object' || Array.isArray(archive) || sizeOf(archive) > MAX_BACKUP_BYTES) throw failure('BACKUP_TOO_LARGE');
  if (archive.format !== 'ss-helper-workspace' || archive.version !== 1) throw failure('BACKUP_FORMAT_INVALID');
  const collections = Array.isArray(archive.collections) ? archive.collections : [];
  const records = Array.isArray(archive.records) ? archive.records : [];
  const vectors = Array.isArray(archive.vectors) ? archive.vectors : [];
  if (collections.length > MAX_ARCHIVE_COLLECTIONS || records.length > MAX_ARCHIVE_RECORDS || vectors.length > MAX_ARCHIVE_VECTORS) throw failure('BACKUP_TOO_LARGE');
  for (const record of records) {
    if (!record || typeof record !== 'object' || sizeOf(record.value) > MAX_VALUE_BYTES) throw failure('BACKUP_FORMAT_INVALID');
  }
  for (const vector of vectors) {
    if (!vector || typeof vector !== 'object') throw failure('BACKUP_FORMAT_INVALID');
    validateVector(vector.vector);
  }
}

function validateOwnerArchive(archive, pluginId) {
  if (!archive || typeof archive !== 'object' || Array.isArray(archive) || sizeOf(archive) > MAX_BACKUP_BYTES) throw failure('BACKUP_TOO_LARGE');
  if (archive.format !== 'ss-helper-workspace-owner' || archive.version !== 1 || archive.ownerPluginId !== pluginId || !Array.isArray(archive.workspaces)) throw failure('BACKUP_FORMAT_INVALID');
  if (archive.workspaces.length > MAX_ARCHIVE_WORKSPACES) throw failure('BACKUP_TOO_LARGE');
  for (const workspace of archive.workspaces) validateWorkspaceArchive(workspace);
}

function clearOwnedWorkspaces(caller, input) {
  const preserve = Array.isArray(input.preserveWorkspaceIds) ? input.preserveWorkspaceIds.map((value) => workspaceText(value)) : [];
  const idempotencyKey = input.idempotencyKey === undefined ? '' : text(input.idempotencyKey, 'idempotencyKey');
  const cached = idempotencyKey ? database.prepare('SELECT response_json FROM workspace_request_dedup_v2 WHERE caller_plugin_id = ? AND owner_plugin_id = ? AND workspace_id = ? AND request_id = ?').get(caller, caller, '*', idempotencyKey) : null;
  if (cached) return { ...parse(cached.response_json), replayed: true };
  database.exec('BEGIN IMMEDIATE');
  let removed;
  try {
    const sql = `DELETE FROM workspaces WHERE owner_plugin_id = ? ${preserve.length ? `AND workspace_id NOT IN (${preserve.map(() => '?').join(',')})` : ''}`;
    removed = Number(database.prepare(sql).run(caller, ...preserve).changes);
    database.exec('COMMIT');
  } catch (error) { database.exec('ROLLBACK'); throw error; }
  const result = { removed, replayed: false };
  if (idempotencyKey) database.prepare('INSERT INTO workspace_request_dedup_v2(caller_plugin_id, owner_plugin_id, workspace_id, request_id, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(caller, caller, '*', idempotencyKey, json(result), now());
  return result;
}

function transactWorkspace(caller, input) {
  const { owner, workspace } = requireWorkspace(input, caller, 'write');
  const operations = Array.isArray(input.operations) ? input.operations : [];
  if (operations.length > MAX_TRANSACTION_OPERATIONS) invalidPayload('too many transaction operations');
  const idempotencyKey = input.idempotencyKey === undefined ? '' : text(input.idempotencyKey, 'idempotencyKey');
  const previous = idempotencyKey ? database.prepare('SELECT response_json FROM workspace_request_dedup_v2 WHERE caller_plugin_id = ? AND owner_plugin_id = ? AND workspace_id = ? AND request_id = ?').get(caller, owner, workspace, idempotencyKey) : null;
  if (previous) return { ...parse(previous.response_json), replayed: true };
  const results = [];
  database.exec('BEGIN IMMEDIATE');
  try {
    for (const operation of operations) {
      if (operation?.action === 'upsert') {
        const record = writeRecord(owner, workspace, operation);
        results.push({ collection: record.collection, recordId: record.recordId, action: 'upsert', version: record.version, revision: record.revision });
      } else if (operation?.action === 'delete') {
        results.push({ collection: text(operation.collection ?? 'default', 'collection'), recordId: recordText(operation.recordId), action: 'delete', removed: removeRecord(owner, workspace, operation) });
      } else invalidPayload('transaction operation is invalid');
    }
    database.prepare('UPDATE workspaces SET version = version + 1, updated_at = ? WHERE owner_plugin_id = ? AND workspace_id = ?').run(now(), owner, workspace);
    database.exec('COMMIT');
  } catch (error) { database.exec('ROLLBACK'); throw error; }
  const result = { operationCount: operations.length, replayed: false, results };
  if (idempotencyKey) database.prepare('INSERT INTO workspace_request_dedup_v2(caller_plugin_id, owner_plugin_id, workspace_id, request_id, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(caller, owner, workspace, idempotencyKey, json(result), now());
  return result;
}

function executeBridgeOperation(caller, operation, input) {
  requireBridgeCapability(caller, operation);
  if (operation === 'workspace.health') return workspaceHealth();
  if (operation === 'workspace.repair') {
    if (Object.keys(input).length !== 1 || input.confirm !== true) throw failure('WORKSPACE_RECOVERY_CONFIRMATION_REQUIRED');
    return repairWorkspace();
  }
  ensureDatabase();
  if (operation === 'workspace.integrity') {
    const messages = database.prepare('PRAGMA integrity_check').all().map((row) => String(row.integrity_check));
    return { ok: messages.length === 1 && messages[0] === 'ok', messages };
  }
  if (operation === 'workspace.open') {
    const workspaceId = workspaceText(input.workspaceId); const owner = text(input.ownerPluginId ?? caller, 'ownerPluginId'); const t = now();
    const existing = database.prepare('SELECT * FROM workspaces WHERE owner_plugin_id = ? AND workspace_id = ?').get(owner, workspaceId);
    if (!existing) {
      if (owner !== caller) throw failure('WORKSPACE_ACCESS_DENIED');
      if (input.create === false) throw failure('WORKSPACE_NOT_FOUND');
      database.prepare('INSERT INTO workspaces(owner_plugin_id, workspace_id, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(owner, workspaceId, json(input.metadata ?? {}), t, t);
      database.prepare('INSERT INTO workspace_collections(owner_plugin_id, workspace_id, name, indexes_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(owner, workspaceId, 'default', '[]', t, t);
    } else if (!hasAccess(owner, workspaceId, caller, 'read')) throw failure('WORKSPACE_ACCESS_DENIED');
    const row = existing ?? database.prepare('SELECT * FROM workspaces WHERE owner_plugin_id = ? AND workspace_id = ?').get(owner, workspaceId);
    return { ownerPluginId: owner, workspaceId, created: !existing, metadata: parse(row.metadata_json), version: row.version };
  }
  if (operation === 'workspace.list') {
    const limit = clampLimit(input.limit); const cursor = decodeCursor(input.cursor);
    const rows = database.prepare(`SELECT * FROM workspaces WHERE owner_plugin_id = ? ${cursor ? 'AND workspace_id > ?' : ''} ORDER BY workspace_id ASC LIMIT ?`).all(caller, ...(cursor ? [String(cursor.workspaceId ?? '')] : []), limit + 1);
    const page = rows.slice(0, limit);
    return { workspaces: page.map((row) => ({ ownerPluginId: caller, workspaceId: row.workspace_id, created: false, metadata: parse(row.metadata_json), version: row.version })), nextCursor: rows.length > limit && page.length ? encodeCursor({ workspaceId: page.at(-1).workspace_id }) : null };
  }
  if (operation === 'workspace.remove') {
    const workspace = workspaceText(input.workspaceId); const row = database.prepare('SELECT version FROM workspaces WHERE owner_plugin_id = ? AND workspace_id = ?').get(caller, workspace);
    if (!row) throw failure('WORKSPACE_NOT_FOUND');
    assertExpectedVersion(row, input.expectedVersion); database.prepare('DELETE FROM workspaces WHERE owner_plugin_id = ? AND workspace_id = ?').run(caller, workspace); return undefined;
  }
  if (operation === 'workspace.clearOwned') return clearOwnedWorkspaces(caller, input).removed;
  if (operation === 'workspace.defineCollection') {
    const { owner, workspace } = requireWorkspace(input, caller, 'write'); const name = text(input.name, 'name'); const t = now();
    const indexes = Array.isArray(input.indexes) ? [...new Set(input.indexes.map((field) => fieldText(field)))] : [];
    database.prepare('INSERT INTO workspace_collections(owner_plugin_id, workspace_id, name, indexes_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner_plugin_id, workspace_id, name) DO UPDATE SET indexes_json = excluded.indexes_json, updated_at = excluded.updated_at').run(owner, workspace, name, json(indexes), t, t);
    rebuildCollectionIndexes(owner, workspace, name); return undefined;
  }
  if (operation === 'workspace.get') {
    const { owner, workspace } = requireWorkspace(input, caller, 'read'); const collection = text(input.collection ?? 'default', 'collection'); const recordId = recordText(input.recordId); collectionDefinition(owner, workspace, collection);
    const row = database.prepare('SELECT value_json, version, updated_at FROM workspace_records WHERE owner_plugin_id = ? AND workspace_id = ? AND collection = ? AND record_id = ?').get(owner, workspace, collection, recordId);
    return row ? { recordId, value: parse(row.value_json), version: row.version, revision: row.version, updatedAt: row.updated_at } : null;
  }
  if (operation === 'workspace.upsert') { const { owner, workspace } = requireWorkspace(input, caller, 'write'); return writeRecord(owner, workspace, input); }
  if (operation === 'workspace.delete') { const { owner, workspace } = requireWorkspace(input, caller, 'write'); return removeRecord(owner, workspace, input); }
  if (operation === 'workspace.query') { const { owner, workspace } = requireWorkspace(input, caller, 'read'); return queryRecords(owner, workspace, input); }
  if (operation === 'workspace.transaction') return transactWorkspace(caller, input);
  if (operation === 'workspace.grant' || operation === 'workspace.revoke') {
    const owner = text(input.ownerPluginId ?? caller, 'ownerPluginId'); const workspace = workspaceText(input.workspaceId);
    if (owner !== caller || !database.prepare('SELECT 1 FROM workspaces WHERE owner_plugin_id = ? AND workspace_id = ?').get(owner, workspace)) throw failure('WORKSPACE_ACCESS_DENIED');
    const grantee = text(input.granteePluginId, 'granteePluginId');
    if (operation === 'workspace.revoke') database.prepare('DELETE FROM workspace_grants WHERE owner_plugin_id = ? AND workspace_id = ? AND grantee_plugin_id = ?').run(owner, workspace, grantee);
    else {
      const actions = Array.isArray(input.actions) ? [...new Set(input.actions.filter((action) => ['read', 'write', 'vector', 'backup'].includes(action)))] : [];
      if (!actions.length) invalidPayload('grant actions are required');
      database.prepare('INSERT INTO workspace_grants(owner_plugin_id, workspace_id, grantee_plugin_id, actions_json, expires_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner_plugin_id, workspace_id, grantee_plugin_id) DO UPDATE SET actions_json = excluded.actions_json, expires_at = excluded.expires_at').run(owner, workspace, grantee, json(actions), input.expiresAt ?? null);
    }
    return undefined;
  }
  if (operation === 'workspace.vectorUpsert' || operation === 'workspace.vectorDelete') {
    const { owner, workspace } = requireWorkspace(input, caller, 'vector'); const collection = text(input.collection ?? 'default', 'collection'); const recordId = recordText(input.recordId);
    if (operation === 'workspace.vectorDelete') return Number(database.prepare('DELETE FROM workspace_vectors WHERE owner_plugin_id = ? AND workspace_id = ? AND collection = ? AND record_id = ?').run(owner, workspace, collection, recordId).changes) > 0;
    collectionDefinition(owner, workspace, collection);
    if (!database.prepare('SELECT 1 FROM workspace_records WHERE owner_plugin_id = ? AND workspace_id = ? AND collection = ? AND record_id = ?').get(owner, workspace, collection, recordId)) throw failure('WORKSPACE_NOT_FOUND');
    const vector = validateVector(input.vector); const current = database.prepare('SELECT created_at FROM workspace_vectors WHERE owner_plugin_id = ? AND workspace_id = ? AND collection = ? AND record_id = ?').get(owner, workspace, collection, recordId); const t = now();
    database.prepare('INSERT INTO workspace_vectors(owner_plugin_id, workspace_id, collection, record_id, vector_json, model, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_plugin_id, workspace_id, collection, record_id) DO UPDATE SET vector_json = excluded.vector_json, model = excluded.model, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at').run(owner, workspace, collection, recordId, json(vector), input.model ?? null, json(input.metadata), Number(current?.created_at ?? t), t);
    return undefined;
  }
  if (operation === 'workspace.vectorSearch') {
    const { owner, workspace } = requireWorkspace(input, caller, 'vector'); const query = validateVector(input.vector);
    const rows = database.prepare('SELECT collection, record_id, vector_json, model, metadata_json FROM workspace_vectors WHERE owner_plugin_id = ? AND workspace_id = ?').all(owner, workspace).filter((row) => vectorMatches(row, input));
    const norm = Math.sqrt(query.reduce((sum, value) => sum + value * value, 0)) || 1;
    return rows.map((row) => {
      const vector = parse(row.vector_json) ?? []; if (!Array.isArray(vector) || vector.length !== query.length) return null;
      const denominator = (Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1) * norm;
      return { collection: row.collection, recordId: row.record_id, score: vector.reduce((sum, value, index) => sum + value * query[index], 0) / denominator, model: row.model ?? undefined, metadata: parse(row.metadata_json) };
    }).filter(Boolean).sort((a, b) => b.score - a.score || a.recordId.localeCompare(b.recordId)).slice(0, clampLimit(input.limit, 10));
  }
  if (operation === 'workspace.vectorList') {
    const { owner, workspace } = requireWorkspace(input, caller, 'vector'); const limit = clampLimit(input.limit); const cursor = decodeCursor(input.cursor);
    let rows = database.prepare('SELECT collection, record_id, vector_json, model, metadata_json, created_at, updated_at FROM workspace_vectors WHERE owner_plugin_id = ? AND workspace_id = ? ORDER BY updated_at DESC, record_id DESC').all(owner, workspace).filter((row) => vectorMatches(row, input));
    if (cursor) { const index = rows.findIndex((row) => row.collection === cursor.collection && row.record_id === cursor.recordId); if (index >= 0) rows = rows.slice(index + 1); }
    const page = rows.slice(0, limit);
    return { vectors: page.map((row) => ({ collection: row.collection, recordId: row.record_id, model: row.model ?? undefined, metadata: parse(row.metadata_json), dimensions: (parse(row.vector_json) ?? []).length, createdAt: row.created_at, updatedAt: row.updated_at })), nextCursor: rows.length > limit && page.length ? encodeCursor({ collection: page.at(-1).collection, recordId: page.at(-1).record_id }) : null };
  }
  if (operation === 'workspace.vectorClear') {
    const { owner, workspace } = requireWorkspace(input, caller, 'vector'); const rows = database.prepare('SELECT collection, record_id, model, metadata_json FROM workspace_vectors WHERE owner_plugin_id = ? AND workspace_id = ?').all(owner, workspace).filter((row) => vectorMatches(row, input));
    const remove = database.prepare('DELETE FROM workspace_vectors WHERE owner_plugin_id = ? AND workspace_id = ? AND collection = ? AND record_id = ?'); database.exec('BEGIN IMMEDIATE');
    try { for (const row of rows) remove.run(owner, workspace, row.collection, row.record_id); database.exec('COMMIT'); } catch (error) { database.exec('ROLLBACK'); throw error; }
    return rows.length;
  }
  if (operation === 'workspace.export') {
    const { owner, workspace, row } = requireWorkspace(input, caller, 'backup'); const archive = snapshotWorkspace(owner, workspace, row); return { archive, sha256: archiveDigest(archive) };
  }
  if (operation === 'workspace.import') {
    const archive = input.archive; validateWorkspaceArchive(archive);
    if (typeof input.sha256 !== 'string' || archiveDigest(archive) !== input.sha256) throw failure('BACKUP_INTEGRITY_INVALID');
    const { owner, workspace } = requireWorkspace(input, caller, 'backup'); const preservedSecrets = captureWorkspaceSecrets(owner, [workspace]); database.exec('BEGIN IMMEDIATE');
    try { database.prepare('DELETE FROM workspaces WHERE owner_plugin_id = ? AND workspace_id = ?').run(owner, workspace); restoreWorkspace(owner, workspace, archive); restoreWorkspaceSecrets(preservedSecrets); database.exec('COMMIT'); } catch (error) { database.exec('ROLLBACK'); throw error; }
    return undefined;
  }
  if (operation === 'workspace.exportAll') {
    const rows = database.prepare('SELECT * FROM workspaces WHERE owner_plugin_id = ? ORDER BY workspace_id').all(caller); const archive = { format: 'ss-helper-workspace-owner', version: 1, ownerPluginId: caller, exportedAt: now(), workspaces: rows.map((row) => snapshotWorkspace(caller, row.workspace_id, row)) }; return { archive, sha256: archiveDigest(archive) };
  }
  if (operation === 'workspace.importAll') {
    const archive = input.archive; validateOwnerArchive(archive, caller);
    if (typeof input.sha256 !== 'string' || archiveDigest(archive) !== input.sha256) throw failure('BACKUP_INTEGRITY_INVALID');
    const preservedSecrets = captureWorkspaceSecrets(caller, archive.workspaces.map((workspace) => workspace.workspaceId)); database.exec('BEGIN IMMEDIATE');
    try { database.prepare('DELETE FROM workspaces WHERE owner_plugin_id = ?').run(caller); for (const workspace of archive.workspaces) restoreWorkspace(caller, workspace.workspaceId, workspace); restoreWorkspaceSecrets(preservedSecrets); database.exec('COMMIT'); } catch (error) { database.exec('ROLLBACK'); throw error; }
    return undefined;
  }
  if (operation === 'secrets.set' || operation === 'secrets.get' || operation === 'secrets.delete' || operation === 'secrets.list') {
    const workspace = workspaceText(input.workspaceId);
    if (!database.prepare('SELECT 1 FROM workspaces WHERE owner_plugin_id = ? AND workspace_id = ?').get(caller, workspace)) throw failure('WORKSPACE_NOT_FOUND');
    if (operation === 'secrets.list') return database.prepare('SELECT secret_id, metadata_json, ciphertext, iv, auth_tag, updated_at, key_version FROM workspace_secrets WHERE owner_plugin_id = ? AND workspace_id = ? ORDER BY secret_id').all(caller, workspace).map((row) => { const value = decryptSecret(caller, workspace, row.secret_id, row); return { secretId: row.secret_id, metadata: parse(row.metadata_json), maskedValue: maskSecret(value), updatedAt: row.updated_at, keyVersion: row.key_version }; });
    const secretId = text(input.secretId, 'secretId');
    if (operation === 'secrets.get') { const row = database.prepare('SELECT * FROM workspace_secrets WHERE owner_plugin_id = ? AND workspace_id = ? AND secret_id = ?').get(caller, workspace, secretId); if (!row) return null; const value = decryptSecret(caller, workspace, secretId, row); return { secretId, metadata: parse(row.metadata_json), maskedValue: maskSecret(value), value, updatedAt: row.updated_at, keyVersion: row.key_version }; }
    if (operation === 'secrets.delete') return Number(database.prepare('DELETE FROM workspace_secrets WHERE owner_plugin_id = ? AND workspace_id = ? AND secret_id = ?').run(caller, workspace, secretId).changes) > 0;
    if (typeof input.value !== 'string' || input.value.length > MAX_VALUE_BYTES) invalidPayload('secret value is invalid');
    const encrypted = encryptSecret(caller, workspace, secretId, input.value); const t = now(); database.prepare('INSERT INTO workspace_secrets(owner_plugin_id, workspace_id, secret_id, ciphertext, iv, auth_tag, key_version, metadata_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_plugin_id, workspace_id, secret_id) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, auth_tag = excluded.auth_tag, key_version = excluded.key_version, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at').run(caller, workspace, secretId, encrypted.ciphertext, encrypted.iv, encrypted.authTag, SECRET_KEY_VERSION, json(input.metadata), t); return { secretId, metadata: input.metadata ?? null, maskedValue: maskSecret(input.value), updatedAt: t, keyVersion: SECRET_KEY_VERSION };
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
  router.get('/browser/core.js', (_req, res) => res.sendFile(path.join(BROWSER_ROOT, 'core.js')));
  router.get('/browser/core.css', (_req, res) => res.sendFile(path.join(BROWSER_ROOT, 'core.css')));
  if (typeof router.use === 'function') router.use('/browser', (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const file = browserAssetPath(req); if (!file) return res.status(404).end();
    return res.sendFile(file, (error) => { if (error && !res.headersSent) res.status(error.statusCode === 403 ? 403 : 404).end(); });
  });
  router.post(BRIDGE_ROUTE, (req, res) => {
    try {
      const { pluginId, operation, input } = assertBridgeEnvelope(bodyOf(req));
      res.json({ ok: true, data: executeBridgeOperation(pluginId, operation, input) ?? null });
    } catch (error) { routeError(res, error); }
  });
}

function serverWorkspaceSession(pluginId, capabilities, assertActive) {
  const assertCapability = (capability) => {
    assertActive();
    if (!capabilities.has(capability)) throw failure('SERVER_CAPABILITY_DENIED');
  };
  const requireCapability = (capability) => {
    assertCapability(capability);
    ensureDatabase();
  };
  const transact = (input) => {
    requireCapability('workspace.write');
    const { owner, workspace } = requireWorkspace(input, pluginId, 'write');
    const operations = Array.isArray(input.operations) ? input.operations : [];
    if (operations.length > MAX_TRANSACTION_OPERATIONS) invalidPayload('too many transaction operations');
    const idempotencyKey = input.idempotencyKey === undefined ? '' : text(input.idempotencyKey, 'idempotencyKey');
    const previous = idempotencyKey ? database.prepare('SELECT response_json FROM workspace_request_dedup_v2 WHERE caller_plugin_id = ? AND owner_plugin_id = ? AND workspace_id = ? AND request_id = ?').get(pluginId, owner, workspace, idempotencyKey) : null;
    if (previous) return { ...parse(previous.response_json), replayed: true };
    const results = [];
    database.exec('BEGIN IMMEDIATE');
    try {
      for (const operation of operations) {
        if (operation?.action === 'upsert') {
          const record = writeRecord(owner, workspace, operation);
          results.push({ collection: record.collection, recordId: record.recordId, action: 'upsert', version: record.version, revision: record.revision });
        } else if (operation?.action === 'delete') {
          results.push({ collection: text(operation.collection ?? 'default', 'collection'), recordId: recordText(operation.recordId), action: 'delete', removed: removeRecord(owner, workspace, operation) });
        } else invalidPayload('transaction operation is invalid');
      }
      database.prepare('UPDATE workspaces SET version = version + 1, updated_at = ? WHERE owner_plugin_id = ? AND workspace_id = ?').run(now(), owner, workspace);
      database.exec('COMMIT');
    } catch (error) { database.exec('ROLLBACK'); throw error; }
    const response = { operationCount: operations.length, replayed: false, results };
    if (idempotencyKey) database.prepare('INSERT INTO workspace_request_dedup_v2(caller_plugin_id, owner_plugin_id, workspace_id, request_id, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(pluginId, owner, workspace, idempotencyKey, json(response), now());
    return response;
  };
  return Object.freeze({
    health: async () => {
      assertCapability('workspace.read');
      return workspaceHealth();
    },
    open: async (input) => {
      requireCapability('workspace.write');
      const workspaceId = workspaceText(input.workspaceId); const t = now();
      const existing = database.prepare('SELECT * FROM workspaces WHERE owner_plugin_id = ? AND workspace_id = ?').get(pluginId, workspaceId);
      if (!existing) {
        if (input.create === false) throw failure('WORKSPACE_NOT_FOUND');
        database.prepare('INSERT INTO workspaces(owner_plugin_id, workspace_id, metadata_json, version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)').run(pluginId, workspaceId, json(input.metadata ?? {}), t, t);
        database.prepare('INSERT INTO workspace_collections(owner_plugin_id, workspace_id, name, indexes_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(pluginId, workspaceId, 'default', '[]', t, t);
      }
      const row = existing ?? database.prepare('SELECT * FROM workspaces WHERE owner_plugin_id = ? AND workspace_id = ?').get(pluginId, workspaceId);
      return { ownerPluginId: pluginId, workspaceId, created: !existing, metadata: parse(row.metadata_json), version: row.version };
    },
    defineCollection: async (input) => {
      requireCapability('workspace.write'); const { owner, workspace } = requireWorkspace(input, pluginId, 'write'); const name = text(input.name, 'name'); const t = now();
      const indexes = Array.isArray(input.indexes) ? [...new Set(input.indexes.map((field) => fieldText(field)))] : [];
      database.prepare('INSERT INTO workspace_collections(owner_plugin_id, workspace_id, name, indexes_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(owner_plugin_id, workspace_id, name) DO UPDATE SET indexes_json = excluded.indexes_json, updated_at = excluded.updated_at').run(owner, workspace, name, json(indexes), t, t);
      rebuildCollectionIndexes(owner, workspace, name);
    },
    get: async (input) => {
      requireCapability('workspace.read'); const { owner, workspace } = requireWorkspace(input, pluginId, 'read'); const collection = text(input.collection ?? 'default', 'collection'); const recordId = recordText(input.recordId); collectionDefinition(owner, workspace, collection);
      const row = database.prepare('SELECT value_json, version, updated_at FROM workspace_records WHERE owner_plugin_id = ? AND workspace_id = ? AND collection = ? AND record_id = ?').get(owner, workspace, collection, recordId);
      return row ? { recordId, value: parse(row.value_json), version: row.version, revision: row.version, updatedAt: row.updated_at } : null;
    },
    upsert: async (input) => { requireCapability('workspace.write'); const { owner, workspace } = requireWorkspace(input, pluginId, 'write'); return writeRecord(owner, workspace, input); },
    delete: async (input) => { requireCapability('workspace.write'); const { owner, workspace } = requireWorkspace(input, pluginId, 'write'); return removeRecord(owner, workspace, input); },
    query: async (input) => { requireCapability('workspace.read'); const { owner, workspace } = requireWorkspace(input, pluginId, 'read'); return queryRecords(owner, workspace, input); },
    transaction: async (input) => transact(input),
    clearOwned: async (input = {}) => {
      requireCapability('workspace.write'); return clearOwnedWorkspaces(pluginId, input).removed;
    },
    exportAll: async () => {
      requireCapability('workspace.read'); const rows = database.prepare('SELECT * FROM workspaces WHERE owner_plugin_id = ? ORDER BY workspace_id').all(pluginId);
      const archive = { format: 'ss-helper-workspace-owner', version: 1, ownerPluginId: pluginId, exportedAt: now(), workspaces: rows.map((row) => snapshotWorkspace(pluginId, row.workspace_id, row)) };
      return { archive, sha256: archiveDigest(archive) };
    },
    importAll: async (input) => {
      requireCapability('workspace.write'); const archive = input.archive;
      validateOwnerArchive(archive, pluginId);
      if (typeof input.sha256 !== 'string' || archiveDigest(archive) !== input.sha256) throw failure('BACKUP_INTEGRITY_INVALID');
      const preservedSecrets = captureWorkspaceSecrets(pluginId, archive.workspaces.map((workspace) => workspace.workspaceId)); database.exec('BEGIN IMMEDIATE');
      try { database.prepare('DELETE FROM workspaces WHERE owner_plugin_id = ?').run(pluginId); for (const workspace of archive.workspaces) restoreWorkspace(pluginId, workspace.workspaceId, workspace); restoreWorkspaceSecrets(preservedSecrets); database.exec('COMMIT'); }
      catch (error) { database.exec('ROLLBACK'); throw error; }
    },
    repair: async (input) => {
      assertCapability('workspace.recovery');
      if (!input || Object.keys(input).length !== 1 || input.confirm !== true) throw failure('WORKSPACE_RECOVERY_CONFIRMATION_REQUIRED');
      return repairWorkspace();
    },
  });
}

function serverSecretSession(pluginId, capabilities, assertActive) {
  const requireCapability = (capability) => { assertActive(); if (!capabilities.has(capability)) throw failure('SERVER_CAPABILITY_DENIED'); ensureDatabase(); ensureSecretKey(); };
  const requireOwnedWorkspace = (workspaceId) => {
    const workspace = workspaceText(workspaceId);
    if (!database.prepare('SELECT 1 FROM workspaces WHERE owner_plugin_id = ? AND workspace_id = ?').get(pluginId, workspace)) throw failure('WORKSPACE_NOT_FOUND');
    return workspace;
  };
  return Object.freeze({
    set: async (input) => {
      requireCapability('secrets.write'); const workspace = requireOwnedWorkspace(input.workspaceId); const secretId = text(input.secretId, 'secretId');
      if (typeof input.value !== 'string' || input.value.length > MAX_VALUE_BYTES) invalidPayload('secret value is invalid');
      const encrypted = encryptSecret(pluginId, workspace, secretId, input.value); const t = now();
      database.prepare('INSERT INTO workspace_secrets(owner_plugin_id, workspace_id, secret_id, ciphertext, iv, auth_tag, key_version, metadata_json, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_plugin_id, workspace_id, secret_id) DO UPDATE SET ciphertext = excluded.ciphertext, iv = excluded.iv, auth_tag = excluded.auth_tag, key_version = excluded.key_version, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at').run(pluginId, workspace, secretId, encrypted.ciphertext, encrypted.iv, encrypted.authTag, SECRET_KEY_VERSION, json(input.metadata), t);
      return { secretId, metadata: input.metadata ?? null, maskedValue: maskSecret(input.value), updatedAt: t, keyVersion: SECRET_KEY_VERSION };
    },
    get: async (input) => {
      requireCapability('secrets.read'); const workspace = requireOwnedWorkspace(input.workspaceId); const secretId = text(input.secretId, 'secretId');
      const row = database.prepare('SELECT * FROM workspace_secrets WHERE owner_plugin_id = ? AND workspace_id = ? AND secret_id = ?').get(pluginId, workspace, secretId);
      if (!row) return null; const value = decryptSecret(pluginId, workspace, secretId, row);
      return { secretId, metadata: parse(row.metadata_json), maskedValue: maskSecret(value), value, updatedAt: row.updated_at, keyVersion: row.key_version };
    },
    delete: async (input) => { requireCapability('secrets.write'); const workspace = requireOwnedWorkspace(input.workspaceId); const secretId = text(input.secretId, 'secretId'); return Number(database.prepare('DELETE FROM workspace_secrets WHERE owner_plugin_id = ? AND workspace_id = ? AND secret_id = ?').run(pluginId, workspace, secretId).changes) > 0; },
    list: async (input) => {
      requireCapability('secrets.read'); const workspace = requireOwnedWorkspace(input.workspaceId);
      return database.prepare('SELECT secret_id, metadata_json, ciphertext, iv, auth_tag, updated_at, key_version FROM workspace_secrets WHERE owner_plugin_id = ? AND workspace_id = ? ORDER BY secret_id').all(pluginId, workspace).map((row) => { const value = decryptSecret(pluginId, workspace, row.secret_id, row); return { secretId: row.secret_id, metadata: parse(row.metadata_json), maskedValue: maskSecret(value), updatedAt: row.updated_at, keyVersion: row.key_version }; });
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
  try { ensureDatabase(); } catch { /* health route reports the failure */ }
  try { ensureSecretKey(); } catch { /* Secret API reports the failure without disabling the workspace */ }
  registerWorkspaceRoutes(router);
  Object.defineProperty(globalThis, SERVER_BROKER_SYMBOL, { value: serverBroker, configurable: true, enumerable: false, writable: false });
}

export function exit() {
  try { delete globalThis[SERVER_BROKER_SYMBOL]; } finally { closeWorkspaceDatabase(); recoveryInProgress = false; }
}

export const __test = Object.freeze({
  DB_PATH, SECRET_KEY_PATH, WORKSPACE_ROOT, RECOVERY_BACKUP_ROOT, createSchema, ROOT, resolveDatabasePath,
  hash: (value) => crypto.createHash('sha256').update(String(value)).digest('hex'),
});
