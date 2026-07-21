const ICON_TAG = 'ss-helper-icon';
const ICON_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MAX_ICON_NAME_LENGTH = 64;

export interface IconOptions {
  readonly decorative?: boolean;
  readonly fixedWidth?: boolean;
  readonly label?: string;
  readonly title?: string;
  readonly className?: string;
}

function safeIconName(value: string): string | undefined {
  const name = value.trim().toLowerCase();
  return name.length > 0 && name.length <= MAX_ICON_NAME_LENGTH && ICON_NAME.test(name) ? name : undefined;
}

function synchronizeIcon(element: HTMLElement): void {
  const rawName = element.getAttribute('name') ?? '';
  const name = safeIconName(rawName);
  if (name === undefined) element.setAttribute('data-ss-helper-icon-invalid', 'true');
  else {
    if (rawName !== name) element.setAttribute('name', name);
    element.removeAttribute('data-ss-helper-icon-invalid');
  }
  if (element.hasAttribute('decorative')) {
    element.setAttribute('aria-hidden', 'true');
    element.removeAttribute('role');
    element.removeAttribute('aria-label');
    return;
  }
  const label = element.getAttribute('label')?.trim();
  element.removeAttribute('aria-hidden');
  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', label || '图标');
  if (!label) element.setAttribute('data-ss-helper-icon-label-missing', 'true');
  else element.removeAttribute('data-ss-helper-icon-label-missing');
}

export function createIconElement(document: Document, name: string, options: IconOptions = {}): HTMLElement {
  const icon = document.createElement(ICON_TAG);
  icon.setAttribute('name', safeIconName(name) ?? name);
  if (options.decorative ?? options.label === undefined) icon.setAttribute('decorative', '');
  if (options.fixedWidth) icon.setAttribute('fixed-width', '');
  if (options.label !== undefined) icon.setAttribute('label', options.label);
  if (options.title !== undefined) icon.setAttribute('title', options.title);
  if (options.className !== undefined) icon.className = options.className;
  synchronizeIcon(icon);
  return icon;
}

export function ensureIconElement(document: Document | undefined): boolean {
  const view = document?.defaultView;
  const registry = view?.customElements ?? globalThis.customElements;
  const HTMLElementConstructor = view?.HTMLElement ?? globalThis.HTMLElement;
  if (registry === undefined || HTMLElementConstructor === undefined) return false;
  if (registry.get(ICON_TAG) !== undefined) return true;
  try {
    class SSHelperIconElement extends HTMLElementConstructor {
      static get observedAttributes(): string[] { return ['name', 'label', 'decorative']; }
      connectedCallback(): void { synchronizeIcon(this); }
      attributeChangedCallback(): void { synchronizeIcon(this); }
    }
    registry.define(ICON_TAG, SSHelperIconElement);
    return true;
  } catch {
    return registry.get(ICON_TAG) !== undefined;
  }
}

export const SS_HELPER_ICON_TAG = ICON_TAG;
