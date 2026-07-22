import { SSHelperError, type ToastLevel, type ToastNotification } from '@ss-helper/sdk';
import { assertPayload } from '../communication/contracts.js';
import type { DiagnosticsStore } from '../diagnostics/diagnostics-store.js';
import type { SessionScope } from '../plugins/session-scope.js';
import { ensureCoreUiStyles } from '../styles/settings-styles.js';
import { createIconElement } from '../ui/icon-element.js';

const MAX_TOASTS = 5;
const DEFAULT_DURATIONS: Readonly<Record<ToastLevel, number>> = Object.freeze({
  info: 4_500,
  success: 4_500,
  warning: 7_000,
  error: 0,
});
const ICONS: Readonly<Record<ToastLevel, string>> = Object.freeze({
  info: 'circle-info',
  success: 'circle-check',
  warning: 'triangle-exclamation',
  error: 'circle-exclamation',
});

interface ToastEntry {
  readonly pluginId: string;
  readonly code?: string;
  readonly element: HTMLElement;
  readonly dismiss: () => void;
  durationMs: number;
  remainingMs: number;
  startedAt: number;
  timer: ReturnType<typeof setTimeout> | undefined;
}

function validateNotification(input: ToastNotification): Readonly<ToastNotification> {
  assertPayload(input, undefined, 'toast_notification');
  const record = input as unknown as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['level', 'message', 'title', 'code', 'durationMs'].includes(key))
    || !['info', 'success', 'warning', 'error'].includes(input.level)
    || typeof input.message !== 'string' || input.message.trim().length === 0 || input.message.length > 300
    || (input.title !== undefined && (typeof input.title !== 'string' || input.title.trim().length === 0 || input.title.length > 80))
    || (input.code !== undefined && (typeof input.code !== 'string' || !/^[A-Za-z0-9_.-]{1,64}$/u.test(input.code)))
    || (input.durationMs !== undefined && (!Number.isSafeInteger(input.durationMs) || (input.durationMs !== 0 && (input.durationMs < 1_500 || input.durationMs > 30_000))))) {
    throw new SSHelperError('PAYLOAD_INVALID', 'The toast notification is invalid', { reason: 'toast_notification' });
  }
  return Object.freeze({ ...input, message: input.message.trim(), ...(input.title === undefined ? {} : { title: input.title.trim() }) });
}

export class ToastHost {
  readonly #entries: ToastEntry[] = [];
  #root: HTMLElement | undefined;
  #expanded = false;
  #pointerInside = false;
  #focusInside = false;

  constructor(private readonly document: Document | undefined, private readonly diagnostics: DiagnosticsStore) {
    if (document !== undefined) ensureCoreUiStyles(document);
  }

  show(scope: SessionScope, notification: ToastNotification): void {
    scope.assertActive();
    const input = validateNotification(notification);
    const document = this.document;
    if (document === undefined) throw new SSHelperError('CAPABILITY_NOT_GRANTED', 'Toast notifications require a document', { capability: 'core.ui.notification.v0' });
    if (input.code !== undefined) this.#entries.find((entry) => entry.pluginId === scope.id && entry.code === input.code)?.dismiss();

    const root = this.#ensureRoot(document);
    const element = document.createElement('article');
    element.className = `stx-toast stx-toast-${input.level}`;
    element.dataset.toastPlugin = scope.id;
    if (input.code !== undefined) element.dataset.toastCode = input.code;
    element.setAttribute('role', input.level === 'warning' || input.level === 'error' ? 'alert' : 'status');

    const icon = createIconElement(document, ICONS[input.level], { decorative: true, className: 'stx-toast-icon' });
    const content = document.createElement('div'); content.className = 'stx-toast-content';
    if (input.title !== undefined) { const title = document.createElement('strong'); title.className = 'stx-toast-title'; title.textContent = input.title; content.append(title); }
    const message = document.createElement('p'); message.className = 'stx-toast-message'; message.textContent = input.message; content.append(message);
    const close = document.createElement('button'); close.type = 'button'; close.className = 'stx-toast-close'; close.setAttribute('aria-label', '关闭通知');
    close.append(createIconElement(document, 'xmark', { decorative: true }));
    element.append(icon, content, close);

    const durationMs = input.durationMs ?? DEFAULT_DURATIONS[input.level];
    let active = true;
    let removeScopeCleanup = (): void => undefined;
    const entry: ToastEntry = {
      pluginId: scope.id,
      ...(input.code === undefined ? {} : { code: input.code }),
      element,
      durationMs,
      remainingMs: durationMs,
      startedAt: Date.now(),
      timer: undefined,
      dismiss: () => removeScopeCleanup(),
    };
    const cleanup = (): void => {
      if (!active) return;
      active = false;
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      const index = this.#entries.indexOf(entry); if (index >= 0) this.#entries.splice(index, 1);
      element.remove();
      if (this.#entries.length === 0) {
        this.#root?.remove(); this.#root = undefined; this.#expanded = false; this.#pointerInside = false; this.#focusInside = false;
      }
    };
    removeScopeCleanup = scope.addCleanup(cleanup);
    close.addEventListener('click', (event) => { event.stopPropagation(); entry.dismiss(); });
    root.prepend(element);
    this.#entries.unshift(entry);
    this.#schedule(entry);
    while (this.#entries.length > MAX_TOASTS) this.#entries.at(-1)?.dismiss();
    this.diagnostics.record({ type: 'ui.notification', pluginId: scope.id, ...(input.code === undefined ? {} : { code: input.code }) });
  }

  #ensureRoot(document: Document): HTMLElement {
    if (this.#root !== undefined) return this.#root;
    const root = document.createElement('section'); root.id = 'ss-helper-toast-root'; root.setAttribute('aria-label', '通知');
    root.addEventListener('pointerenter', () => { this.#pointerInside = true; this.#pauseAll(); });
    root.addEventListener('pointerleave', () => { this.#pointerInside = false; this.#resumeAll(); });
    root.addEventListener('focusin', () => { this.#focusInside = true; this.#pauseAll(); });
    root.addEventListener('focusout', (event: FocusEvent) => {
      if (event.relatedTarget instanceof HTMLElement && root.contains(event.relatedTarget)) return;
      this.#focusInside = false;
      this.#resumeAll();
    });
    root.addEventListener('click', (event) => {
      let target = event.target instanceof HTMLElement ? event.target : undefined;
      while (target !== undefined && target !== root) { if (target.tagName === 'BUTTON') return; target = target.parentElement ?? undefined; }
      this.#expanded = !this.#expanded;
      root.dataset.expanded = String(this.#expanded);
      if (this.#expanded) this.#pauseAll(); else this.#resumeAll();
    });
    document.body.append(root); this.#root = root; return root;
  }

  #schedule(entry: ToastEntry): void {
    if (entry.remainingMs <= 0 || entry.timer !== undefined || this.#expanded || this.#pointerInside || this.#focusInside) return;
    entry.startedAt = Date.now();
    entry.timer = setTimeout(entry.dismiss, entry.remainingMs);
  }

  #pauseAll(): void {
    for (const entry of this.#entries) {
      if (entry.timer === undefined) continue;
      clearTimeout(entry.timer); entry.timer = undefined;
      entry.remainingMs = Math.max(0, entry.remainingMs - (Date.now() - entry.startedAt));
    }
  }

  #resumeAll(): void {
    if (this.#expanded || this.#pointerInside || this.#focusInside) return;
    for (const entry of this.#entries) this.#schedule(entry);
  }

  dispose(): void {
    for (const entry of [...this.#entries]) entry.dismiss();
    this.#root?.remove(); this.#root = undefined; this.#expanded = false; this.#pointerInside = false; this.#focusInside = false;
  }
}
