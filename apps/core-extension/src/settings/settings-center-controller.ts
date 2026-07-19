export const SETTINGS_CENTER_OVERLAY_ID = 'ss-helper-settings-center-overlay';
export const SETTINGS_CENTER_ID = 'ss-helper-settings-center';

type Renderer = (dialog: HTMLElement) => void;

export class SettingsCenterController {
  #overlay: HTMLElement | undefined;
  #dialog: HTMLElement | undefined;
  #renderer: Renderer | undefined;
  #previousFocus: HTMLElement | undefined;
  #previousBodyOverflow = '';
  #onBeforeClose: (() => void) | undefined;

  constructor(private readonly document: Document) {}

  get open(): boolean { return this.#overlay !== undefined; }

  show(renderer: Renderer, onBeforeClose?: () => void): void {
    this.#renderer = renderer;
    this.#onBeforeClose = onBeforeClose;
    if (this.#overlay !== undefined && this.#dialog !== undefined) {
      this.render();
      return;
    }

    const existing = this.document.getElementById(SETTINGS_CENTER_OVERLAY_ID);
    existing?.remove();
    this.#previousFocus = this.document.activeElement instanceof HTMLElement ? this.document.activeElement : undefined;
    this.#previousBodyOverflow = this.document.body.style.overflow;
    this.document.body.style.overflow = 'hidden';

    const overlay = this.document.createElement('div');
    overlay.id = SETTINGS_CENTER_OVERLAY_ID;
    overlay.dataset.ssHelperSettingsCenter = 'true';
    overlay.setAttribute('role', 'presentation');
    const dialog = this.document.createElement('section');
    dialog.id = SETTINGS_CENTER_ID;
    dialog.className = 'stx-center-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'SS-Helper 设置中心');
    dialog.tabIndex = -1;
    overlay.append(dialog);
    this.document.body.append(overlay);
    this.#overlay = overlay;
    this.#dialog = dialog;

    overlay.addEventListener('click', this.#onOverlayClick);
    dialog.addEventListener('keydown', this.#onKeyDown);
    this.render();
    (dialog.querySelector<HTMLElement>('[autofocus], button, input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? dialog).focus();
  }

  render(renderer?: Renderer): void {
    if (renderer !== undefined) this.#renderer = renderer;
    const dialog = this.#dialog;
    const activeId = this.document.activeElement instanceof HTMLElement && dialog?.contains(this.document.activeElement)
      ? this.document.activeElement.id
      : '';
    if (dialog === undefined || this.#renderer === undefined) return;
    // Settings are deliberately re-rendered after adapter updates. Keep each
    // scroll container at the same position so an autosave never sends users
    // back to the beginning of a long settings page.
    const scrollPositions = [...dialog.querySelectorAll<HTMLElement>('.stx-center-scroll')]
      .map((node) => ({ top: node.scrollTop, left: node.scrollLeft }));
    dialog.replaceChildren();
    this.#renderer(dialog);
    if (activeId !== '') this.document.getElementById(activeId)?.focus();
    const scrollContainers = [...dialog.querySelectorAll<HTMLElement>('.stx-center-scroll')];
    for (const [index, position] of scrollPositions.entries()) {
      const container = scrollContainers[index];
      if (container === undefined) continue;
      container.scrollTop = position.top;
      container.scrollLeft = position.left;
    }
  }

  close = (): void => {
    const overlay = this.#overlay;
    const dialog = this.#dialog;
    if (overlay === undefined || dialog === undefined) return;
    this.#onBeforeClose?.();
    overlay.removeEventListener('click', this.#onOverlayClick);
    dialog.removeEventListener('keydown', this.#onKeyDown);
    overlay.remove();
    this.document.body.style.overflow = this.#previousBodyOverflow;
    this.#overlay = undefined;
    this.#dialog = undefined;
    this.#renderer = undefined;
    this.#onBeforeClose = undefined;
    this.#previousFocus?.focus();
    this.#previousFocus = undefined;
  };

  dispose(): void { this.close(); }

  #onOverlayClick = (event: MouseEvent): void => {
    if (event.target === this.#overlay) this.close();
  };

  #onKeyDown = (event: KeyboardEvent): void => {
    const dialog = this.#dialog;
    if (dialog === undefined) return;
    if (event.key === 'Escape') { event.preventDefault(); this.close(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((node) => !node.hasAttribute('disabled') && !node.hidden);
    if (focusable.length === 0) { event.preventDefault(); dialog.focus(); return; }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && this.document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && this.document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
}
