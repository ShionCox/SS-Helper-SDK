import {
  SSHelperError,
  type ChatIndicatorRegistration,
  type ChatIndicatorResolution,
  type ChatIndicatorState,
  type ChatIndicatorTarget,
} from '@ss-helper/sdk';
import type { DiagnosticsStore } from '../diagnostics/diagnostics-store.js';
import type { SessionScope } from '../plugins/session-scope.js';
import type { TavernHostAdapter } from '../host/tavern-host-port.js';
import { ensureCoreUiStyles } from '../styles/settings-styles.js';
import { createIconElement } from '../ui/icon-element.js';

const RECENT_CHAT_SELECTOR = '.recentChat[data-file]';
const RECENT_LIST_SELECTOR = '.recentChatList';
const INDICATOR_GROUP_SELECTOR = '[data-ss-helper-chat-indicators="true"]';
const INDICATOR_SELECTOR = '[data-ss-helper-chat-indicator-plugin]';
const REFRESH_DELAY_MS = 60;
const MAX_HOST_KEY_LENGTH = 512;
const MAX_LABEL_LENGTH = 40;
const MAX_ICON_LENGTH = 48;
const PLUGIN_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const ICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

interface IndicatorEntry {
  readonly scope: SessionScope;
  readonly registration: Readonly<ChatIndicatorRegistration>;
  readonly cache: Map<string, ChatIndicatorResolution>;
  unsubscribe: () => void;
}

interface TargetRow {
  readonly row: HTMLElement;
  readonly target: ChatIndicatorTarget;
}

interface RenderableIndicator {
  readonly pluginId: string;
  readonly label: string;
  readonly icon: string;
  readonly state: Exclude<ChatIndicatorState, 'hidden'>;
  readonly kind: 'direct' | 'dependency';
  readonly order: number;
  readonly title: string;
}

function safeHostKey(value: string | undefined): string {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0
    && normalized.length <= MAX_HOST_KEY_LENGTH
    && !/[\u0000-\u001f\u007f]/u.test(normalized)
    ? normalized
    : '';
}

export function chatIndicatorTargetFromRow(row: HTMLElement): ChatIndicatorTarget | undefined {
  const chatKey = safeHostKey(row.dataset.file);
  const groupId = safeHostKey(row.dataset.group);
  const characterId = safeHostKey(row.dataset.avatar);
  if (!chatKey || (!groupId && !characterId)) return undefined;
  const workspaceId = groupId ? `group:${groupId}` : `character:${characterId}`;
  return Object.freeze({
    key: JSON.stringify([workspaceId, chatKey]),
    workspaceId,
    chatKey,
    ...(groupId ? { groupId } : { characterId }),
  });
}

function normalizeRegistration(registration: ChatIndicatorRegistration): Readonly<ChatIndicatorRegistration> {
  if (typeof registration !== 'object' || registration === null) {
    throw new SSHelperError('PAYLOAD_INVALID', 'The chat indicator registration is invalid', { reason: 'chat_indicator.registration' });
  }
  const label = typeof registration.label === 'string' ? registration.label.trim() : '';
  const icon = typeof registration.icon === 'string' ? registration.icon.trim() : '';
  const order = registration.order ?? 100;
  if (!label || label.length > MAX_LABEL_LENGTH || /[\u0000-\u001f\u007f]/u.test(label)) {
    throw new SSHelperError('PAYLOAD_INVALID', 'The chat indicator label is invalid', { reason: 'chat_indicator.label' });
  }
  if (!ICON_NAME.test(icon) || icon.length > MAX_ICON_LENGTH) {
    throw new SSHelperError('PAYLOAD_INVALID', 'The chat indicator icon is invalid', { reason: 'chat_indicator.icon' });
  }
  if (registration.kind !== undefined && registration.kind !== 'direct' && registration.kind !== 'dependency') {
    throw new SSHelperError('PAYLOAD_INVALID', 'The chat indicator kind is invalid', { reason: 'chat_indicator.kind' });
  }
  if (!Number.isSafeInteger(order) || order < -1_000 || order > 1_000 || typeof registration.resolve !== 'function'
    || (registration.subscribe !== undefined && typeof registration.subscribe !== 'function')) {
    throw new SSHelperError('PAYLOAD_INVALID', 'The chat indicator registration is invalid', { reason: 'chat_indicator.registration' });
  }
  return Object.freeze({
    label,
    icon,
    kind: registration.kind ?? 'direct',
    order,
    resolve: registration.resolve,
    ...(registration.subscribe === undefined ? {} : { subscribe: registration.subscribe }),
  });
}

function nodeElement(node: Node): Element | undefined {
  return node !== null && typeof node === 'object' && 'tagName' in node ? node as unknown as Element : undefined;
}

function nodeContainsRecentChat(node: Node): boolean {
  const element = nodeElement(node);
  if (!element) return false;
  return element.matches?.(`${RECENT_LIST_SELECTOR}, ${RECENT_CHAT_SELECTOR}`) === true
    || element.querySelector?.(`${RECENT_LIST_SELECTOR}, ${RECENT_CHAT_SELECTOR}`) !== null;
}

function isRelevantMutation(mutation: MutationRecord): boolean {
  return [...mutation.addedNodes, ...mutation.removedNodes].some(nodeContainsRecentChat);
}

function enabledTitle(label: string): string { return `该聊天已启用${label}插件`; }
function retainedTitle(label: string): string { return `该聊天已有${label}数据，但${label}插件已关闭`; }

export class ChatIndicatorHost {
  readonly #entries = new Map<string, IndicatorEntry>();
  readonly #document: Document | undefined;
  readonly #diagnostics: DiagnosticsStore;
  #observer: MutationObserver | undefined;
  #hostEventCleanup: () => void = () => undefined;
  #refreshTimer: ReturnType<typeof setTimeout> | undefined;
  #refreshRevision = 0;
  #forceRefresh = false;
  #disposed = false;

  constructor(document: Document | undefined, hostAdapter: TavernHostAdapter, diagnostics: DiagnosticsStore) {
    this.#document = document;
    this.#diagnostics = diagnostics;
    if (document !== undefined) {
      ensureCoreUiStyles(document);
      const Observer = document.defaultView?.MutationObserver
        ?? (typeof MutationObserver === 'undefined' ? undefined : MutationObserver);
      const root = document.body ?? document.documentElement;
      if (Observer !== undefined && root !== null) {
        this.#observer = new Observer((mutations) => {
          if (!mutations.some(isRelevantMutation)) return;
          this.scheduleRefresh(true);
        });
        this.#observer.observe(root, { childList: true, subtree: true });
      }
    }
    try {
      this.#hostEventCleanup = hostAdapter.events?.subscribe('chat-changed', () => this.scheduleRefresh(true)) ?? (() => undefined);
    } catch {
      this.#hostEventCleanup = () => undefined;
    }
  }

  register(scope: SessionScope, registration: ChatIndicatorRegistration): () => void {
    scope.assertActive();
    if (this.#disposed) throw new SSHelperError('CORE_DISPOSED', 'Core is disposed');
    if (this.#entries.has(scope.id)) {
      throw new SSHelperError('PAYLOAD_INVALID', 'A plugin may register only one chat indicator', { pluginId: scope.id, reason: 'chat_indicator.duplicate' });
    }
    const normalized = normalizeRegistration(registration);
    const entry: IndicatorEntry = { scope, registration: normalized, cache: new Map(), unsubscribe: () => undefined };
    this.#entries.set(scope.id, entry);
    if (normalized.subscribe !== undefined) {
      try {
        const unsubscribe = normalized.subscribe((targetKeys) => {
          if (this.#disposed || this.#entries.get(scope.id) !== entry) return;
          if (targetKeys === undefined) entry.cache.clear();
          else for (const targetKey of targetKeys) if (typeof targetKey === 'string') entry.cache.delete(targetKey);
          this.scheduleRefresh();
        });
        if (typeof unsubscribe === 'function') entry.unsubscribe = unsubscribe;
      } catch {
        this.#diagnostics.record({ type: 'chat-indicator.subscribe.failed', pluginId: scope.id, code: 'CHAT_INDICATOR_SUBSCRIBE_FAILED' });
      }
    }
    this.scheduleRefresh();
    return scope.addCleanup(() => {
      if (this.#entries.get(scope.id) !== entry) return;
      this.#entries.delete(scope.id);
      try { entry.unsubscribe(); } catch { /* plugin cleanup is isolated */ }
      entry.cache.clear();
      this.scheduleRefresh();
    });
  }

  scheduleRefresh(force = false): void {
    if (this.#disposed || this.#document === undefined) return;
    this.#forceRefresh ||= force;
    if (this.#refreshTimer !== undefined) clearTimeout(this.#refreshTimer);
    this.#refreshTimer = setTimeout(() => {
      this.#refreshTimer = undefined;
      const shouldForce = this.#forceRefresh;
      this.#forceRefresh = false;
      void this.refresh(shouldForce);
    }, REFRESH_DELAY_MS);
  }

  async refresh(force = false): Promise<void> {
    if (this.#disposed || this.#document === undefined) return;
    const revision = ++this.#refreshRevision;
    if (force) for (const entry of this.#entries.values()) entry.cache.clear();
    const rows = Array.from(this.#document.querySelectorAll<HTMLElement>(RECENT_CHAT_SELECTOR))
      .map((row): TargetRow | undefined => {
        const target = chatIndicatorTargetFromRow(row);
        return target === undefined ? undefined : { row, target };
      })
      .filter((value): value is TargetRow => value !== undefined);
    const targets = [...new Map(rows.map(({ target }) => [target.key, target])).values()];
    const directEntries = [...this.#entries.entries()].filter(([, entry]) => entry.registration.kind !== 'dependency');
    await Promise.all(directEntries.map(([pluginId, entry]) => this.#resolveEntry(pluginId, entry, targets)));
    if (this.#disposed || revision !== this.#refreshRevision) return;

    const dependencySources = new Map<string, Map<string, Set<string>>>();
    for (const [, entry] of directEntries) {
      for (const target of targets) {
        const result = entry.cache.get(target.key);
        if (result?.state !== 'enabled') continue;
        for (const dependency of result.activeDependencies ?? []) {
          let byPlugin = dependencySources.get(target.key);
          if (byPlugin === undefined) { byPlugin = new Map(); dependencySources.set(target.key, byPlugin); }
          let sources = byPlugin.get(dependency);
          if (sources === undefined) { sources = new Set(); byPlugin.set(dependency, sources); }
          sources.add(entry.registration.label);
        }
      }
    }
    const dependencyEntries = [...this.#entries.entries()].filter(([pluginId, entry]) => {
      if (entry.registration.kind !== 'dependency') return false;
      return [...dependencySources.values()].some((dependencies) => dependencies.has(pluginId));
    });
    await Promise.all(dependencyEntries.map(([pluginId, entry]) => {
      const requested = targets.filter((target) => dependencySources.get(target.key)?.has(pluginId));
      return this.#resolveEntry(pluginId, entry, requested);
    }));
    if (this.#disposed || revision !== this.#refreshRevision) return;

    for (const { row, target } of rows) {
      const indicators: RenderableIndicator[] = [];
      for (const [pluginId, entry] of directEntries) {
        const result = entry.cache.get(target.key);
        if (result === undefined || result.state === 'hidden') continue;
        indicators.push({
          pluginId,
          label: entry.registration.label,
          icon: entry.registration.icon,
          state: result.state,
          kind: 'direct',
          order: entry.registration.order ?? 100,
          title: result.state === 'retained' ? retainedTitle(entry.registration.label) : enabledTitle(entry.registration.label),
        });
      }
      const requestedDependencies = dependencySources.get(target.key);
      if (requestedDependencies !== undefined) {
        for (const [pluginId, sources] of requestedDependencies) {
          const entry = this.#entries.get(pluginId);
          const result = entry?.cache.get(target.key);
          if (entry?.registration.kind !== 'dependency' || result?.state !== 'enabled') continue;
          const sourceLabels = [...sources].sort((left, right) => left.localeCompare(right, 'zh-CN'));
          indicators.push({
            pluginId,
            label: entry.registration.label,
            icon: entry.registration.icon,
            state: 'enabled',
            kind: 'dependency',
            order: entry.registration.order ?? 100,
            title: `该聊天已启用 ${entry.registration.label} 插件（由${sourceLabels.map((label) => `${label}插件`).join('、')}使用）`,
          });
        }
      }
      indicators.sort((left, right) => (left.kind === right.kind ? left.order - right.order || left.pluginId.localeCompare(right.pluginId) : left.kind === 'direct' ? -1 : 1));
      this.#syncRow(row, indicators);
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#refreshRevision += 1;
    if (this.#refreshTimer !== undefined) clearTimeout(this.#refreshTimer);
    this.#refreshTimer = undefined;
    this.#observer?.disconnect();
    this.#observer = undefined;
    this.#hostEventCleanup();
    this.#hostEventCleanup = () => undefined;
    for (const entry of this.#entries.values()) {
      try { entry.unsubscribe(); } catch { /* plugin cleanup is isolated */ }
      entry.cache.clear();
    }
    this.#entries.clear();
    this.#document?.querySelectorAll<HTMLElement>(INDICATOR_GROUP_SELECTOR).forEach((group) => group.remove());
  }

  async #resolveEntry(pluginId: string, entry: IndicatorEntry, targets: readonly ChatIndicatorTarget[]): Promise<void> {
    const missing = targets.filter((target) => !entry.cache.has(target.key));
    if (!missing.length) return;
    const targetKeys = new Set(missing.map((target) => target.key));
    try {
      entry.scope.assertActive();
      const input = Object.freeze(missing.map((target) => Object.freeze({ ...target })));
      const resolved = await entry.registration.resolve(input);
      if (!Array.isArray(resolved)) throw new Error('chat indicator result is not an array');
      const normalized = new Map<string, ChatIndicatorResolution>();
      for (const candidate of resolved) {
        if (typeof candidate !== 'object' || candidate === null || !targetKeys.has(candidate.targetKey)
          || (candidate.state !== 'hidden' && candidate.state !== 'enabled' && candidate.state !== 'retained')
          || normalized.has(candidate.targetKey)) {
          throw new Error('chat indicator result is invalid');
        }
        const dependencies = candidate.activeDependencies ?? [];
        if (!Array.isArray(dependencies) || dependencies.some((dependency) => typeof dependency !== 'string' || !PLUGIN_ID.test(dependency))) {
          throw new Error('chat indicator dependencies are invalid');
        }
        normalized.set(candidate.targetKey, Object.freeze({
          targetKey: candidate.targetKey,
          state: candidate.state,
          ...(candidate.state === 'enabled' && dependencies.length > 0
            ? { activeDependencies: Object.freeze([...new Set(dependencies)]) }
            : {}),
        }));
      }
      for (const target of missing) entry.cache.set(target.key, normalized.get(target.key) ?? Object.freeze({ targetKey: target.key, state: 'hidden' }));
    } catch {
      for (const target of missing) entry.cache.set(target.key, Object.freeze({ targetKey: target.key, state: 'hidden' }));
      this.#diagnostics.record({ type: 'chat-indicator.resolve.failed', pluginId, code: 'CHAT_INDICATOR_PROVIDER_FAILED' });
    }
  }

  #syncRow(row: HTMLElement, indicators: readonly RenderableIndicator[]): void {
    const heading = row.querySelector<HTMLElement>('.chatName');
    const container = heading?.parentElement;
    let group = container?.querySelector<HTMLElement>(INDICATOR_GROUP_SELECTOR);
    if (!heading || !container || indicators.length === 0) {
      group?.remove();
      return;
    }
    if (!group) {
      group = this.#document!.createElement('span');
      group.dataset.ssHelperChatIndicators = 'true';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', '聊天插件状态');
    }
    if (group.previousElementSibling !== heading) heading.after(group);
    const existing = new Map(Array.from(group.querySelectorAll<HTMLElement>(INDICATOR_SELECTOR)).map((indicator) => [indicator.dataset.ssHelperChatIndicatorPlugin ?? '', indicator]));
    const desired = new Set(indicators.map((indicator) => indicator.pluginId));
    for (const [pluginId, indicator] of existing) if (!desired.has(pluginId)) indicator.remove();
    for (const indicator of indicators) {
      let element = existing.get(indicator.pluginId);
      if (!element) {
        element = this.#document!.createElement('span');
        element.dataset.ssHelperChatIndicatorPlugin = indicator.pluginId;
        element.className = 'stx-chat-indicator';
        const glyph = createIconElement(this.#document!, indicator.icon, { decorative: true, fixedWidth: true });
        element.append(glyph);
      }
      element.dataset.state = indicator.state;
      element.setAttribute('role', 'img');
      element.setAttribute('title', indicator.title);
      element.setAttribute('aria-label', indicator.title);
      const glyph = element.querySelector<HTMLElement>('ss-helper-icon');
      if (glyph) glyph.setAttribute('name', indicator.icon);
      group.append(element);
    }
  }
}
