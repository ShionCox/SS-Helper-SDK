import { SSHelperError, type ExtensionMenuItemRegistration } from '@ss-helper/sdk';
import type { DiagnosticsStore } from '../diagnostics/diagnostics-store.js';
import type { SessionScope } from '../plugins/session-scope.js';
import type { ToastHost } from '../toast/toast-host.js';
import { createIconElement } from './icon-element.js';

const GROUP_ID = 'ss-helper-extension-menu-group';
const ITEM_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const ICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MAX_LABEL_LENGTH = 80;
const MIN_ORDER = -10_000;
const MAX_ORDER = 10_000;

interface ExtensionMenuEntry {
  readonly key: string;
  readonly scope: SessionScope;
  readonly registration: Readonly<ExtensionMenuItemRegistration>;
  busy: boolean;
}

function validateRegistration(registration: ExtensionMenuItemRegistration): Readonly<ExtensionMenuItemRegistration> {
  const label = registration.label.trim();
  const icon = registration.icon.trim().toLowerCase();
  const order = registration.order ?? 100;
  if (
    !ITEM_ID.test(registration.id)
    || label.length === 0
    || label.length > MAX_LABEL_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(label)
    || icon.length === 0
    || icon.length > 64
    || !ICON_NAME.test(icon)
    || !Number.isSafeInteger(order)
    || order < MIN_ORDER
    || order > MAX_ORDER
    || typeof registration.onActivate !== 'function'
  ) {
    throw new SSHelperError('PAYLOAD_INVALID', 'The extension menu registration is invalid', {
      reason: 'extension_menu_registration',
    });
  }
  return Object.freeze({ ...registration, label, icon, order });
}

function entryKey(scope: SessionScope, id: string): string {
  return `${scope.id}\u0000${id}`;
}

export class ExtensionMenuHost {
  readonly #entries = new Map<string, ExtensionMenuEntry>();
  #group: HTMLElement | undefined;
  #observer: MutationObserver | undefined;
  #renderScheduled = false;
  #disposed = false;

  constructor(
    private readonly document: Document | undefined,
    private readonly diagnostics: DiagnosticsStore,
    private readonly toasts: ToastHost,
  ) {}

  #ensureObserver(): void {
    if (this.#observer !== undefined || this.#disposed) return;
    const document = this.document;
    const Observer = document?.defaultView?.MutationObserver ?? globalThis.MutationObserver;
    const root = document?.documentElement ?? document?.body;
    if (Observer !== undefined && root !== undefined && root !== null) {
      this.#observer = new Observer((mutations) => {
        const group = this.#group;
        if (group !== undefined && mutations.every((mutation) => mutation.target === group || group.contains(mutation.target as Node))) return;
        this.#scheduleRender();
      });
      this.#observer.observe(root, { childList: true, subtree: true });
    }
  }

  register(scope: SessionScope, registration: ExtensionMenuItemRegistration): () => void {
    scope.assertActive();
    const normalized = validateRegistration(registration);
    const key = entryKey(scope, normalized.id);
    if (this.#entries.has(key)) {
      throw new SSHelperError('PAYLOAD_INVALID', 'The extension menu item is already registered', {
        reason: 'duplicate_extension_menu_item',
      });
    }
    this.#entries.set(key, { key, scope, registration: normalized, busy: false });
    this.#ensureObserver();
    this.#render();
    return scope.addCleanup(() => {
      this.#entries.delete(key);
      this.#render();
    });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#observer?.disconnect();
    this.#observer = undefined;
    this.#entries.clear();
    this.#group?.remove();
    this.#group = undefined;
  }

  #scheduleRender(): void {
    if (this.#disposed || this.#renderScheduled) return;
    this.#renderScheduled = true;
    queueMicrotask(() => {
      this.#renderScheduled = false;
      this.#render();
    });
  }

  #render(): void {
    if (this.#disposed) return;
    const menu = this.document?.getElementById('extensionsMenu');
    if (menu === null || menu === undefined || this.#entries.size === 0) {
      this.#group?.remove();
      this.#group = undefined;
      return;
    }
    if (this.#group?.parentElement !== menu) {
      this.#group?.remove();
      const group = this.document!.createElement('section');
      group.id = GROUP_ID;
      group.className = 'extension_container';
      group.setAttribute('aria-label', 'SS-Helper 工具');
      this.#group = group;
    }
    const group = this.#group;
    const start = this.document!.createElement('hr');
    start.dataset.ssHelperExtensionMenuSeparator = 'start';
    start.setAttribute('aria-hidden', 'true');
    const end = this.document!.createElement('hr');
    end.dataset.ssHelperExtensionMenuSeparator = 'end';
    end.setAttribute('aria-hidden', 'true');
    const rows = [...this.#entries.values()]
      .sort((left, right) => {
        const byOrder = (left.registration.order ?? 100) - (right.registration.order ?? 100);
        if (byOrder !== 0) return byOrder;
        const byPlugin = left.scope.id.localeCompare(right.scope.id);
        return byPlugin !== 0 ? byPlugin : left.registration.id.localeCompare(right.registration.id);
      })
      .map((entry) => this.#renderEntry(entry));
    group.replaceChildren(start, ...rows, end);
    const lastChild = menu.lastElementChild ?? menu.children[menu.children.length - 1];
    if (lastChild !== group) menu.append(group);
  }

  #renderEntry(entry: ExtensionMenuEntry): HTMLButtonElement {
    const button = this.document!.createElement('button');
    button.type = 'button';
    button.className = 'stx-extension-menu-item';
    button.dataset.pluginId = entry.scope.id;
    button.dataset.menuItemId = entry.registration.id;
    if (entry.busy) {
      button.setAttribute('aria-busy', 'true');
      button.setAttribute('aria-disabled', 'true');
    }
    const icon = createIconElement(this.document!, entry.registration.icon, {
      decorative: true,
      fixedWidth: true,
      className: 'extensionsMenuExtensionButton',
    });
    const label = this.document!.createElement('span');
    label.textContent = entry.registration.label;
    button.append(icon, label);
    button.addEventListener('click', () => { void this.#activate(entry, button); });
    return button;
  }

  async #activate(entry: ExtensionMenuEntry, button: HTMLButtonElement): Promise<void> {
    if (entry.busy || this.#disposed) return;
    entry.busy = true;
    button.setAttribute('aria-busy', 'true');
    button.setAttribute('aria-disabled', 'true');
    try {
      entry.scope.assertActive();
      await entry.registration.onActivate();
    } catch {
      this.diagnostics.record({
        type: 'core.ui.extension-menu.activation-failed',
        pluginId: entry.scope.id,
        code: 'EXTENSION_MENU_ACTIVATION_FAILED',
      });
      try {
        this.toasts.show(entry.scope, {
          level: 'error',
          title: 'SS-Helper 工具无法打开',
          message: `“${entry.registration.label}”暂时无法打开。`,
          code: 'EXTENSION_MENU_ACTIVATION_FAILED',
        });
      } catch {
        // A disposed session or document-less Core is already covered by diagnostics.
      }
    } finally {
      entry.busy = false;
      if (button.isConnected || button.parentElement !== null) {
        button.removeAttribute('aria-busy');
        button.removeAttribute('aria-disabled');
      }
    }
  }
}

export const SS_HELPER_EXTENSION_MENU_GROUP_ID = GROUP_ID;
