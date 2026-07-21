import { SSHelperError, type PlainData, type PopupRegistration, type PopupToken } from '@ss-helper/sdk';
import type { SessionScope } from '../plugins/session-scope.js';
import { assertPayload } from '../communication/contracts.js';
import { ensureCoreUiStyles } from '../styles/settings-styles.js';
import { PopupUiController } from './popup-ui-context.js';
import { createIconElement } from '../ui/icon-element.js';

function key(token: PopupToken): string { return JSON.stringify([token.provider, token.name, token.version]); }

const POPUP_SIZE_STORAGE_PREFIX = 'ss-helper.popup-size:';

interface PopupSize { readonly width: number; readonly height: number }

export class PopupHost {
  readonly #entries = new Map<string, { readonly scope: SessionScope; readonly registration: PopupRegistration }>();
  readonly #open = new Map<string, () => void>();
  constructor(private readonly document?: Document) { if (document !== undefined) ensureCoreUiStyles(document); }

  register(scope: SessionScope, registration: PopupRegistration): () => void {
    scope.assertActive();
    const presentation = registration.presentation ?? 'default';
    if (
      registration.token.provider !== scope.id
      || registration.token.kind !== 'popup'
      || registration.title.trim() === ''
      || (registration.closeLabel !== undefined && registration.closeLabel.trim() === '')
      || (presentation !== 'default' && presentation !== 'workspace')
    ) {
      throw new SSHelperError('PAYLOAD_INVALID', 'The popup registration is invalid', { reason: 'popup_registration' });
    }
    const id = key(registration.token);
    if (this.#entries.has(id)) throw new SSHelperError('PAYLOAD_INVALID', 'The popup is already registered', { reason: 'duplicate_popup' });
    this.#entries.set(id, { scope, registration });
    return scope.addCleanup(() => { this.#open.get(id)?.(); this.#entries.delete(id); });
  }

  open<Input extends PlainData>(scope: SessionScope, token: PopupToken<Input>, input: Input, restoreFocus?: HTMLElement): void {
    scope.assertActive();
    assertPayload(input, undefined, 'popup_input');
    const id = key(token);
    const entry = this.#entries.get(id);
    if (entry === undefined) throw new SSHelperError('PAYLOAD_INVALID', 'The popup is not registered', { reason: 'unknown_popup' });
    const document = this.document;
    if (document === undefined) throw new SSHelperError('BRIDGE_CORRUPTED', 'The popup host has no document');
    this.#open.get(id)?.();
    const activeElement = document.activeElement as HTMLElement | null;
    const previous = restoreFocus ?? (activeElement !== null && typeof activeElement.focus === 'function' ? activeElement : undefined);
    const previousId = previous?.id;
    const overlay = document.createElement('div');
    overlay.dataset.ssHelperPopup = id;
    overlay.setAttribute('role', 'presentation');
    const dialog = document.createElement('section');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', entry.registration.ariaLabel ?? entry.registration.title);
    dialog.dataset.presentation = entry.registration.presentation ?? 'default';
    dialog.tabIndex = -1;
    const header = document.createElement('div');
    header.dataset.popupHeader = 'true';
    const heading = document.createElement('h2'); heading.textContent = entry.registration.title;
    const closeButton = document.createElement('button'); closeButton.type = 'button'; closeButton.setAttribute('aria-label', entry.registration.closeLabel ?? `关闭 ${entry.registration.title}`);
    closeButton.append(createIconElement(document, 'xmark', { decorative: true }));
    header.append(heading, closeButton);
    const content = document.createElement('div');
    content.dataset.popupContent = 'true';
    dialog.append(header, content);
    const resizeHandle = dialog.dataset.presentation === 'workspace' ? document.createElement('button') : undefined;
    if (resizeHandle !== undefined) {
      resizeHandle.type = 'button';
      resizeHandle.dataset.popupResizeHandle = 'true';
      resizeHandle.setAttribute('aria-label', '调整窗口大小');
      resizeHandle.title = '拖拽或使用方向键调整窗口大小';
      dialog.append(resizeHandle);
    }
    overlay.append(dialog); document.body.append(overlay);
    let close: () => void = () => undefined;
    const popupUi = new PopupUiController(content, () => close());
    let active = true;
    let renderCleanup: void | (() => void);
    let removeScopeCleanup = (): void => undefined;
    let onKeyDown: (event: KeyboardEvent) => void = () => undefined;
    let removeResizeListeners = (): void => undefined;
    let onResizePointerDown: (event: PointerEvent) => void = () => undefined;
    let onResizeKeyDown: (event: KeyboardEvent) => void = () => undefined;
    const popupSizeStorageKey = `${POPUP_SIZE_STORAGE_PREFIX}${id}`;
    const isCompactWorkspace = (): boolean => {
      const view = document.defaultView;
      return view?.matchMedia?.('(max-width: 680px)').matches ?? (view?.innerWidth ?? 681) <= 680;
    };
    const readPopupSize = (): PopupSize | undefined => {
      if (resizeHandle === undefined || isCompactWorkspace()) return undefined;
      try {
        const raw = document.defaultView?.localStorage?.getItem(popupSizeStorageKey);
        if (raw === null || raw === undefined) return undefined;
        const parsed: unknown = JSON.parse(raw);
        if (
          typeof parsed !== 'object' || parsed === null
          || !Object.hasOwn(parsed, 'width') || !Object.hasOwn(parsed, 'height')
        ) return undefined;
        const { width, height } = parsed as Record<string, unknown>;
        return typeof width === 'number' && Number.isFinite(width) && width > 0
          && typeof height === 'number' && Number.isFinite(height) && height > 0
          ? { width, height }
          : undefined;
      } catch { return undefined; }
    };
    const persistPopupSize = (): void => {
      if (resizeHandle === undefined || isCompactWorkspace()) return;
      try {
        const rect = dialog.getBoundingClientRect();
        document.defaultView?.localStorage?.setItem(popupSizeStorageKey, JSON.stringify({
          width: Math.round(rect.width), height: Math.round(rect.height),
        }));
      } catch { /* unavailable or full browser storage must not block the popup */ }
    };
    const restorePreviousFocus = (): void => {
      const target = previous !== undefined && previous.isConnected !== false
        ? previous
        : previousId === undefined || previousId === ''
          ? undefined
          : document.getElementById(previousId);
      target?.focus();
    };
    close = (): void => {
      if (!active) return;
      active = false;
      dialog.removeEventListener('keydown', onKeyDown);
      closeButton.removeEventListener('click', close);
      removeResizeListeners();
      resizeHandle?.removeEventListener('pointerdown', onResizePointerDown);
      resizeHandle?.removeEventListener('keydown', onResizeKeyDown);
      this.#open.delete(id);
      try { if (typeof renderCleanup === 'function') renderCleanup(); }
      finally {
        popupUi.dispose();
        overlay.remove();
        try { removeScopeCleanup(); }
        finally {
          restorePreviousFocus();
          queueMicrotask(restorePreviousFocus);
          document.defaultView?.requestAnimationFrame?.(restorePreviousFocus);
        }
      }
    };
    onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter((node) => !node.hasAttribute('disabled'));
      if (focusable.length === 0) { event.preventDefault(); dialog.focus(); return; }
      const first = focusable[0]!; const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const resizeTo = (width: number, height: number): void => {
      const view = document.defaultView;
      const computed = view?.getComputedStyle?.(dialog);
      const minWidth = Number.parseFloat(computed?.minWidth ?? '') || 0;
      const minHeight = Number.parseFloat(computed?.minHeight ?? '') || 0;
      const maxWidth = Math.max(minWidth, (view?.innerWidth ?? width + 32) - 32);
      const maxHeight = Math.max(minHeight, (view?.innerHeight ?? height + 32) - 32);
      dialog.style.width = `${Math.min(maxWidth, Math.max(minWidth, width))}px`;
      dialog.style.height = `${Math.min(maxHeight, Math.max(minHeight, height))}px`;
    };
    if (resizeHandle !== undefined) {
      onResizePointerDown = (event: PointerEvent): void => {
        if (event.button !== 0) return;
        event.preventDefault();
        const view = document.defaultView;
        if (view === null || view === undefined) return;
        removeResizeListeners();
        const initial = dialog.getBoundingClientRect();
        const startX = event.clientX;
        const startY = event.clientY;
        const onPointerMove = (moveEvent: PointerEvent): void => resizeTo(initial.width + moveEvent.clientX - startX, initial.height + moveEvent.clientY - startY);
        const onPointerUp = (): void => { persistPopupSize(); removeResizeListeners(); };
        removeResizeListeners = (): void => {
          view.removeEventListener('pointermove', onPointerMove);
          view.removeEventListener('pointerup', onPointerUp);
          view.removeEventListener('pointercancel', onPointerUp);
          removeResizeListeners = (): void => undefined;
        };
        view.addEventListener('pointermove', onPointerMove);
        view.addEventListener('pointerup', onPointerUp);
        view.addEventListener('pointercancel', onPointerUp);
      };
      onResizeKeyDown = (event: KeyboardEvent): void => {
        const directions: Partial<Record<string, readonly [number, number]>> = {
          ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
        };
        const direction = directions[event.key];
        if (direction === undefined) return;
        event.preventDefault();
        const rect = dialog.getBoundingClientRect();
        const step = event.shiftKey ? 40 : 10;
        resizeTo(rect.width + direction[0] * step, rect.height + direction[1] * step);
        persistPopupSize();
      };
      resizeHandle.addEventListener('pointerdown', onResizePointerDown);
      resizeHandle.addEventListener('keydown', onResizeKeyDown);
      const storedSize = readPopupSize();
      if (storedSize !== undefined) resizeTo(storedSize.width, storedSize.height);
    }
    try {
      renderCleanup = entry.registration.render(content, input, popupUi);
      popupUi.refreshControls();
      closeButton.addEventListener('click', close, { once: true });
      dialog.addEventListener('keydown', onKeyDown);
      this.#open.set(id, close);
      removeScopeCleanup = scope.addCleanup(close);
      (dialog.querySelector<HTMLElement>('[autofocus], button, input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? dialog).focus();
    } catch (error) {
      try { close(); } catch { /* rollback must not hide the approved renderer error */ }
      if (error instanceof SSHelperError) throw error;
      throw new SSHelperError('PAYLOAD_INVALID', 'The popup renderer failed', { reason: 'popup_renderer' });
    }
  }

  dispose(): void { for (const close of [...this.#open.values()]) close(); this.#entries.clear(); }
}
