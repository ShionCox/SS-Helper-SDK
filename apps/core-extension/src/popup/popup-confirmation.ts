import type { PopupConfirmationOptions } from '@ss-helper/sdk';
import { createIconElement } from '../ui/icon-element.js';

export interface MountedPopupConfirmation {
  readonly result: Promise<boolean>;
  dispose(): void;
}

export function mountPopupConfirmation(document: Document, options: PopupConfirmationOptions): MountedPopupConfirmation {
  const previous = document.activeElement as HTMLElement | null;
  const overlay = document.createElement('div');
  overlay.className = 'stx-popup-confirm-overlay';
  overlay.setAttribute('role', 'presentation');
  const dialog = document.createElement('section');
  dialog.className = 'stx-popup-confirm';
  dialog.setAttribute('role', options.danger === true ? 'alertdialog' : 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  const titleId = `stx-popup-confirm-title-${crypto.randomUUID()}`;
  const messageId = `stx-popup-confirm-message-${crypto.randomUUID()}`;
  dialog.setAttribute('aria-labelledby', titleId);
  dialog.setAttribute('aria-describedby', messageId);
  const icon = createIconElement(document, options.danger === true ? 'triangle-exclamation' : 'circle-question', { decorative: true, fixedWidth: true });
  const copy = document.createElement('div');
  const title = document.createElement('h3');
  title.id = titleId;
  title.textContent = options.title;
  const message = document.createElement('p');
  message.id = messageId;
  message.textContent = options.message;
  copy.append(title, message);
  const actions = document.createElement('div');
  actions.className = 'stx-popup-confirm-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'stx-ui-btn stx-ui-btn-neutral';
  cancel.dataset.ssHelperControl = 'button';
  cancel.textContent = '取消';
  const confirm = document.createElement('button');
  confirm.type = 'button';
  confirm.className = `stx-ui-btn stx-ui-btn-${options.danger === true ? 'danger' : 'primary'}`;
  confirm.dataset.ssHelperControl = 'button';
  confirm.textContent = options.confirmLabel ?? '确认';
  actions.append(cancel, confirm);
  dialog.append(icon, copy, actions);
  overlay.append(dialog);
  document.body.append(overlay);

  let active = true;
  let resolveResult: (value: boolean) => void = () => undefined;
  const result = new Promise<boolean>((resolve) => { resolveResult = resolve; });
  const settle = (value: boolean): void => {
    if (!active) return;
    active = false;
    dialog.removeEventListener('keydown', onKeyDown);
    overlay.removeEventListener('click', onOverlayClick);
    overlay.remove();
    resolveResult(value);
    previous?.focus();
  };
  const onOverlayClick = (event: Event): void => { if (event.target === overlay) settle(false); };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') { event.preventDefault(); settle(false); return; }
    if (event.key !== 'Tab') return;
    if (event.shiftKey && document.activeElement === cancel) { event.preventDefault(); confirm.focus(); }
    else if (!event.shiftKey && document.activeElement === confirm) { event.preventDefault(); cancel.focus(); }
  };
  cancel.addEventListener('click', () => settle(false));
  confirm.addEventListener('click', () => settle(true));
  overlay.addEventListener('click', onOverlayClick);
  dialog.addEventListener('keydown', onKeyDown);
  confirm.focus();
  return { result, dispose: () => settle(false) };
}
