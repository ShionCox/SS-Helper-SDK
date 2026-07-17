import { SSHelperError, type PlainData, type PopupRegistration, type PopupToken } from '@ss-helper/sdk';
import type { SessionScope } from '../plugins/session-scope.js';
import { assertPayload } from '../communication/contracts.js';
import { ensureCoreUiStyles } from '../styles/settings-styles.js';

function key(token: PopupToken): string { return JSON.stringify([token.provider, token.name, token.version]); }

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
      || (presentation !== 'default' && presentation !== 'workspace')
    ) {
      throw new SSHelperError('PAYLOAD_INVALID', 'The popup registration is invalid', { reason: 'popup_registration' });
    }
    const id = key(registration.token);
    if (this.#entries.has(id)) throw new SSHelperError('PAYLOAD_INVALID', 'The popup is already registered', { reason: 'duplicate_popup' });
    this.#entries.set(id, { scope, registration });
    return scope.addCleanup(() => { this.#open.get(id)?.(); this.#entries.delete(id); });
  }

  open<Input extends PlainData>(scope: SessionScope, token: PopupToken<Input>, input: Input): void {
    scope.assertActive();
    assertPayload(input, undefined, 'popup_input');
    const id = key(token);
    const entry = this.#entries.get(id);
    if (entry === undefined) throw new SSHelperError('PAYLOAD_INVALID', 'The popup is not registered', { reason: 'unknown_popup' });
    const document = this.document;
    if (document === undefined) throw new SSHelperError('BRIDGE_CORRUPTED', 'The popup host has no document');
    this.#open.get(id)?.();
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
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
    const closeButton = document.createElement('button'); closeButton.type = 'button'; closeButton.textContent = 'Close'; closeButton.setAttribute('aria-label', `Close ${entry.registration.title}`);
    header.append(heading, closeButton);
    const content = document.createElement('div');
    content.dataset.popupContent = 'true';
    dialog.append(header, content); overlay.append(dialog); document.body.append(overlay);
    let active = true;
    let renderCleanup: void | (() => void);
    let removeScopeCleanup = (): void => undefined;
    let onKeyDown: (event: KeyboardEvent) => void = () => undefined;
    const close = (): void => {
      if (!active) return;
      active = false;
      dialog.removeEventListener('keydown', onKeyDown);
      closeButton.removeEventListener('click', close);
      this.#open.delete(id);
      try { if (typeof renderCleanup === 'function') renderCleanup(); }
      finally {
        overlay.remove();
        try { removeScopeCleanup(); }
        finally { previous?.focus(); }
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
    try {
      renderCleanup = entry.registration.render(content, input);
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
