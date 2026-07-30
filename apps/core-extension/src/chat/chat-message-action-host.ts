import {
  SSHelperError,
  type ChatMessageActionRegistration,
  type ChatMessageActionResolution,
  type ChatMessageActionTarget,
  type ChatMessageActionUiContext,
  type ChatMessageActionWindowPresentation,
} from '@ss-helper/sdk';
import type { DiagnosticsStore } from '../diagnostics/diagnostics-store.js';
import type { TavernHostAdapter } from '../host/tavern-host-port.js';
import type { SessionScope } from '../plugins/session-scope.js';
import { PopupUiController } from '../popup/popup-ui-context.js';
import { ensureCoreUiStyles } from '../styles/settings-styles.js';
import { createIconElement } from '../ui/icon-element.js';

const MESSAGE_SELECTOR = '#chat .mes';
const ACTIONS_SELECTOR = '.mes_buttons';
const EXTRA_ACTIONS_SELECTOR = '.extraMesButtons';
const ACTION_SELECTOR = '[data-ss-helper-message-action]';
const PANEL_SELECTOR = '[data-ss-helper-message-action-panel="true"]';
const REFRESH_DELAY_MS = 50;
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const ICON_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

interface ActionEntry {
  readonly key: string;
  readonly scope: SessionScope;
  readonly registration: Readonly<ChatMessageActionRegistration>;
  readonly cache: Map<string, ChatMessageActionResolution>;
  resolveController?: AbortController;
  unsubscribe: () => void;
}

interface MessageRow {
  readonly element: HTMLElement;
  readonly actions: HTMLElement;
  readonly target: ChatMessageActionTarget;
}

interface OpenPanel {
  readonly entryKey: string;
  readonly targetKey: string;
  readonly anchor: HTMLElement;
  readonly root: HTMLElement;
  readonly panel: HTMLElement;
  readonly ui: PopupUiController;
  readonly presentation?: ChatMessageActionWindowPresentation;
  readonly body: HTMLElement;
  minimized: boolean;
  cleanup: () => void;
  disposed: boolean;
}

interface SavedWindowBounds { readonly left: number; readonly top: number; readonly width: number; readonly height: number }

const WINDOW_MARGIN = 12;
const WINDOW_STORAGE_PREFIX = 'ss-helper.chat-action-window.';

function windowPresentation(value: ChatMessageActionRegistration['presentation']): ChatMessageActionWindowPresentation | undefined {
  if (value === undefined) return undefined;
  if (value.kind !== 'window') throw new SSHelperError('INVALID_PAYLOAD', 'The chat action presentation is invalid', { reason: 'chat_message_action.presentation' });
  const dimensions = [value.initialWidth, value.initialHeight, value.minWidth, value.minHeight];
  if (!dimensions.every((item) => Number.isFinite(item) && item > 0)
    || value.initialWidth < value.minWidth || value.initialHeight < value.minHeight
    || value.minWidth < 320 || value.minHeight < 240) {
    throw new SSHelperError('INVALID_PAYLOAD', 'The chat action window dimensions are invalid', { reason: 'chat_message_action.presentation' });
  }
  const persistKey = value.persistKey?.trim();
  if (persistKey !== undefined && (!ID_PATTERN.test(persistKey) || persistKey.length > 80)) {
    throw new SSHelperError('INVALID_PAYLOAD', 'The chat action window persistence key is invalid', { reason: 'chat_message_action.presentation' });
  }
  return Object.freeze({
    kind: 'window', initialWidth: value.initialWidth, initialHeight: value.initialHeight,
    minWidth: value.minWidth, minHeight: value.minHeight,
    draggable: value.draggable !== false, resizable: value.resizable !== false, minimizable: value.minimizable !== false,
    ...(persistKey === undefined ? {} : { persistKey }),
  });
}

function normalizedRegistration(scope: SessionScope, registration: ChatMessageActionRegistration): Readonly<ChatMessageActionRegistration> {
  if (!registration || typeof registration !== 'object') {
    throw new SSHelperError('INVALID_PAYLOAD', 'The chat message action registration is invalid', { reason: 'chat_message_action.registration' });
  }
  const id = typeof registration.id === 'string' ? registration.id.trim() : '';
  const label = typeof registration.label === 'string' ? registration.label.trim() : '';
  const icon = typeof registration.icon === 'string' ? registration.icon.trim() : '';
  const order = registration.order ?? 100;
  const presentation = windowPresentation(registration.presentation);
  if (!ID_PATTERN.test(id) || id.length > 64) {
    throw new SSHelperError('INVALID_PAYLOAD', 'The chat message action id is invalid', { reason: 'chat_message_action.id' });
  }
  if (!label || label.length > 80 || /[\u0000-\u001f\u007f]/u.test(label)) {
    throw new SSHelperError('INVALID_PAYLOAD', 'The chat message action label is invalid', { reason: 'chat_message_action.label' });
  }
  if (!ICON_PATTERN.test(icon) || icon.length > 48) {
    throw new SSHelperError('INVALID_PAYLOAD', 'The chat message action icon is invalid', { reason: 'chat_message_action.icon' });
  }
  if (!Number.isSafeInteger(order) || order < -1_000 || order > 1_000
    || typeof registration.resolve !== 'function' || typeof registration.render !== 'function'
    || (registration.subscribe !== undefined && typeof registration.subscribe !== 'function')) {
    throw new SSHelperError('INVALID_PAYLOAD', 'The chat message action registration is invalid', {
      pluginId: scope.id,
      reason: 'chat_message_action.registration',
    });
  }
  return Object.freeze({
    id,
    label,
    icon,
    order,
    ...(presentation === undefined ? {} : { presentation }),
    resolve: registration.resolve,
    render: registration.render,
    ...(registration.subscribe === undefined ? {} : { subscribe: registration.subscribe }),
  });
}

function messageIndex(element: HTMLElement): number | undefined {
  const raw = element.getAttribute('mesid') ?? element.dataset.mesid ?? element.dataset.messageIndex ?? element.dataset.index;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function workspaceIdOf(
  context: Awaited<ReturnType<NonNullable<TavernHostAdapter['context']>['read']>>,
  characterId?: string,
): string | undefined {
  const normalizedId = (value: string | undefined): string | undefined => {
    const normalized = value?.trim();
    return normalized && !/^(?:null|undefined)$/iu.test(normalized) ? normalized : undefined;
  };
  const groupId = normalizedId(context.groupId);
  if (groupId) return `group:${groupId}`;
  const resolvedCharacterId = normalizedId(characterId) ?? normalizedId(context.characterId);
  return resolvedCharacterId ? `character:${resolvedCharacterId}` : undefined;
}

function targetKey(workspaceId: string, chatKey: string, message: ChatMessageActionTarget['message']): string {
  const identity = message.stableId
    ?? (message.createdAt ? `time:${message.createdAt}:${message.role}:${message.index}` : `floor:${message.index}`);
  return JSON.stringify([workspaceId, chatKey, identity, message.variantId ?? '']);
}

function safeResolution(value: ChatMessageActionResolution, targetKeys: ReadonlySet<string>): ChatMessageActionResolution | undefined {
  if (!value || typeof value !== 'object' || !targetKeys.has(value.targetKey)
    || !['hidden', 'enabled', 'disabled'].includes(value.state)) return undefined;
  const ariaLabel = typeof value.ariaLabel === 'string' && value.ariaLabel.trim().length <= 160
    ? value.ariaLabel.trim()
    : undefined;
  const disabledReason = typeof value.disabledReason === 'string' && value.disabledReason.trim().length <= 240
    ? value.disabledReason.trim()
    : undefined;
  const sourceWindow = value.window;
  const title = typeof sourceWindow?.title === 'string' && sourceWindow.title.trim().length > 0 && sourceWindow.title.trim().length <= 120
    ? sourceWindow.title.trim() : undefined;
  const subtitle = typeof sourceWindow?.subtitle === 'string' && sourceWindow.subtitle.trim().length <= 240
    ? sourceWindow.subtitle.trim() : undefined;
  const statusLabel = typeof sourceWindow?.status?.label === 'string' && sourceWindow.status.label.trim().length <= 80
    ? sourceWindow.status.label.trim() : undefined;
  const tone = sourceWindow?.status?.tone;
  const safeTone = tone !== undefined && ['success', 'warning', 'danger', 'neutral'].includes(tone) ? tone : undefined;
  const window = title === undefined ? undefined : Object.freeze({
    title,
    ...(subtitle ? { subtitle } : {}),
    ...(statusLabel ? { status: Object.freeze({ label: statusLabel, ...(safeTone === undefined ? {} : { tone: safeTone }) }) } : {}),
  });
  return Object.freeze({
    targetKey: value.targetKey,
    state: value.state,
    ...(ariaLabel ? { ariaLabel } : {}),
    ...(disabledReason ? { disabledReason } : {}),
    ...(window === undefined ? {} : { window }),
  });
}

function relevantMutation(mutation: MutationRecord): boolean {
  const target = mutation.target && typeof mutation.target === 'object'
    && (mutation.target as Node).nodeType === 1
    ? mutation.target as Element
    : undefined;
  if (mutation.type === 'attributes') {
    return target?.matches?.('.mes') === true && target.closest?.('#chat') !== null;
  }
  const changed = [...mutation.addedNodes, ...mutation.removedNodes]
    .filter((node): node is Element => Boolean(node)
      && typeof node === 'object'
      && (node as Node).nodeType === 1)
    .filter((element) => element.matches?.(ACTION_SELECTOR) !== true
      && element.closest?.(ACTION_SELECTOR) === null
      && element.matches?.(PANEL_SELECTOR) !== true
      && element.closest?.(PANEL_SELECTOR) === null);
  if (changed.length === 0) return false;
  if (target?.matches?.(ACTIONS_SELECTOR) === true && target.closest?.('#chat') !== null) return true;
  return changed.some((element) =>
    element.matches?.('.mes') === true
    || element.matches?.(ACTIONS_SELECTOR) === true
    || element.querySelector?.('.mes') !== null
    || element.querySelector?.(ACTIONS_SELECTOR) !== null);
}

function rowIntersectsChatViewport(element: HTMLElement): boolean {
  if (typeof element.getBoundingClientRect !== 'function') return true;
  const chat = element.closest<HTMLElement>('#chat');
  if (chat === null || typeof chat.getBoundingClientRect !== 'function') return true;
  const rowRect = element.getBoundingClientRect();
  const chatRect = chat.getBoundingClientRect();
  const viewportHeight = element.ownerDocument.defaultView?.innerHeight ?? chatRect.bottom;
  const top = Math.max(0, chatRect.top) - 160;
  const bottom = Math.min(viewportHeight, chatRect.bottom) + 160;
  return rowRect.bottom >= top && rowRect.top <= bottom;
}

export class ChatMessageActionHost {
  readonly #entries = new Map<string, ActionEntry>();
  readonly #buttonTargets = new WeakMap<HTMLButtonElement, ChatMessageActionTarget>();
  readonly #document: Document | undefined;
  readonly #hostAdapter: TavernHostAdapter;
  readonly #diagnostics: DiagnosticsStore;
  readonly #hostCleanups: Array<() => void> = [];
  #observer: MutationObserver | undefined;
  #refreshTimer: ReturnType<typeof setTimeout> | undefined;
  #refreshRevision = 0;
  #forceRefresh = false;
  #refreshRunning = false;
  #refreshQueued = false;
  #openPanel: OpenPanel | undefined;
  #disposed = false;

  constructor(document: Document | undefined, hostAdapter: TavernHostAdapter, diagnostics: DiagnosticsStore) {
    this.#document = document;
    this.#hostAdapter = hostAdapter;
    this.#diagnostics = diagnostics;
    if (document !== undefined) {
      ensureCoreUiStyles(document);
    }
  }

  register(scope: SessionScope, registration: ChatMessageActionRegistration): () => void {
    scope.assertActive();
    if (this.#disposed) throw new SSHelperError('CORE_UNAVAILABLE', 'Core is disposed');
    const normalized = normalizedRegistration(scope, registration);
    const key = `${scope.id}:${normalized.id}`;
    if (this.#entries.has(key)) {
      throw new SSHelperError('CONFLICT', 'The chat message action is already registered', {
        pluginId: scope.id,
        reason: 'chat_message_action.duplicate',
      });
    }
    const entry: ActionEntry = { key, scope, registration: normalized, cache: new Map(), unsubscribe: () => undefined };
    this.#entries.set(key, entry);
    this.#ensureMonitoring();
    if (normalized.subscribe !== undefined) {
      try {
        const unsubscribe = normalized.subscribe((keys) => {
          if (this.#disposed || this.#entries.get(key) !== entry) return;
          if (keys === undefined) entry.cache.clear();
          else for (const target of keys) if (typeof target === 'string') entry.cache.delete(target);
          entry.resolveController?.abort();
          this.scheduleRefresh(false, true);
        });
        if (typeof unsubscribe === 'function') entry.unsubscribe = unsubscribe;
      } catch {
        this.#diagnostics.record({ type: 'chat-message-action.subscribe.failed', pluginId: scope.id });
      }
    }
    this.scheduleRefresh(false, true);
    return scope.addCleanup(() => {
      if (this.#entries.get(key) !== entry) return;
      this.#entries.delete(key);
      entry.resolveController?.abort();
      try { entry.unsubscribe(); } catch { /* plugin cleanup is isolated */ }
      entry.cache.clear();
      if (this.#openPanel?.entryKey === key) this.#closePanel();
      if (this.#entries.size === 0) {
        this.#observer?.disconnect();
        this.#observer = undefined;
        while (this.#hostCleanups.length > 0) {
          try { this.#hostCleanups.pop()?.(); } catch { /* optional host cleanup */ }
        }
      }
      this.scheduleRefresh(true);
    });
  }

  #ensureMonitoring(): void {
    const document = this.#document;
    if (document !== undefined && this.#observer === undefined) {
      const Observer = document.defaultView?.MutationObserver
        ?? (typeof MutationObserver === 'undefined' ? undefined : MutationObserver);
      const root = document.body ?? document.documentElement;
      if (Observer !== undefined && root !== null) {
        this.#observer = new Observer((mutations) => {
          if (mutations.some(relevantMutation)) this.scheduleRefresh();
        });
        this.#observer.observe(root, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['mesid', 'swipeid', 'data-message-id'],
        });
      }
    }
    if (this.#hostCleanups.length === 0) {
      const events = this.#hostAdapter.events;
      if (events !== undefined) {
        for (const name of ['chat-changed', 'message-edited', 'message-deleted', 'message-swiped', 'message-swipe-deleted', 'generation-ended'] as const) {
          try { this.#hostCleanups.push(events.subscribe(name, () => { if (name === 'chat-changed') this.#closePanel(); this.scheduleRefresh(true, true); })); } catch { /* optional host signal */ }
        }
        for (const name of ['message-received', 'message-sent'] as const) {
          try { this.#hostCleanups.push(events.subscribe(name, () => this.scheduleRefresh())); } catch { /* optional host signal */ }
        }
      }
      if (document !== undefined) {
        const onChatScroll = (event: Event): void => {
          const target = event.target;
          if (target && typeof target === 'object' && (target as Node).nodeType === 1) {
            const element = target as Element;
            if (element.matches?.('#chat') === true || element.closest?.('#chat') !== null) this.scheduleRefresh();
          }
        };
        document.addEventListener('scroll', onChatScroll, true);
        this.#hostCleanups.push(() => document.removeEventListener('scroll', onChatScroll, true));
      }
    }
  }

  scheduleRefresh(force = false, immediate = false): void {
    if (this.#disposed || this.#document === undefined) return;
    this.#forceRefresh ||= force;
    if (force) for (const entry of this.#entries.values()) entry.resolveController?.abort();
    if (this.#refreshRunning) {
      if (force) this.#refreshRevision += 1;
      this.#refreshQueued = true;
      return;
    }
    if (this.#refreshTimer !== undefined) {
      if (!immediate) return;
      clearTimeout(this.#refreshTimer);
    }
    this.#refreshTimer = setTimeout(() => {
      this.#refreshTimer = undefined;
      const refreshAll = this.#forceRefresh;
      this.#forceRefresh = false;
      void this.refresh(refreshAll);
    }, immediate ? 0 : REFRESH_DELAY_MS);
  }

  async refresh(force = false): Promise<void> {
    if (this.#disposed || this.#document === undefined) return;
    if (this.#refreshRunning) {
      this.#forceRefresh ||= force;
      this.#refreshQueued = true;
      return;
    }
    this.#refreshRunning = true;
    const revision = ++this.#refreshRevision;
    try {
      if (force) for (const entry of this.#entries.values()) entry.cache.clear();
      const rows = await this.#messageRows();
      if (this.#disposed || revision !== this.#refreshRevision) return;
      const visibleRows = rows.filter((row) => rowIntersectsChatViewport(row.element));
      const resolveRows = [...new Map([...visibleRows, ...rows.slice(-20)]
        .map((row) => [row.target.key, row])).values()];
      const targets = [...new Map(resolveRows
        .map((row) => [row.target.key, row.target])).values()];
      await Promise.all([...this.#entries.values()].map((entry) => this.#resolveEntry(entry, targets)));
      if (this.#disposed || revision !== this.#refreshRevision) return;
      this.#syncRows(rows);
    } finally {
      this.#refreshRunning = false;
      if (!this.#disposed && (this.#refreshQueued || this.#forceRefresh)) {
        this.#refreshQueued = false;
        this.scheduleRefresh(false, true);
      }
    }
  }

  async #messageRows(): Promise<MessageRow[]> {
    const document = this.#document;
    const contextPort = this.#hostAdapter.context;
    const chatPort = this.#hostAdapter.chat;
    if (document === undefined || contextPort === undefined || chatPort === undefined) return [];
    try {
      const [context, messages, character] = await Promise.all([
        contextPort.read(),
        chatPort.readMessages(),
        this.#hostAdapter.character?.read() ?? Promise.resolve(null),
      ]);
      const workspaceId = workspaceIdOf(context, character?.id);
      const chatKey = context.chatKey?.trim() || context.chatId?.trim();
      if (!workspaceId || !chatKey) return [];
      const rows: MessageRow[] = [];
      for (const element of Array.from(document.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR))) {
        const index = messageIndex(element);
        const actions = element.querySelector<HTMLElement>(ACTIONS_SELECTOR);
        const message = index === undefined ? undefined : messages[index];
        if (actions === null || message === undefined) continue;
        rows.push({
          element,
          actions,
          target: Object.freeze({ key: targetKey(workspaceId, chatKey, message), workspaceId, chatKey, message }),
        });
      }
      return rows;
    } catch {
      this.#diagnostics.record({ type: 'chat-message-action.targets.failed' });
      return [];
    }
  }

  async #resolveEntry(entry: ActionEntry, targets: readonly ChatMessageActionTarget[]): Promise<void> {
    const pending = targets.filter((target) => !entry.cache.has(target.key));
    if (pending.length === 0) return;
    entry.resolveController?.abort();
    const controller = new AbortController();
    entry.resolveController = controller;
    try {
      entry.scope.assertActive();
      const resolved = await entry.registration.resolve(Object.freeze([...pending]), { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!Array.isArray(resolved)) throw new Error('invalid message action resolution');
      const keys = new Set(pending.map((target) => target.key));
      for (const candidate of resolved) {
        const value = safeResolution(candidate, keys);
        if (value !== undefined) entry.cache.set(value.targetKey, value);
      }
      // Registrations may deliberately omit a target while an asynchronous
      // availability lookup is still pending.  Treat omission as nonterminal:
      // caching it as hidden would permanently suppress actions for every
      // target outside a plugin's first lookup batch.
    } catch {
      if (controller.signal.aborted) return;
      for (const target of pending) entry.cache.set(target.key, Object.freeze({ targetKey: target.key, state: 'hidden' }));
      this.#diagnostics.record({ type: 'chat-message-action.resolve.failed', pluginId: entry.scope.id });
    } finally {
      if (entry.resolveController === controller) delete entry.resolveController;
    }
  }

  #syncRows(rows: readonly MessageRow[]): void {
    const live = new Set<HTMLElement>();
    const entries = [...this.#entries.values()].sort((left, right) =>
      (left.registration.order ?? 100) - (right.registration.order ?? 100)
      || left.scope.id.localeCompare(right.scope.id)
      || left.registration.id.localeCompare(right.registration.id));
    for (const row of rows) {
      let insertionPoint = row.actions.querySelector<HTMLElement>(EXTRA_ACTIONS_SELECTOR);
      for (const entry of entries) {
        const resolution = entry.cache.get(row.target.key);
        if (resolution === undefined || resolution.state === 'hidden') continue;
        const selector = `${ACTION_SELECTOR}[data-ss-helper-message-action="${entry.key}"]`;
        let button = row.actions.querySelector<HTMLButtonElement>(selector);
        if (button === null) {
          const createdButton = this.#document!.createElement('button');
          createdButton.type = 'button';
          createdButton.className = 'mes_button stx-chat-message-action';
          createdButton.dataset.ssHelperMessageAction = entry.key;
          createdButton.setAttribute('aria-haspopup', 'dialog');
          createdButton.setAttribute('aria-expanded', 'false');
          createdButton.append(createIconElement(this.#document!, entry.registration.icon, { decorative: true }));
          createdButton.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (createdButton.disabled) return;
            const target = this.#buttonTargets.get(createdButton);
            if (target === undefined) return;
            void this.#open(entry, target, createdButton);
          });
          button = createdButton;
        }
        this.#buttonTargets.set(button, row.target);
        if (button.dataset.ssHelperMessageTarget !== row.target.key) button.dataset.ssHelperMessageTarget = row.target.key;
        const disabled = resolution.state === 'disabled';
        if (button.disabled !== disabled) button.disabled = disabled;
        const label = resolution.ariaLabel ?? entry.registration.label;
        if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label);
        const title = resolution.state === 'disabled' && resolution.disabledReason
          ? `${label}：${resolution.disabledReason}`
          : label;
        if (button.title !== title) button.title = title;
        if (insertionPoint !== null) {
          if (button.previousElementSibling !== insertionPoint) insertionPoint.after(button);
        } else if (row.actions.children[0] !== button) row.actions.prepend(button);
        insertionPoint = button;
        live.add(button);
      }
    }
    for (const node of Array.from(this.#document!.querySelectorAll<HTMLElement>(ACTION_SELECTOR))) {
      if (!live.has(node)) {
        if (this.#openPanel?.anchor === node) this.#closePanel();
        this.#buttonTargets.delete(node as HTMLButtonElement);
        node.remove();
      }
    }
  }

  async #open(entry: ActionEntry, target: ChatMessageActionTarget, anchor: HTMLElement): Promise<void> {
    this.#closePanel();
    entry.scope.assertActive();
    const document = this.#document;
    if (document === undefined) return;
    const root = document.createElement('div');
    root.dataset.ssHelperMessageActionPanel = 'true';
    const presentation = entry.registration.presentation;
    if (presentation?.kind === 'window') root.dataset.presentation = 'window';
    else root.addEventListener('pointerdown', (event) => { if (event.target === root) this.#closePanel(); });
    const panel = document.createElement('section');
    panel.className = 'stx-chat-message-action-panel';
    panel.id = 'ss-helper-chat-message-action-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    panel.setAttribute('aria-label', entry.registration.label);
    panel.setAttribute('aria-busy', 'true');
    panel.tabIndex = -1;
    const resolution = entry.cache.get(target.key);
    let body = panel;
    let windowHeader: HTMLElement | undefined;
    if (presentation?.kind === 'window') {
      panel.classList.add('stx-chat-message-action-window');
      windowHeader = document.createElement('header');
      windowHeader.className = 'stx-chat-action-window-header';
      const identity = document.createElement('div');
      identity.className = 'stx-chat-action-window-identity';
      const icon = document.createElement('span');
      icon.className = 'stx-chat-action-window-icon';
      icon.append(createIconElement(document, entry.registration.icon, { decorative: true }));
      const titleGroup = document.createElement('div');
      const titleLine = document.createElement('div');
      titleLine.className = 'stx-chat-action-window-title-line';
      const title = document.createElement('h2');
      title.className = 'stx-chat-action-window-title';
      title.textContent = resolution?.window?.title ?? entry.registration.label;
      const subtitle = document.createElement('p');
      subtitle.className = 'stx-chat-action-window-subtitle';
      subtitle.textContent = resolution?.window?.subtitle ?? '';
      titleLine.append(title);
      if (resolution?.window?.status !== undefined) {
        const status = document.createElement('span');
        status.className = 'stx-chat-action-window-status';
        status.dataset.tone = resolution.window.status.tone ?? 'neutral';
        status.textContent = resolution.window.status.label;
        titleLine.append(status);
      }
      titleGroup.append(titleLine, subtitle);
      identity.append(icon, titleGroup);
      const commands = document.createElement('div');
      commands.className = 'stx-chat-action-window-commands';
      if (presentation.minimizable !== false) {
        const minimize = document.createElement('button');
        minimize.type = 'button'; minimize.className = 'stx-chat-action-window-command'; minimize.title = '最小化'; minimize.setAttribute('aria-label', '最小化');
        minimize.dataset.windowCommand = 'minimize';
        minimize.append(createIconElement(document, 'minus', { decorative: true }));
        minimize.addEventListener('click', () => this.#setWindowMinimized(opened, !opened.minimized));
        commands.append(minimize);
      }
      const close = document.createElement('button');
      close.type = 'button'; close.className = 'stx-chat-action-window-command'; close.title = '关闭'; close.setAttribute('aria-label', '关闭');
      close.append(createIconElement(document, 'xmark', { decorative: true }));
      close.addEventListener('click', () => this.#closePanel());
      commands.append(close);
      windowHeader.append(identity, commands);
      body = document.createElement('div');
      body.className = 'stx-chat-action-window-body';
      panel.append(windowHeader, body);
      if (presentation.resizable !== false) {
        const resize = document.createElement('button');
        resize.type = 'button'; resize.className = 'stx-chat-action-window-resize'; resize.setAttribute('aria-label', '调整窗口大小'); resize.title = '拖动或使用方向键调整窗口大小';
        panel.append(resize);
      }
    }
    const loading = document.createElement('div');
    loading.className = 'stx-chat-message-action-loading';
    loading.setAttribute('role', 'status');
    loading.textContent = '正在加载召回详情…';
    body.append(loading);
    root.append(panel);
    (document.body ?? document.documentElement).append(root);
    const ui = new PopupUiController(body, () => this.#closePanel());
    const opened: OpenPanel = {
      entryKey: entry.key,
      targetKey: target.key,
      anchor,
      root,
      panel,
      ui,
      ...(presentation === undefined ? {} : { presentation }),
      body,
      minimized: false,
      cleanup: () => undefined,
      disposed: false,
    };
    this.#openPanel = opened;
    if (presentation?.kind === 'window') this.#initializeWindow(opened, windowHeader);
    anchor.classList.add('is-open');
    anchor.setAttribute('aria-expanded', 'true');
    anchor.setAttribute('aria-controls', panel.id);
    this.#positionPanel(opened);
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.#closePanel();
      }
    };
    const closeOutside = (event: PointerEvent): void => {
      const node = event.target;
      if (node && typeof node === 'object'
        && !panel.contains(node as Node)
        && !anchor.contains(node as Node)) this.#closePanel();
    };
    document.addEventListener('keydown', closeOnEscape, true);
    if (presentation?.kind !== 'window') document.addEventListener('pointerdown', closeOutside, true);
    const reposition = (): void => this.#positionPanel(opened);
    document.defaultView?.addEventListener('resize', reposition);
    if (presentation?.kind !== 'window') document.defaultView?.addEventListener('scroll', reposition, true);
    opened.cleanup = () => {
      document.removeEventListener('keydown', closeOnEscape, true);
      document.removeEventListener('pointerdown', closeOutside, true);
      document.defaultView?.removeEventListener('resize', reposition);
      document.defaultView?.removeEventListener('scroll', reposition, true);
    };
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (this.#openPanel !== opened || opened.disposed) return;
      const cleanup = await entry.registration.render(body, target, ui as ChatMessageActionUiContext);
      if (this.#openPanel !== opened || opened.disposed) {
        if (typeof cleanup === 'function') cleanup();
        return;
      }
      if (typeof cleanup === 'function') {
        const base = opened.cleanup;
        opened.cleanup = () => { cleanup(); base(); };
      }
      panel.removeAttribute('aria-busy');
      this.#positionPanel(opened);
      const focusTarget = panel.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]');
      (focusTarget ?? panel).focus();
    } catch {
      if (this.#openPanel === opened && !opened.disposed) {
        panel.removeAttribute('aria-busy');
        // `panel` owns the Core title bar and its close/minimize controls.  An
        // action renderer failing must only replace its content body.
        body.textContent = '该操作暂时无法显示。';
        this.#diagnostics.record({ type: 'chat-message-action.render.failed', pluginId: entry.scope.id });
      }
    }
  }

  #positionPanel(opened: OpenPanel): void {
    if (opened.disposed || !opened.root.isConnected) return;
    const view = this.#document?.defaultView;
    if (opened.presentation?.kind === 'window') {
      this.#clampWindow(opened);
      return;
    }
    const anchorRect = opened.anchor.getBoundingClientRect?.();
    const panelRect = opened.panel.getBoundingClientRect?.();
    if (!view || !anchorRect || !panelRect) return;
    const margin = 8;
    const mobile = view.innerWidth <= 680;
    opened.root.dataset.mobile = String(mobile);
    if (mobile) {
      opened.panel.style.left = `${margin}px`;
      opened.panel.style.right = `${margin}px`;
      opened.panel.style.bottom = `${margin}px`;
      opened.panel.style.top = 'auto';
      return;
    }
    const left = Math.max(margin, Math.min(view.innerWidth - panelRect.width - margin, anchorRect.right - panelRect.width));
    const panelHeight = Math.min(panelRect.height, Math.max(0, view.innerHeight - (margin * 2)));
    const below = anchorRect.bottom + margin;
    const above = anchorRect.top - panelHeight - margin;
    const maximumTop = Math.max(margin, view.innerHeight - panelHeight - margin);
    const top = below + panelHeight <= view.innerHeight - margin
      ? below
      : above >= margin
        ? above
        : Math.max(margin, Math.min(maximumTop, below));
    opened.panel.style.left = `${left}px`;
    opened.panel.style.top = `${top}px`;
    opened.panel.style.right = 'auto';
    opened.panel.style.bottom = 'auto';
  }

  #windowStorageKey(opened: OpenPanel): string {
    return `${WINDOW_STORAGE_PREFIX}${opened.presentation?.persistKey ?? opened.entryKey}`;
  }

  #readWindowBounds(opened: OpenPanel): SavedWindowBounds | undefined {
    try {
      const raw = this.#document?.defaultView?.localStorage.getItem(this.#windowStorageKey(opened));
      const value = raw === null || raw === undefined ? undefined : JSON.parse(raw) as Partial<SavedWindowBounds>;
      return value !== undefined && [value.left, value.top, value.width, value.height].every(Number.isFinite)
        ? value as SavedWindowBounds : undefined;
    } catch { return undefined; }
  }

  #saveWindowBounds(opened: OpenPanel): void {
    if (opened.presentation?.kind !== 'window' || opened.minimized) return;
    const rect = opened.panel.getBoundingClientRect();
    try { this.#document?.defaultView?.localStorage.setItem(this.#windowStorageKey(opened), JSON.stringify({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })); } catch { /* persistence is optional */ }
  }

  #initializeWindow(opened: OpenPanel, header?: HTMLElement): void {
    const view = this.#document?.defaultView;
    const presentation = opened.presentation;
    if (!view || presentation?.kind !== 'window') return;
    const saved = this.#readWindowBounds(opened);
    const width = Math.min(view.innerWidth - WINDOW_MARGIN * 2, Math.max(presentation.minWidth, saved?.width ?? presentation.initialWidth));
    const height = Math.min(view.innerHeight - WINDOW_MARGIN * 2, Math.max(presentation.minHeight, saved?.height ?? presentation.initialHeight));
    opened.panel.style.width = `${width}px`; opened.panel.style.height = `${height}px`;
    opened.panel.style.left = `${saved?.left ?? Math.max(WINDOW_MARGIN, (view.innerWidth - width) / 2)}px`;
    opened.panel.style.top = `${saved?.top ?? Math.max(WINDOW_MARGIN, (view.innerHeight - height) / 2)}px`;
    const bindPointer = (element: HTMLElement, mode: 'move' | 'resize'): void => {
      element.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || opened.minimized || (mode === 'move' && (event.target as Element).closest('button'))) return;
        event.preventDefault();
        const start = opened.panel.getBoundingClientRect(); const originX = event.clientX; const originY = event.clientY;
        const onMove = (move: PointerEvent): void => {
          if (mode === 'move') { opened.panel.style.left = `${start.left + move.clientX - originX}px`; opened.panel.style.top = `${start.top + move.clientY - originY}px`; }
          else { opened.panel.style.width = `${Math.max(presentation.minWidth, start.width + move.clientX - originX)}px`; opened.panel.style.height = `${Math.max(presentation.minHeight, start.height + move.clientY - originY)}px`; }
          this.#clampWindow(opened);
        };
        const onUp = (): void => { view.removeEventListener('pointermove', onMove); view.removeEventListener('pointerup', onUp); this.#saveWindowBounds(opened); };
        view.addEventListener('pointermove', onMove); view.addEventListener('pointerup', onUp, { once: true });
      });
    };
    if (presentation.draggable !== false && header !== undefined) bindPointer(header, 'move');
    const resize = opened.panel.querySelector<HTMLElement>('.stx-chat-action-window-resize');
    if (presentation.resizable !== false && resize !== null) {
      bindPointer(resize, 'resize');
      resize.addEventListener('keydown', (event) => {
        const step = event.shiftKey ? 32 : 8;
        const rect = opened.panel.getBoundingClientRect();
        const delta: readonly [number, number] | undefined = event.key === 'ArrowRight' ? [step, 0] : event.key === 'ArrowLeft' ? [-step, 0] : event.key === 'ArrowDown' ? [0, step] : event.key === 'ArrowUp' ? [0, -step] : undefined;
        if (delta === undefined) return;
        event.preventDefault(); opened.panel.style.width = `${Math.max(presentation.minWidth, rect.width + delta[0])}px`; opened.panel.style.height = `${Math.max(presentation.minHeight, rect.height + delta[1])}px`; this.#clampWindow(opened); this.#saveWindowBounds(opened);
      });
    }
    this.#clampWindow(opened);
  }

  #clampWindow(opened: OpenPanel): void {
    const view = this.#document?.defaultView;
    const presentation = opened.presentation;
    if (!view || presentation?.kind !== 'window') return;
    const mobile = view.innerWidth <= 620;
    opened.root.dataset.mobile = String(mobile);
    if (mobile) { opened.panel.style.inset = '6px'; opened.panel.style.width = 'auto'; opened.panel.style.height = 'auto'; return; }
    opened.panel.style.right = 'auto'; opened.panel.style.bottom = 'auto';
    const rect = opened.panel.getBoundingClientRect();
    const width = Math.min(rect.width, view.innerWidth - WINDOW_MARGIN * 2);
    const height = opened.minimized ? rect.height : Math.min(rect.height, view.innerHeight - WINDOW_MARGIN * 2);
    opened.panel.style.width = `${width}px`; if (!opened.minimized) opened.panel.style.height = `${height}px`;
    opened.panel.style.left = `${Math.max(WINDOW_MARGIN, Math.min(view.innerWidth - width - WINDOW_MARGIN, rect.left))}px`;
    opened.panel.style.top = `${Math.max(WINDOW_MARGIN, Math.min(view.innerHeight - height - WINDOW_MARGIN, rect.top))}px`;
  }

  #setWindowMinimized(opened: OpenPanel, minimized: boolean): void {
    if (opened.disposed || opened.presentation?.kind !== 'window') return;
    opened.minimized = minimized; opened.panel.dataset.minimized = String(minimized);
    const command = opened.panel.querySelector<HTMLButtonElement>('[data-window-command="minimize"]');
    if (command !== null) { command.title = minimized ? '恢复窗口' : '最小化'; command.setAttribute('aria-label', minimized ? '恢复窗口' : '最小化'); }
    opened.body.hidden = minimized;
    const resize = opened.panel.querySelector<HTMLElement>('.stx-chat-action-window-resize'); if (resize) resize.hidden = minimized;
    if (minimized) opened.panel.style.height = 'auto';
    else { const saved = this.#readWindowBounds(opened); opened.panel.style.height = `${saved?.height ?? opened.presentation.initialHeight}px`; }
    this.#clampWindow(opened);
  }

  #closePanel(): void {
    const opened = this.#openPanel;
    if (opened === undefined || opened.disposed) return;
    opened.disposed = true;
    this.#openPanel = undefined;
    opened.anchor.classList.remove('is-open');
    opened.anchor.setAttribute('aria-expanded', 'false');
    opened.anchor.removeAttribute('aria-controls');
    try { opened.cleanup(); } catch { /* plugin cleanup is isolated */ }
    opened.ui.dispose();
    opened.root.remove();
    if (opened.anchor.isConnected) opened.anchor.focus();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#refreshRevision += 1;
    if (this.#refreshTimer !== undefined) clearTimeout(this.#refreshTimer);
    this.#refreshTimer = undefined;
    this.#observer?.disconnect();
    this.#observer = undefined;
    while (this.#hostCleanups.length > 0) {
      try { this.#hostCleanups.pop()?.(); } catch { /* host cleanup is isolated */ }
    }
    for (const entry of this.#entries.values()) {
      entry.resolveController?.abort();
      try { entry.unsubscribe(); } catch { /* plugin cleanup is isolated */ }
      entry.cache.clear();
    }
    this.#entries.clear();
    this.#closePanel();
    this.#document?.querySelectorAll<HTMLElement>(`${ACTION_SELECTOR}, ${PANEL_SELECTOR}`).forEach((node) => node.remove());
  }
}
