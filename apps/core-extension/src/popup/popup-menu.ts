import type { PopupMenuHandle, PopupMenuItem, PopupMenuOptions } from '@ss-helper/sdk';
import { createIconElement } from '../ui/icon-element.js';

export function createPopupMenu(document: Document, options: PopupMenuOptions): PopupMenuHandle {
  const shell = document.createElement('span');
  shell.className = 'stx-popup-menu';
  shell.dataset.ssHelperControl = 'menu';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'stx-ui-btn stx-ui-btn-neutral stx-popup-menu-trigger';
  trigger.dataset.ssHelperControl = 'button';
  trigger.dataset.ssHelperSize = 'sm';
  trigger.dataset.ssHelperIconOnly = 'true';
  trigger.setAttribute('aria-label', options.label);
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.append(createIconElement(document, 'ellipsis-vertical', { decorative: true }));
  shell.append(trigger);

  let items = [...options.items];
  let menu: HTMLElement | undefined;
  let active = true;
  let busy = false;
  const view = document.defaultView;

  const close = (restoreFocus = false): void => {
    if (menu === undefined) return;
    menu.remove();
    menu = undefined;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  };

  const position = (): void => {
    if (menu === undefined || typeof trigger.getBoundingClientRect !== 'function') return;
    const rect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const viewportWidth = view?.innerWidth ?? rect.right + menuRect.width + 8;
    const viewportHeight = view?.innerHeight ?? rect.bottom + menuRect.height + 8;
    const left = Math.max(8, Math.min(viewportWidth - menuRect.width - 8, rect.right - menuRect.width));
    const below = rect.bottom + 6;
    const top = below + menuRect.height <= viewportHeight - 8
      ? below
      : Math.max(8, rect.top - menuRect.height - 6);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  };

  const invoke = async (item: PopupMenuItem, button: HTMLButtonElement): Promise<void> => {
    if (busy || item.disabled === true) return;
    busy = true;
    button.setAttribute('aria-busy', 'true');
    try {
      await options.onSelect(item.id);
      close(true);
    } finally {
      busy = false;
      button.removeAttribute('aria-busy');
    }
  };

  const renderMenu = (): HTMLElement => {
    const list = document.createElement('div');
    list.className = 'stx-popup-menu-list';
    list.setAttribute('role', 'menu');
    list.setAttribute('aria-label', options.label);
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'stx-popup-menu-item';
      button.setAttribute('role', 'menuitem');
      button.dataset.tone = item.tone ?? 'neutral';
      button.disabled = item.disabled === true;
      if (item.separatorBefore === true) button.dataset.separatorBefore = 'true';
      if (item.disabledReason !== undefined) button.title = item.disabledReason;
      if (item.icon !== undefined) button.append(createIconElement(document, item.icon, { decorative: true, fixedWidth: true }));
      const label = document.createElement('span');
      label.textContent = item.label;
      button.append(label);
      button.addEventListener('click', () => { void invoke(item, button); });
      list.append(button);
    }
    list.addEventListener('keydown', (event) => {
      const buttons = [...list.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      if (event.key === 'Home') buttons[0]?.focus();
      else if (event.key === 'End') buttons.at(-1)?.focus();
      else {
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        buttons[(Math.max(0, index) + delta + buttons.length) % buttons.length]?.focus();
      }
    });
    return list;
  };

  const open = (): void => {
    if (!active || menu !== undefined) return;
    menu = renderMenu();
    document.body.append(menu);
    trigger.setAttribute('aria-expanded', 'true');
    position();
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  };

  const toggle = (): void => { if (menu === undefined) open(); else close(true); };
  const onWindowPointerDown = (event: Event): void => {
    const target = event.target as Node | null;
    if (target !== null && !shell.contains(target) && menu !== undefined && !menu.contains(target)) close();
  };
  const onWindowResize = (): void => position();
  trigger.addEventListener('click', toggle);
  trigger.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    } else if (event.key === 'Escape') close(true);
  });
  view?.addEventListener('pointerdown', onWindowPointerDown, true);
  view?.addEventListener('resize', onWindowResize);
  view?.addEventListener('scroll', onWindowResize, true);

  return {
    element: shell,
    update(nextItems) {
      items = [...nextItems];
      const wasOpen = menu !== undefined;
      close();
      if (wasOpen) open();
    },
    dispose() {
      if (!active) return;
      active = false;
      close();
      trigger.removeEventListener('click', toggle);
      view?.removeEventListener('pointerdown', onWindowPointerDown, true);
      view?.removeEventListener('resize', onWindowResize);
      view?.removeEventListener('scroll', onWindowResize, true);
      shell.remove();
    },
  };
}
