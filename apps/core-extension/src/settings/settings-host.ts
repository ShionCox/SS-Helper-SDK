import {
  SSHelperError,
  type CoreDescriptor,
  type PlainData,
  type PopupToken,
  type SettingsAdapter,
  type SettingsField,
  type SettingsSchema,
  type SettingsValues,
  type WorkspaceHealth,
} from '@ss-helper/sdk';
import type { SessionScope } from '../plugins/session-scope.js';
import { SETTINGS_CSS } from '../styles/settings-styles.js';
import { assertPayload } from '../communication/contracts.js';
import {
  SETTINGS_CENTER_ID,
  SETTINGS_CENTER_OVERLAY_ID,
  SettingsCenterController,
} from './settings-center-controller.js';

export const SETTINGS_ROOT_ID = 'ss-helper-settings-root';
export { SETTINGS_CENTER_ID, SETTINGS_CENTER_OVERLAY_ID };

export interface SettingsPluginIdentity {
  readonly id: string;
  readonly displayName: string;
  readonly pluginVersion: string;
  readonly capabilities: readonly string[];
}

export interface SettingsContributionSnapshot extends SettingsPluginIdentity {
  readonly schema: SettingsSchema;
  readonly health: 'healthy' | 'degraded';
  readonly lastError?: string;
  readonly values: SettingsValues;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface Contribution {
  readonly identity: SettingsPluginIdentity;
  readonly schema: SettingsSchema;
  readonly adapter: SettingsAdapter;
  values: SettingsValues;
  committedValues: SettingsValues;
  health: 'healthy' | 'degraded';
  saveState: SaveState;
  saveRevision: number;
  saveQueue: Promise<void>;
  lastError?: string;
  unsubscribe?: () => void;
  readonly openPopup: (token: PopupToken, input: PlainData) => void;
}

interface DebouncedSave {
  readonly timer: ReturnType<typeof setTimeout>;
  readonly flush: () => void;
}

type WorkspaceHealthState =
  | { readonly state: 'idle' }
  | { readonly state: 'loading' }
  | { readonly state: 'healthy'; readonly value: WorkspaceHealth }
  | { readonly state: 'degraded'; readonly value?: WorkspaceHealth; readonly message?: string };

const OVERVIEW_ID = 'overview';
const SETTINGS_FIELD_KINDS = new Set([
  'section', 'toggle', 'checkbox', 'text', 'number', 'range', 'select', 'radio', 'multiSelect', 'action', 'status',
]);

function fields(schema: SettingsSchema): readonly SettingsField[] {
  const result: SettingsField[] = [];
  const visit = (field: SettingsField): void => {
    result.push(field);
    if (field.kind === 'section') field.children.forEach(visit);
  };
  schema.fields.forEach(visit);
  return result;
}

function actionFields(schema: SettingsSchema): readonly Extract<SettingsField, { kind: 'action' }>[] {
  return fields(schema).filter((field): field is Extract<SettingsField, { kind: 'action' }> => field.kind === 'action');
}

function validateOptions(field: Extract<SettingsField, { kind: 'select' | 'radio' | 'multiSelect' }>): void {
  if (field.options.length === 0 || new Set(field.options.map((option) => option.value)).size !== field.options.length) {
    throw new SSHelperError('PAYLOAD_INVALID', 'Settings options are invalid', { reason: 'settings_options' });
  }
}

function validateSchema(pluginId: string, schema: SettingsSchema): void {
  if (schema.id !== pluginId || schema.title.trim() === '') throw new SSHelperError('PAYLOAD_INVALID', 'The settings schema is invalid', { reason: 'schema_identity' });
  const ids = new Set<string>();
  for (const field of fields(schema)) {
    if (!SETTINGS_FIELD_KINDS.has(field.kind)) throw new SSHelperError('PAYLOAD_INVALID', 'The settings field kind is invalid', { reason: 'settings_schema_invalid' });
    if (!/^[a-z][A-Za-z0-9]*(?:[-.][A-Za-z0-9]+)*$/u.test(field.id) || ids.has(field.id) || field.label.trim() === '') {
      throw new SSHelperError('PAYLOAD_INVALID', 'The settings field is invalid', { reason: 'field_identity' });
    }
    ids.add(field.id);
    if (field.kind === 'select' || field.kind === 'radio' || field.kind === 'multiSelect') validateOptions(field);
    if (field.kind === 'range' && (field.min > field.max || (field.step ?? 1) <= 0)) {
      throw new SSHelperError('PAYLOAD_INVALID', 'Range field bounds are invalid', { reason: 'range_bounds' });
    }
    if (field.kind === 'number' && field.step !== undefined && field.step <= 0) {
      throw new SSHelperError('PAYLOAD_INVALID', 'Number field step is invalid', { reason: 'number_step' });
    }
  }
}

function validateValue(field: SettingsField, value: PlainData | undefined): string | undefined {
  if (field.kind === 'section' || field.kind === 'action' || field.kind === 'status') return undefined;
  const required = 'validation' in field && field.validation?.required === true;
  if (required && (value === undefined || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0))) {
    return field.validation?.message ?? '此项为必填项';
  }
  if (value === undefined) return undefined;
  if (field.kind === 'toggle' || field.kind === 'checkbox') return typeof value === 'boolean' ? undefined : '需要布尔值';
  if (field.kind === 'text') {
    if (typeof value !== 'string') return '请输入文本';
    if (field.validation?.min !== undefined && value.length < field.validation.min) return field.validation.message ?? `至少输入 ${field.validation.min} 个字符`;
    if (field.validation?.max !== undefined && value.length > field.validation.max) return field.validation.message ?? `最多输入 ${field.validation.max} 个字符`;
    if (field.validation?.pattern !== undefined) {
      try { if (!new RegExp(field.validation.pattern, 'u').test(value)) return field.validation.message ?? '输入格式不正确'; }
      catch { return '校验规则无效'; }
    }
    return undefined;
  }
  if (field.kind === 'select' || field.kind === 'radio') {
    return typeof value === 'string' && field.options.some((option) => option.value === value) ? undefined : '请选择有效选项';
  }
  if (field.kind === 'multiSelect') {
    return Array.isArray(value)
      && value.every((entry) => typeof entry === 'string' && field.options.some((option) => option.value === entry))
      && new Set(value).size === value.length
      ? undefined
      : '请选择有效选项';
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return '请输入有效数值';
  const min = field.kind === 'range' ? field.min : field.validation?.min;
  const max = field.kind === 'range' ? field.max : field.validation?.max;
  if (min !== undefined && value < min) return `数值不能小于 ${min}`;
  if (max !== undefined && value > max) return `数值不能大于 ${max}`;
  return undefined;
}

function validateValues(schema: SettingsSchema, values: SettingsValues, phase: string): SettingsValues {
  assertPayload(values, undefined, phase);
  for (const field of fields(schema)) {
    const message = validateValue(field, values[field.id]);
    if (message !== undefined) throw new SSHelperError('PAYLOAD_INVALID', message, { pluginId: schema.id, field: field.id });
  }
  return Object.freeze({ ...values });
}

function searchText(field: SettingsField): string {
  return `${field.id} ${field.label} ${field.description ?? ''}`.toLocaleLowerCase();
}

function domId(pluginId: string, suffix: string): string {
  return `ss-helper-${pluginId.replace(/[^A-Za-z0-9_-]/gu, '-')}-${suffix}`;
}

function icon(document: Document, name: string): HTMLElement {
  const node = document.createElement('i');
  node.className = `fa-solid ${name}`;
  node.setAttribute('aria-hidden', 'true');
  return node;
}

function setButtonLabel(document: Document, button: HTMLButtonElement, iconName: string, label: string): void {
  const text = document.createElement('span');
  text.textContent = label;
  button.append(icon(document, iconName), text);
}

export class SettingsHost {
  readonly #contributions = new Map<string, Contribution>();
  readonly #activeTabs = new Map<string, string>();
  readonly #searchQueries = new Map<string, string>();
  readonly #searchEmpty = new WeakMap<HTMLElement, HTMLElement>();
  readonly #debouncedSaves = new Map<string, DebouncedSave>();
  readonly #fieldErrors = new Map<string, Map<string, string>>();
  #root: HTMLElement | undefined;
  #center: SettingsCenterController | undefined;
  #activePluginId = OVERVIEW_ID;
  #workspaceHealth: WorkspaceHealthState = { state: 'idle' };

  constructor(readonly core: CoreDescriptor) {}

  mount(container: HTMLElement): HTMLElement {
    const document = container.ownerDocument;
    const existing = document.getElementById(SETTINGS_ROOT_ID);
    if (existing !== null) {
      if (existing.dataset.ssHelperOwner !== 'core') throw new SSHelperError('BRIDGE_CORRUPTED', 'The settings root is not owned by Core');
      this.#root = existing;
      this.#center ??= new SettingsCenterController(document);
      this.#renderRoot();
      return existing;
    }
    const root = document.createElement('section');
    root.id = SETTINGS_ROOT_ID;
    root.setAttribute('aria-label', 'SS-Helper 设置入口');
    root.dataset.ssHelperOwner = 'core';
    root.className = 'stx-settings-root';
    container.append(root);
    this.#root = root;
    this.#center = new SettingsCenterController(document);
    this.#renderRoot();
    return root;
  }

  register(scope: SessionScope, identity: SettingsPluginIdentity, schema: SettingsSchema, adapter: SettingsAdapter, openPopup: (token: PopupToken, input: PlainData) => void): () => void {
    scope.assertActive();
    validateSchema(identity.id, schema);
    if (this.#contributions.has(identity.id)) throw new SSHelperError('PAYLOAD_INVALID', 'The plugin already registered settings', { reason: 'duplicate_settings' });
    const empty = Object.freeze({});
    const contribution: Contribution = {
      identity, schema, adapter, openPopup, values: empty, committedValues: empty,
      health: 'healthy', saveState: 'idle', saveRevision: 0, saveQueue: Promise.resolve(),
    };
    this.#contributions.set(identity.id, contribution);
    void this.#load(contribution);
    if (adapter.subscribe !== undefined) {
      try {
        contribution.unsubscribe = adapter.subscribe((values) => {
          try {
            const validated = validateValues(contribution.schema, values, 'settings_subscribe');
            contribution.values = validated;
            contribution.committedValues = validated;
            contribution.health = 'healthy';
            this.#renderAll();
          } catch { this.#degrade(contribution); }
        });
      } catch { this.#degrade(contribution); }
    }
    this.#renderAll();
    return scope.addCleanup(() => {
      contribution.unsubscribe?.();
      this.#contributions.delete(identity.id);
      this.#activeTabs.delete(identity.id);
      this.#searchQueries.delete(identity.id);
      this.#fieldErrors.delete(identity.id);
      this.#cancelDebouncedSaves(identity.id);
      if (this.#activePluginId === identity.id) this.#activePluginId = OVERVIEW_ID;
      this.#renderAll();
    });
  }

  async #load(contribution: Contribution): Promise<void> {
    try {
      const values = validateValues(contribution.schema, await contribution.adapter.load(), 'settings_load');
      contribution.values = values;
      contribution.committedValues = values;
      contribution.health = 'healthy';
      contribution.saveState = 'idle';
      delete contribution.lastError;
      this.#renderAll();
    } catch { this.#degrade(contribution); }
  }

  #degrade(contribution: Contribution, rerender = true): void {
    contribution.health = 'degraded';
    contribution.saveState = 'error';
    contribution.lastError = 'SETTINGS_ADAPTER_ERROR';
    if (rerender) this.#renderAll();
    else this.#syncContributionUi(contribution);
  }

  async save(pluginId: string, values: SettingsValues): Promise<void> {
    const contribution = this.#contributions.get(pluginId);
    if (contribution === undefined) throw new SSHelperError('SETTINGS_ADAPTER_ERROR', 'Settings are not registered', { pluginId });
    const validatedValues = validateValues(contribution.schema, values, 'settings_save');
    const revision = ++contribution.saveRevision;
    contribution.values = validatedValues;
    contribution.saveState = 'saving';
    this.#syncContributionUi(contribution);
    const operation = contribution.saveQueue.catch(() => undefined).then(async () => {
      try {
        await contribution.adapter.save(validatedValues);
        contribution.committedValues = validatedValues;
        if (revision === contribution.saveRevision) {
          contribution.values = validatedValues;
          contribution.health = 'healthy';
          contribution.saveState = 'saved';
          delete contribution.lastError;
          this.#syncContributionUi(contribution);
        }
      } catch {
        if (revision === contribution.saveRevision) {
          contribution.values = contribution.committedValues;
          this.#degrade(contribution, false);
        }
        throw new SSHelperError('SETTINGS_ADAPTER_ERROR', '插件设置保存失败', { pluginId });
      }
    });
    contribution.saveQueue = operation.catch(() => undefined);
    return operation;
  }

  async reset(pluginId: string): Promise<SettingsValues> {
    const contribution = this.#contributions.get(pluginId);
    if (contribution === undefined) throw new SSHelperError('SETTINGS_ADAPTER_ERROR', 'Settings are not registered', { pluginId });
    try {
      const values = validateValues(contribution.schema, await contribution.adapter.reset(), 'settings_reset');
      contribution.values = values;
      contribution.committedValues = values;
      contribution.health = 'healthy';
      contribution.saveState = 'saved';
      delete contribution.lastError;
      this.#fieldErrors.delete(pluginId);
      this.#renderAll();
      return values;
    } catch {
      this.#degrade(contribution);
      throw new SSHelperError('SETTINGS_ADAPTER_ERROR', '插件设置恢复失败', { pluginId });
    }
  }

  snapshot(): readonly SettingsContributionSnapshot[] {
    return Object.freeze([...this.#contributions.values()].map((entry) => Object.freeze({
      ...entry.identity,
      schema: entry.schema,
      health: entry.health,
      ...(entry.lastError === undefined ? {} : { lastError: entry.lastError }),
      values: Object.freeze(Object.fromEntries(Object.entries(entry.values).map(([key, value]) => {
        const field = fields(entry.schema).find((candidate) => candidate.id === key);
        return [key, field?.kind === 'text' && field.secret === true ? '[REDACTED]' : value];
      }))),
    })));
  }

  dispose(): void {
    for (const pending of this.#debouncedSaves.values()) clearTimeout(pending.timer);
    this.#debouncedSaves.clear();
    this.#center?.dispose();
    this.#center = undefined;
    this.#root?.remove();
    this.#root = undefined;
  }

  #renderAll(): void {
    this.#renderRoot();
    this.#renderCenter();
  }

  #renderRoot(): void {
    const root = this.#root;
    if (root === undefined) return;
    const document = root.ownerDocument;
    root.replaceChildren();
    const style = document.createElement('style');
    style.dataset.ssHelperStyle = 'settings';
    style.textContent = SETTINGS_CSS;
    root.append(style);

    const heading = document.createElement('div');
    heading.className = 'stx-launcher-heading';
    const headingCopy = document.createElement('div');
    const title = document.createElement('h2'); title.className = 'stx-ui-title'; title.textContent = 'SS-Helper';
    const subtitle = document.createElement('small'); subtitle.className = 'stx-ui-subtitle'; subtitle.textContent = '统一设置与服务状态';
    headingCopy.append(title, subtitle);
    const running = document.createElement('span'); running.className = 'stx-ui-badge stx-ui-badge-success'; running.textContent = 'Core 运行中';
    heading.append(headingCopy, running);

    const launcher = document.createElement('section');
    launcher.className = 'stx-launcher-card';
    launcher.dataset.pluginId = this.core.id;
    launcher.dataset.health = 'healthy';
    const mark = document.createElement('div'); mark.className = 'stx-launcher-icon'; mark.append(icon(document, 'fa-puzzle-piece'));
    const copy = document.createElement('div'); copy.className = 'stx-launcher-copy';
    const name = document.createElement('strong'); name.textContent = 'SS-Helper 设置中心';
    const details = document.createElement('small');
    details.textContent = `SDK ${this.core.sdkPackageVersion} · API ${this.core.apiMajor}.${this.core.apiMinor} · ${this.#contributions.size} 个插件`;
    copy.append(name, details);
    const open = document.createElement('button');
    open.id = 'ss-helper-open-settings-center';
    open.type = 'button';
    open.className = 'stx-ui-btn stx-ui-btn-primary';
    setButtonLabel(document, open, 'fa-sliders', '打开设置中心');
    open.addEventListener('click', () => this.#openSettingsCenter());
    launcher.append(mark, copy, open);
    root.append(heading, launcher);
  }

  #openSettingsCenter(): void {
    const center = this.#center;
    if (center === undefined) return;
    center.show((dialog) => this.#renderCenterContent(dialog), () => this.#flushDebouncedSaves());
    void this.#refreshWorkspaceHealth();
  }

  #renderCenter(): void {
    if (this.#center?.open !== true) return;
    this.#center.render((dialog) => this.#renderCenterContent(dialog));
  }

  #renderCenterContent(dialog: HTMLElement): void {
    const document = dialog.ownerDocument;
    const header = document.createElement('header'); header.className = 'stx-center-header';
    const brand = document.createElement('div'); brand.className = 'stx-center-brand';
    const brandIcon = document.createElement('div'); brandIcon.className = 'stx-center-brand-icon'; brandIcon.append(icon(document, 'fa-puzzle-piece'));
    const brandCopy = document.createElement('div');
    const title = document.createElement('h2'); title.textContent = 'SS-Helper 设置中心';
    const subtitle = document.createElement('small'); subtitle.textContent = '管理插件、连接与通用服务';
    brandCopy.append(title, subtitle); brand.append(brandIcon, brandCopy);
    const close = document.createElement('button');
    close.type = 'button'; close.className = 'stx-center-close'; close.setAttribute('aria-label', '关闭设置中心'); close.append(icon(document, 'fa-xmark'));
    close.addEventListener('click', this.#center!.close);
    header.append(brand, close);

    const body = document.createElement('div'); body.className = 'stx-center-body';
    const sidebar = document.createElement('aside'); sidebar.className = 'stx-center-sidebar';
    const navLabel = document.createElement('small'); navLabel.className = 'stx-center-nav-label'; navLabel.textContent = '设置';
    const nav = document.createElement('nav'); nav.className = 'stx-center-nav'; nav.setAttribute('aria-label', 'SS-Helper 插件');
    nav.append(this.#renderNavButton(document, OVERVIEW_ID, '概览', 'fa-gauge-high', 'Core 与服务状态', 'healthy'));
    for (const contribution of this.#contributions.values()) {
      nav.append(this.#renderNavButton(document, contribution.identity.id, contribution.identity.displayName, 'fa-puzzle-piece', contribution.identity.pluginVersion, contribution.health));
    }
    const sidebarMeta = document.createElement('div'); sidebarMeta.className = 'stx-center-sidebar-meta';
    sidebarMeta.textContent = `Core ${this.core.coreVersion} · generation ${this.core.generation}`;
    sidebar.append(navLabel, nav, sidebarMeta);

    const main = document.createElement('main'); main.className = 'stx-center-main';
    if (this.#activePluginId === OVERVIEW_ID) this.#renderOverview(document, main);
    else {
      const contribution = this.#contributions.get(this.#activePluginId);
      if (contribution === undefined) { this.#activePluginId = OVERVIEW_ID; this.#renderOverview(document, main); }
      else this.#renderContribution(document, main, contribution);
    }
    body.append(sidebar, main);
    dialog.append(header, body);
  }

  #renderNavButton(document: Document, id: string, label: string, iconName: string, detail: string, health: 'healthy' | 'degraded'): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'stx-center-nav-item';
    button.dataset.pluginId = id;
    button.dataset.health = health;
    button.setAttribute('aria-current', id === this.#activePluginId ? 'page' : 'false');
    const itemIcon = document.createElement('span'); itemIcon.className = 'stx-center-nav-icon'; itemIcon.append(icon(document, iconName));
    const copy = document.createElement('span'); copy.className = 'stx-center-nav-copy';
    const name = document.createElement('strong'); name.textContent = label;
    const meta = document.createElement('small'); meta.textContent = detail;
    copy.append(name, meta);
    const dot = document.createElement('span'); dot.className = `stx-health-dot stx-health-dot-${health}`; dot.dataset.healthBadge = 'true'; dot.setAttribute('aria-label', health === 'healthy' ? '正常' : '需检查');
    button.append(itemIcon, copy, dot);
    button.addEventListener('click', () => { this.#activePluginId = id; this.#renderCenter(); });
    return button;
  }

  #renderOverview(document: Document, main: HTMLElement): void {
    const heading = document.createElement('div'); heading.className = 'stx-center-page-heading';
    const copy = document.createElement('div');
    const title = document.createElement('h3'); title.textContent = '概览';
    const subtitle = document.createElement('p'); subtitle.textContent = '检查 Core、SQLite workspace 与插件连接状态。';
    copy.append(title, subtitle);
    const badge = document.createElement('span'); badge.className = 'stx-ui-badge stx-ui-badge-success'; badge.textContent = 'Core 正常';
    heading.append(copy, badge);

    const content = document.createElement('div'); content.className = 'stx-center-scroll';
    const grid = document.createElement('div'); grid.className = 'stx-overview-grid';
    grid.append(
      this.#renderOverviewCard(document, 'Core Runtime', `v${this.core.coreVersion}`, `API ${this.core.apiMajor}.${this.core.apiMinor} · generation ${this.core.generation}`, 'fa-microchip', 'healthy'),
      this.#renderWorkspaceCard(document),
      this.#renderOverviewCard(document, '已注册插件', String(this.#contributions.size), '设置会自动出现在左侧菜单', 'fa-plug', this.#contributions.size > 0 ? 'healthy' : 'degraded'),
    );
    const list = document.createElement('section'); list.className = 'stx-overview-list';
    const listTitle = document.createElement('h4'); listTitle.textContent = '插件状态'; list.append(listTitle);
    if (this.#contributions.size === 0) {
      const empty = document.createElement('p'); empty.className = 'stx-center-empty'; empty.textContent = '暂无已注册设置的插件。'; list.append(empty);
    } else {
      for (const contribution of this.#contributions.values()) {
        const row = document.createElement('div'); row.className = 'stx-overview-plugin'; row.dataset.pluginId = contribution.identity.id; row.dataset.health = contribution.health;
        const name = document.createElement('strong'); name.textContent = contribution.identity.displayName;
        const version = document.createElement('span'); version.textContent = contribution.identity.pluginVersion;
        const health = document.createElement('span'); health.dataset.healthBadge = 'true'; health.className = `stx-ui-badge stx-ui-badge-${contribution.health === 'healthy' ? 'success' : 'warning'}`; health.textContent = contribution.health === 'healthy' ? '正常' : '需检查';
        row.append(name, version, health); list.append(row);
      }
    }
    content.append(grid, list); main.append(heading, content);
  }

  #renderOverviewCard(document: Document, label: string, value: string, detail: string, iconName: string, health: 'healthy' | 'degraded'): HTMLElement {
    const card = document.createElement('section'); card.className = 'stx-overview-card'; card.dataset.health = health;
    const top = document.createElement('div'); top.className = 'stx-overview-card-top';
    const iconNode = document.createElement('span'); iconNode.className = 'stx-overview-card-icon'; iconNode.append(icon(document, iconName));
    const badge = document.createElement('span'); badge.className = `stx-ui-badge stx-ui-badge-${health === 'healthy' ? 'success' : 'warning'}`; badge.textContent = health === 'healthy' ? '正常' : '等待';
    top.append(iconNode, badge);
    const title = document.createElement('small'); title.textContent = label;
    const metric = document.createElement('strong'); metric.textContent = value;
    const description = document.createElement('p'); description.textContent = detail;
    card.append(top, title, metric, description);
    return card;
  }

  #renderWorkspaceCard(document: Document): HTMLElement {
    const health = this.#workspaceHealth;
    if (health.state === 'idle' || health.state === 'loading') return this.#renderOverviewCard(document, 'SQLite Workspace', '检测中', '正在连接 SDK 通用存储服务', 'fa-database', 'degraded');
    if (health.state === 'degraded') return this.#renderOverviewCard(document, 'SQLite Workspace', '不可用', health.message ?? health.value?.error ?? '请检查 SDK 服务端插件', 'fa-database', 'degraded');
    return this.#renderOverviewCard(document, 'SQLite Workspace', '已连接', `Schema ${health.value?.schemaVersion ?? '-'} · ${health.value?.walMode ?? 'WAL'}`, 'fa-database', 'healthy');
  }

  async #refreshWorkspaceHealth(): Promise<void> {
    this.#workspaceHealth = { state: 'loading' };
    if (this.#activePluginId === OVERVIEW_ID) this.#renderCenter();
    try {
      const global = globalThis as typeof globalThis & {
        getRequestHeaders?: () => Record<string, string>;
        SillyTavern?: { getContext?: () => { getRequestHeaders?: () => Record<string, string> } };
      };
      const headers = {
        ...(global.SillyTavern?.getContext?.()?.getRequestHeaders?.() ?? global.getRequestHeaders?.() ?? {}),
        Accept: 'application/json',
        'X-SS-Helper-Plugin': this.core.id,
      };
      const response = await fetch('/api/plugins/ss-helper-sdk/v1/workspaces/health', { headers });
      const payload = await response.json() as Record<string, unknown>;
      if (!response.ok || payload.ok !== true) throw new Error(String(payload.error ?? 'WORKSPACE_UNAVAILABLE'));
      const value: WorkspaceHealth = {
        ready: payload.ready === true,
        database: String(payload.database ?? ''),
        schemaVersion: Number(payload.schemaVersion ?? 0),
        ...(typeof payload.sqliteVersion === 'string' ? { sqliteVersion: payload.sqliteVersion } : {}),
        ...(typeof payload.walMode === 'string' ? { walMode: payload.walMode } : {}),
        ...(typeof payload.error === 'string' ? { error: payload.error } : {}),
      };
      this.#workspaceHealth = value.ready
        ? { state: 'healthy', value }
        : { state: 'degraded', value, ...(value.error === undefined ? {} : { message: value.error }) };
    } catch (error) {
      this.#workspaceHealth = { state: 'degraded', message: error instanceof Error ? error.message : 'WORKSPACE_UNAVAILABLE' };
    }
    if (this.#activePluginId === OVERVIEW_ID) this.#renderCenter();
  }

  #renderContribution(document: Document, main: HTMLElement, contribution: Contribution): void {
    const { identity, schema } = contribution;
    main.dataset.pluginId = identity.id;
    main.dataset.health = contribution.health;
    const heading = document.createElement('div'); heading.className = 'stx-center-page-heading';
    const headingCopy = document.createElement('div');
    const title = document.createElement('h3'); title.textContent = identity.displayName;
    const subtitle = document.createElement('p'); subtitle.textContent = schema.title;
    headingCopy.append(title, subtitle);
    const badges = document.createElement('div'); badges.className = 'stx-center-page-badges';
    const version = document.createElement('span'); version.className = 'stx-ui-badge'; version.textContent = identity.pluginVersion;
    const health = document.createElement('span'); health.dataset.healthBadge = 'true'; health.className = `stx-ui-badge stx-ui-badge-${contribution.health === 'healthy' ? 'success' : 'warning'}`; health.textContent = contribution.health === 'healthy' ? '正常' : '需检查';
    badges.append(version, health); heading.append(headingCopy, badges);

    const searchBar = document.createElement('div'); searchBar.className = 'stx-center-searchbar';
    const searchIcon = icon(document, 'fa-magnifying-glass');
    const search = document.createElement('input');
    search.type = 'search'; search.className = 'stx-ui-search'; search.placeholder = '搜索当前插件设置…'; search.setAttribute('aria-label', `${identity.displayName} 设置搜索`); search.value = this.#searchQueries.get(identity.id) ?? '';
    searchBar.append(searchIcon, search);

    const content = document.createElement('div'); content.className = 'stx-center-scroll stx-center-plugin-content';
    const fieldContainer = document.createElement('div'); fieldContainer.className = 'stx-ui-fields';
    const empty = document.createElement('p'); empty.className = 'stx-ui-search-empty'; empty.dataset.searchEmpty = 'true'; empty.textContent = '没有匹配的设置项。'; empty.hidden = true;
    this.#searchEmpty.set(fieldContainer, empty);
    const topSections = schema.fields.length > 0 && schema.fields.every((field) => field.kind === 'section');
    if (topSections) this.#renderTabs(document, fieldContainer, contribution, schema.fields as readonly Extract<SettingsField, { kind: 'section' }>[]);
    else this.#renderFields(document, fieldContainer, fieldContainer, contribution, schema.fields);
    fieldContainer.append(empty); content.append(searchBar, fieldContainer);
    search.addEventListener('input', () => { this.#searchQueries.set(identity.id, search.value); this.#applySearch(fieldContainer, search.value); });
    this.#applySearch(fieldContainer, search.value);

    const footer = document.createElement('footer'); footer.className = 'stx-center-footer';
    const status = document.createElement('div'); status.className = `stx-save-state stx-save-state-${contribution.saveState}`; status.dataset.saveStatus = identity.id;
    status.append(icon(document, contribution.saveState === 'error' ? 'fa-circle-exclamation' : contribution.saveState === 'saving' ? 'fa-rotate' : 'fa-circle-check'));
    const statusText = document.createElement('span'); statusText.textContent = this.#saveStateText(contribution); status.append(statusText);
    const actions = document.createElement('div'); actions.className = 'stx-center-footer-actions';
    for (const field of actionFields(schema)) {
      const action = document.createElement('button'); action.type = 'button'; action.className = `stx-ui-btn stx-ui-btn-${field.tone ?? 'neutral'}`; action.disabled = field.disabledReason !== undefined; action.textContent = field.label;
      if (field.popup !== undefined) action.addEventListener('click', () => contribution.openPopup(field.popup!, { actionId: field.actionId }));
      actions.append(action);
    }
    const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'stx-ui-btn stx-ui-btn-neutral'; setButtonLabel(document, reset, 'fa-arrow-rotate-left', '恢复默认');
    reset.addEventListener('click', () => void this.#resetWithConfirmation(contribution));
    actions.append(reset); footer.append(status, actions);
    main.append(heading, content, footer);
  }

  #renderTabs(document: Document, parent: HTMLElement, contribution: Contribution, sections: readonly Extract<SettingsField, { kind: 'section' }>[]): void {
    const tabs = document.createElement('div'); tabs.className = 'stx-ui-tabs'; tabs.setAttribute('role', 'tablist');
    const panels = document.createElement('div'); panels.className = 'stx-ui-panels';
    const activeId = sections.some((section) => section.id === this.#activeTabs.get(contribution.identity.id)) ? this.#activeTabs.get(contribution.identity.id)! : sections[0]?.id ?? '';
    this.#activeTabs.set(contribution.identity.id, activeId);
    const buttons: HTMLButtonElement[] = [];
    const panelNodes: HTMLElement[] = [];
    const activate = (index: number, focus = false): void => {
      const section = sections[index]; if (section === undefined) return;
      this.#activeTabs.set(contribution.identity.id, section.id);
      buttons.forEach((button, buttonIndex) => { const active = buttonIndex === index; button.setAttribute('aria-selected', String(active)); button.dataset.active = String(active); button.tabIndex = active ? 0 : -1; panelNodes[buttonIndex]!.hidden = !active; });
      if (focus) buttons[index]?.focus();
    };
    sections.forEach((section, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'stx-ui-tab'; button.dataset.tabId = section.id; button.setAttribute('role', 'tab'); button.textContent = section.label;
      const panel = document.createElement('div'); panel.className = 'stx-ui-panel'; panel.dataset.tabPanel = section.id; panel.setAttribute('role', 'tabpanel');
      this.#renderFields(document, panel, parent, contribution, section.children);
      button.addEventListener('click', () => activate(index));
      button.addEventListener('keydown', (event: KeyboardEvent) => {
        let next = index;
        if (event.key === 'ArrowRight') next = (index + 1) % sections.length;
        else if (event.key === 'ArrowLeft') next = (index - 1 + sections.length) % sections.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = sections.length - 1;
        else return;
        event.preventDefault(); activate(next, true);
      });
      buttons.push(button); panelNodes.push(panel); tabs.append(button); panels.append(panel);
    });
    activate(Math.max(0, sections.findIndex((section) => section.id === activeId)));
    parent.append(tabs, panels);
  }

  #renderFields(document: Document, parent: HTMLElement, searchRoot: HTMLElement, contribution: Contribution, entries: readonly SettingsField[]): void {
    for (const field of entries) {
      if (field.kind === 'action') continue;
      if (field.kind === 'section') {
        const group = document.createElement('fieldset'); group.className = 'stx-ui-fieldset';
        const legend = document.createElement('legend'); legend.textContent = field.label; group.append(legend);
        this.#renderFields(document, group, searchRoot, contribution, field.children); parent.append(group); continue;
      }
      const row = document.createElement('div'); row.className = `stx-ui-field-row stx-ui-field-${field.kind}`; row.dataset.fieldId = field.id; row.dataset.fieldKind = field.kind; row.dataset.searchText = searchText(field);
      const labelCell = document.createElement('div'); labelCell.className = 'stx-ui-field-label';
      const label = document.createElement('label'); label.className = 'stx-ui-item-title'; label.textContent = field.label; labelCell.append(label);
      const valueCell = document.createElement('div'); valueCell.className = 'stx-ui-field-value';
      const control = document.createElement('div'); control.className = `stx-ui-control stx-ui-control-${field.kind}`;
      const descriptionId = domId(contribution.identity.id, `${field.id}-description`);
      const errorId = domId(contribution.identity.id, `${field.id}-error`);
      const description = document.createElement('small'); description.id = descriptionId; description.className = 'stx-ui-item-desc'; description.textContent = field.disabledReason ?? field.description ?? '';
      const error = document.createElement('small'); error.id = errorId; error.className = 'stx-ui-field-error'; error.setAttribute('role', 'alert');
      const existingError = this.#fieldErrors.get(contribution.identity.id)?.get(field.id);
      error.textContent = existingError ?? ''; error.hidden = existingError === undefined;
      if (existingError !== undefined) row.dataset.validationError = existingError;

      if (field.kind === 'status') {
        row.setAttribute('role', 'status');
        const badge = document.createElement('span'); badge.className = `stx-ui-badge stx-ui-badge-${field.tone ?? 'neutral'}`; badge.textContent = field.value; control.append(badge);
      } else if (field.kind === 'toggle' || field.kind === 'checkbox') {
        const input = document.createElement('input'); input.id = domId(contribution.identity.id, field.id); input.type = 'checkbox'; input.checked = Boolean(this.#fieldValue(contribution, field)); this.#configureInput(input, label, field, descriptionId, errorId, existingError !== undefined);
        if (field.kind === 'toggle') {
          const toggle = document.createElement('label'); toggle.className = 'stx-ui-toggle'; toggle.setAttribute('for', input.id);
          const track = document.createElement('span'); track.className = 'stx-ui-toggle-track'; toggle.append(input, track); control.append(toggle);
        } else { input.className = 'stx-ui-checkbox'; control.append(input); }
        input.addEventListener('change', () => this.#commitField(contribution, field, input.checked));
      } else if (field.kind === 'radio') {
        control.setAttribute('role', 'radiogroup'); control.setAttribute('aria-label', field.aria?.label ?? field.label);
        const current = this.#fieldValue(contribution, field);
        for (const option of field.options) {
          const optionLabel = document.createElement('label'); optionLabel.className = 'stx-ui-radio-option';
          const input = document.createElement('input'); input.type = 'radio'; input.name = domId(contribution.identity.id, field.id); input.value = option.value; input.checked = current === option.value; input.disabled = field.disabledReason !== undefined;
          const text = document.createElement('span'); text.textContent = option.label; optionLabel.append(input, text); control.append(optionLabel);
          input.addEventListener('change', () => { if (input.checked) this.#commitField(contribution, field, option.value); });
        }
      } else if (field.kind === 'multiSelect') {
        const selected = Array.isArray(this.#fieldValue(contribution, field)) ? [...this.#fieldValue(contribution, field) as readonly PlainData[]].map(String) : [];
        const wrap = document.createElement('div'); wrap.className = 'stx-ui-multiselect';
        const chips = document.createElement('div'); chips.className = 'stx-ui-chips';
        for (const selectedValue of selected) {
          const option = field.options.find((candidate) => candidate.value === selectedValue); if (option === undefined) continue;
          const chip = document.createElement('span'); chip.className = 'stx-ui-chip';
          const text = document.createElement('span'); text.textContent = option.label;
          const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'stx-ui-chip-remove'; remove.setAttribute('aria-label', `移除 ${option.label}`); remove.append(icon(document, 'fa-xmark'));
          remove.addEventListener('click', () => this.#commitField(contribution, field, Object.freeze(selected.filter((value) => value !== selectedValue))));
          chip.append(text, remove); chips.append(chip);
        }
        const select = document.createElement('select'); select.id = domId(contribution.identity.id, field.id); select.className = 'stx-ui-select'; this.#configureInput(select, label, field, descriptionId, errorId, existingError !== undefined);
        const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = field.placeholder ?? '添加选项…'; select.append(placeholder);
        for (const option of field.options.filter((candidate) => !selected.includes(candidate.value))) { const node = document.createElement('option'); node.value = option.value; node.textContent = option.label; select.append(node); }
        select.addEventListener('change', () => { if (select.value !== '') this.#commitField(contribution, field, Object.freeze([...selected, select.value])); });
        wrap.append(chips, select); control.append(wrap);
      } else if (field.kind === 'select') {
        const select = document.createElement('select'); select.id = domId(contribution.identity.id, field.id); select.className = 'stx-ui-select'; this.#configureInput(select, label, field, descriptionId, errorId, existingError !== undefined);
        for (const option of field.options) { const node = document.createElement('option'); node.value = option.value; node.textContent = option.label; select.append(node); }
        const value = this.#fieldValue(contribution, field); if (typeof value === 'string') select.value = value;
        select.addEventListener('change', () => this.#commitField(contribution, field, select.value)); control.append(select);
      } else if (field.kind === 'number') {
        const stepper = document.createElement('div'); stepper.className = 'stx-ui-number-stepper';
        const input = document.createElement('input'); input.id = domId(contribution.identity.id, field.id); input.className = 'stx-ui-input'; input.type = 'number';
        const value = this.#fieldValue(contribution, field); if (typeof value === 'number') input.value = String(value);
        if (field.validation?.min !== undefined) input.min = String(field.validation.min); if (field.validation?.max !== undefined) input.max = String(field.validation.max); input.step = String(field.step ?? 1);
        this.#configureInput(input, label, field, descriptionId, errorId, existingError !== undefined);
        const flush = (): void => this.#scheduleFieldSave(contribution, field, () => input.value.trim() === '' ? Number.NaN : Number(input.value));
        input.addEventListener('input', flush); input.addEventListener('blur', () => this.#flushDebouncedSave(contribution.identity.id, field.id)); input.addEventListener('keydown', (event: KeyboardEvent) => { if (event.key === 'Enter') this.#flushDebouncedSave(contribution.identity.id, field.id); });
        if (field.showStepper !== false) {
          const minus = this.#stepButton(document, 'fa-minus', `减少${field.label}`); const plus = this.#stepButton(document, 'fa-plus', `增加${field.label}`);
          minus.addEventListener('click', () => this.#stepNumber(contribution, field, input, -1)); plus.addEventListener('click', () => this.#stepNumber(contribution, field, input, 1)); stepper.append(minus, input, plus);
        } else stepper.append(input);
        if (field.unit !== undefined) { const unit = document.createElement('span'); unit.className = 'stx-ui-unit'; unit.textContent = field.unit; stepper.append(unit); }
        control.append(stepper);
      } else if (field.kind === 'range') {
        const input = document.createElement('input'); input.id = domId(contribution.identity.id, field.id); input.className = 'stx-ui-input'; input.type = 'range'; input.min = String(field.min); input.max = String(field.max); input.step = String(field.step ?? 1);
        const value = this.#fieldValue(contribution, field); if (typeof value === 'number') input.value = String(value); this.#configureInput(input, label, field, descriptionId, errorId, existingError !== undefined);
        const output = document.createElement('output'); output.className = 'stx-ui-range-output'; output.textContent = input.value; output.setAttribute('for', input.id);
        input.addEventListener('input', () => { output.textContent = input.value; }); input.addEventListener('change', () => this.#commitField(contribution, field, Number(input.value)));
        control.append(input, output);
      } else {
        const input = document.createElement('input'); input.id = domId(contribution.identity.id, field.id); input.className = 'stx-ui-input'; input.type = field.secret === true ? 'password' : 'text'; input.placeholder = field.placeholder ?? '';
        const value = this.#fieldValue(contribution, field); if (typeof value === 'string') input.value = value; this.#configureInput(input, label, field, descriptionId, errorId, existingError !== undefined);
        input.addEventListener('input', () => this.#scheduleFieldSave(contribution, field, () => input.value)); input.addEventListener('blur', () => this.#flushDebouncedSave(contribution.identity.id, field.id)); input.addEventListener('keydown', (event: KeyboardEvent) => { if (event.key === 'Enter') this.#flushDebouncedSave(contribution.identity.id, field.id); });
        control.append(input);
      }
      valueCell.append(control);
      if (description.textContent !== '') valueCell.append(description);
      valueCell.append(error); row.append(labelCell, valueCell); parent.append(row);
    }
  }

  #configureInput(input: HTMLInputElement | HTMLSelectElement, label: HTMLLabelElement, field: Exclude<SettingsField, { kind: 'section' | 'action' | 'status' }>, descriptionId: string, errorId: string, invalid: boolean): void {
    label.setAttribute('for', input.id);
    input.setAttribute('aria-label', field.aria?.label ?? field.label);
    input.setAttribute('aria-describedby', `${descriptionId} ${errorId}`);
    input.disabled = field.disabledReason !== undefined;
    if (input.disabled) input.setAttribute('aria-disabled', 'true');
    if (invalid) input.setAttribute('aria-invalid', 'true');
  }

  #fieldValue(contribution: Contribution, field: Exclude<SettingsField, { kind: 'section' | 'action' }>): PlainData | undefined {
    return contribution.values[field.id] ?? ('defaultValue' in field ? field.defaultValue : undefined);
  }

  #stepButton(document: Document, iconName: string, ariaLabel: string): HTMLButtonElement {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'stx-ui-step-button'; button.setAttribute('aria-label', ariaLabel); button.append(icon(document, iconName)); return button;
  }

  #stepNumber(contribution: Contribution, field: Extract<SettingsField, { kind: 'number' }>, input: HTMLInputElement, direction: -1 | 1): void {
    this.#flushDebouncedSave(contribution.identity.id, field.id, false);
    const step = field.step ?? 1;
    const current = Number.isFinite(Number(input.value)) ? Number(input.value) : Number(this.#fieldValue(contribution, field) ?? 0);
    const min = field.validation?.min ?? Number.NEGATIVE_INFINITY; const max = field.validation?.max ?? Number.POSITIVE_INFINITY;
    const next = Math.min(max, Math.max(min, current + (step * direction)));
    input.value = String(next); this.#commitField(contribution, field, next);
  }

  #scheduleFieldSave(contribution: Contribution, field: SettingsField, read: () => PlainData): void {
    const key = `${contribution.identity.id}:${field.id}`;
    const existing = this.#debouncedSaves.get(key); if (existing !== undefined) clearTimeout(existing.timer);
    const flush = (): void => { const pending = this.#debouncedSaves.get(key); if (pending !== undefined) clearTimeout(pending.timer); this.#debouncedSaves.delete(key); this.#commitField(contribution, field, read()); };
    const timer = setTimeout(flush, 450);
    this.#debouncedSaves.set(key, { timer, flush });
  }

  #flushDebouncedSave(pluginId: string, fieldId: string, commit = true): void {
    const key = `${pluginId}:${fieldId}`; const pending = this.#debouncedSaves.get(key); if (pending === undefined) return;
    clearTimeout(pending.timer); this.#debouncedSaves.delete(key); if (commit) pending.flush();
  }

  #flushDebouncedSaves(): void { for (const pending of [...this.#debouncedSaves.values()]) pending.flush(); }

  #cancelDebouncedSaves(pluginId: string): void {
    for (const [key, pending] of this.#debouncedSaves) if (key.startsWith(`${pluginId}:`)) { clearTimeout(pending.timer); this.#debouncedSaves.delete(key); }
  }

  #commitField(contribution: Contribution, field: SettingsField, value: PlainData): void {
    const values = Object.freeze({ ...contribution.values, [field.id]: value });
    void this.save(contribution.identity.id, values).then(() => {
      this.#fieldErrors.get(contribution.identity.id)?.delete(field.id);
      this.#syncContributionUi(contribution);
    }, (error: unknown) => {
      const message = error instanceof Error ? error.message : '设置值无效';
      const errors = this.#fieldErrors.get(contribution.identity.id) ?? new Map<string, string>(); errors.set(field.id, message); this.#fieldErrors.set(contribution.identity.id, errors);
      this.#renderCenter();
    });
  }

  async #resetWithConfirmation(contribution: Contribution): Promise<void> {
    const confirm = this.#root?.ownerDocument.defaultView?.confirm(`恢复 ${contribution.identity.displayName} 的默认设置？`) ?? true;
    if (!confirm) return;
    try { await this.reset(contribution.identity.id); }
    catch { this.#renderCenter(); }
  }

  #applySearch(root: HTMLElement, query: string): void {
    const normalized = query.trim().toLocaleLowerCase(); let visible = 0;
    for (const node of Array.from(root.querySelectorAll<HTMLElement>('[data-field-id]'))) {
      if (!node.dataset.fieldId || !node.dataset.searchText) continue;
      const matches = normalized === '' || node.dataset.searchText.includes(normalized); node.hidden = !matches; if (matches) visible += 1;
    }
    const empty = this.#searchEmpty.get(root); if (empty !== undefined) empty.hidden = normalized === '' || visible > 0;
  }

  #saveStateText(contribution: Contribution): string {
    if (contribution.saveState === 'saving') return '正在自动保存…';
    if (contribution.saveState === 'saved') return '设置已自动保存';
    if (contribution.saveState === 'error') return '保存失败，请检查设置';
    return '修改后自动保存';
  }

  #syncContributionUi(contribution: Contribution): void {
    const document = this.#root?.ownerDocument; if (document === undefined) return;
    for (const node of Array.from(document.querySelectorAll<HTMLElement>('[data-plugin-id]'))) {
      if (node.dataset.pluginId !== contribution.identity.id) continue;
      node.dataset.health = contribution.health;
      for (const badge of Array.from(node.querySelectorAll<HTMLElement>('[data-health-badge]'))) {
        if (badge.classList.contains('stx-health-dot')) badge.className = `stx-health-dot stx-health-dot-${contribution.health}`;
        else { badge.className = `stx-ui-badge stx-ui-badge-${contribution.health === 'healthy' ? 'success' : 'warning'}`; badge.textContent = contribution.health === 'healthy' ? '正常' : '需检查'; }
      }
    }
    for (const state of Array.from(document.querySelectorAll<HTMLElement>('[data-save-status]'))) {
      if (state.dataset.saveStatus !== contribution.identity.id) continue;
      state.className = `stx-save-state stx-save-state-${contribution.saveState}`;
      const text = state.querySelector('span:last-child'); if (text !== null) text.textContent = this.#saveStateText(contribution);
    }
  }
}
