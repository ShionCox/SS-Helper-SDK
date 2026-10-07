import {
  createSSHelperError,
  UI_CONTROL_ATTRIBUTE,
  type PopupButtonOptions,
  type PopupConfirmationOptions,
  type PopupIconOptions,
  type PopupInputOptions,
  type PopupMenuHandle,
  type PopupMenuOptions,
  type PopupListDefinition,
  type PopupListHandle,
  type PopupSelectOptions,
  type PopupTextareaOptions,
  type PopupToggleOptions,
  type PopupWizardAdapter,
  type PopupWizardDefinition,
  type PopupWizardHandle,
  type PopupUiContext,
} from '@ss-helper/sdk';
import { createSelectControl } from '../ui/select-control.js';
import { createIconElement } from '../ui/icon-element.js';
import { mountPopupConfirmation, type MountedPopupConfirmation } from './popup-confirmation.js';
import { createPopupMenu } from './popup-menu.js';
import { mountPopupList, type MountedPopupList } from './popup-list.js';
import { mountPopupWizard, type MountedPopupWizard } from './popup-wizard.js';

interface EnhancedSelect {
  readonly select: HTMLSelectElement;
  readonly shell: HTMLElement;
  readonly hidden: boolean;
  readonly tabIndex: number;
  readonly ariaHidden: string | null;
}

let popupSelectSequence = 0;
let popupControlSequence = 0;

function descendants(root: HTMLElement): HTMLElement[] {
  const result: HTMLElement[] = [];
  const visit = (node: HTMLElement): void => {
    for (const child of Array.from(node.children) as HTMLElement[]) {
      result.push(child);
      visit(child);
    }
  };
  visit(root);
  return result;
}

interface NativeSelectOption {
  readonly source: HTMLOptionElement;
  readonly value: string;
  readonly label: string;
  readonly description?: string | undefined;
  readonly group?: string | undefined;
}

function nativeSelectOptions(select: HTMLSelectElement): NativeSelectOption[] {
  const options: NativeSelectOption[] = [];
  const appendOption = (node: HTMLElement, group?: string): void => {
    if (node.tagName !== 'OPTION') return;
    const source = node as HTMLOptionElement;
    const description = node.getAttribute('data-ss-helper-description')?.trim();
    options.push({
      source,
      value: source.value,
      label: node.textContent ?? '',
      ...(description ? { description } : {}),
      ...(group?.trim() ? { group: group.trim() } : {}),
    });
  };
  for (const child of Array.from(select.children) as HTMLElement[]) {
    if (child.tagName === 'OPTION') appendOption(child);
    else if (child.tagName === 'OPTGROUP') {
      const group = child.getAttribute('label') ?? '';
      for (const option of Array.from(child.children) as HTMLElement[]) appendOption(option, group);
    }
  }
  return options;
}

function selectedValue(select: HTMLSelectElement, options: readonly NativeSelectOption[]): string | undefined {
  if (options.some((option) => option.value === select.value)) return select.value;
  const selected = options.find((option) => option.source.selected);
  return selected?.value ?? options[0]?.value;
}

function dispatchChange(select: HTMLSelectElement): void {
  const EventConstructor = select.ownerDocument.defaultView?.Event;
  if (EventConstructor === undefined) select.dispatchEvent({ type: 'change', bubbles: true } as Event);
  else select.dispatchEvent(new EventConstructor('change', { bubbles: true }));
}

export class PopupUiController implements PopupUiContext {
  readonly #enhanced = new Map<HTMLSelectElement, EnhancedSelect>();
  readonly #wizards = new Set<MountedPopupWizard>();
  readonly #menus = new Set<PopupMenuHandle>();
  readonly #confirmations = new Set<MountedPopupConfirmation>();
  readonly #lists = new Map<string, MountedPopupList<unknown>>();
  #listSweepScheduled = false;
  #active = true;

  constructor(private readonly container: HTMLElement, private readonly requestClose: () => void = () => undefined) {}

  close(): void {
    if (this.#active) this.requestClose();
  }

  async copyText(text: string): Promise<void> {
    if (!this.#active || typeof text !== 'string') {
      throw createSSHelperError('CLIPBOARD_WRITE_FAILED', { stage: 'core.ui.clipboard.write' });
    }
    try {
      const clipboard = this.container.ownerDocument.defaultView?.navigator.clipboard;
      if (clipboard?.writeText !== undefined) {
        await clipboard.writeText(text);
        return;
      }
      const textarea = this.container.ownerDocument.createElement('textarea');
      textarea.value = text;
      textarea.readOnly = true;
      textarea.setAttribute('aria-hidden', 'true');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      (this.container.ownerDocument.body ?? this.container.ownerDocument.documentElement).append(textarea);
      textarea.select();
      const copied = this.container.ownerDocument.execCommand?.('copy') === true;
      textarea.remove();
      if (!copied) throw new Error('clipboard unavailable');
    } catch {
      throw createSSHelperError('CLIPBOARD_WRITE_FAILED', { stage: 'core.ui.clipboard.write' });
    }
  }

  createButton(options: PopupButtonOptions): HTMLButtonElement {
    const button = this.container.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = `stx-ui-btn stx-ui-btn-${options.tone ?? 'neutral'}`;
    button.dataset.ssHelperControl = 'button';
    button.dataset.ssHelperSize = options.size ?? 'md';
    if (options.icon !== undefined) button.append(createIconElement(this.container.ownerDocument, options.icon, { decorative: true, fixedWidth: options.iconOnly !== true }));
    if (options.iconOnly !== true) {
      const label = this.container.ownerDocument.createElement('span');
      label.textContent = options.label;
      button.append(label);
    } else {
      button.dataset.ssHelperIconOnly = 'true';
      button.title = options.label;
    }
    button.setAttribute('aria-label', options.ariaLabel ?? options.label);
    button.disabled = options.disabled === true;
    return button;
  }

  createIcon(options: PopupIconOptions): HTMLElement {
    return createIconElement(this.container.ownerDocument, options.name, {
      decorative: options.decorative ?? options.label === undefined,
      ...(options.fixedWidth === undefined ? {} : { fixedWidth: options.fixedWidth }),
      ...(options.label === undefined ? {} : { label: options.label }),
    });
  }

  createInput(options: PopupInputOptions): HTMLInputElement {
    const input = this.container.ownerDocument.createElement('input');
    input.id = `ss-helper-popup-input-${++popupControlSequence}`;
    input.className = 'stx-ui-input';
    input.dataset.ssHelperControl = 'input';
    input.type = options.type ?? 'text';
    input.value = options.value ?? '';
    input.placeholder = options.placeholder ?? '';
    input.disabled = options.disabled === true;
    input.setAttribute('aria-label', options.label);
    return input;
  }

  createTextarea(options: PopupTextareaOptions): HTMLTextAreaElement {
    const textarea = this.container.ownerDocument.createElement('textarea');
    textarea.id = `ss-helper-popup-textarea-${++popupControlSequence}`;
    textarea.className = 'stx-ui-textarea';
    textarea.dataset.ssHelperControl = 'textarea';
    textarea.value = options.value ?? '';
    textarea.placeholder = options.placeholder ?? '';
    textarea.disabled = options.disabled === true;
    textarea.setAttribute('aria-label', options.label);
    return textarea;
  }

  createSelect(options: PopupSelectOptions): HTMLElement {
    return createSelectControl(this.container.ownerDocument, {
      id: `ss-helper-popup-select-${++popupControlSequence}`,
      ariaLabel: options.label,
      disabled: options.disabled,
      options: options.options,
      value: options.value,
      placeholder: options.placeholder,
      onSelect: options.onChange,
    });
  }

  createToggle(options: PopupToggleOptions): HTMLButtonElement {
    const toggle = this.container.ownerDocument.createElement('button');
    toggle.type = 'button';
    toggle.className = 'stx-popup-toggle';
    toggle.dataset.ssHelperControl = 'toggle';
    toggle.setAttribute('role', 'switch');
    toggle.setAttribute('aria-label', options.label);
    toggle.setAttribute('aria-checked', String(options.checked));
    toggle.disabled = options.disabled === true;
    toggle.addEventListener('click', async () => {
      if (toggle.disabled || toggle.getAttribute('aria-busy') === 'true') return;
      const next = toggle.getAttribute('aria-checked') !== 'true';
      toggle.setAttribute('aria-busy', 'true');
      try {
        await options.onChange(next);
        toggle.setAttribute('aria-checked', String(next));
      } finally {
        toggle.removeAttribute('aria-busy');
      }
    });
    return toggle;
  }

  createMenu(options: PopupMenuOptions): PopupMenuHandle {
    const menu = createPopupMenu(this.container.ownerDocument, options);
    this.#menus.add(menu);
    return {
      element: menu.element,
      update: (items) => menu.update(items),
      dispose: () => {
        menu.dispose();
        this.#menus.delete(menu);
      },
    };
  }

  async confirm(options: PopupConfirmationOptions): Promise<boolean> {
    if (!this.#active) return false;
    const confirmation = mountPopupConfirmation(this.container.ownerDocument, options);
    this.#confirmations.add(confirmation);
    try { return await confirmation.result; }
    finally { this.#confirmations.delete(confirmation); }
  }

  mountWizard(definition: PopupWizardDefinition, adapter: PopupWizardAdapter): PopupWizardHandle {
    if (!this.#active) throw new Error('Popup UI context is disposed');
    const wizard = mountPopupWizard(this.container.ownerDocument, this.container, definition, adapter, (options) => this.confirm(options), () => this.close());
    this.#wizards.add(wizard);
    return {
      update: (snapshot) => wizard.update(snapshot),
      focusField: (fieldId) => wizard.focusField(fieldId),
      dispose: () => {
        wizard.dispose();
        this.#wizards.delete(wizard);
      },
    };
  }

  mountList<T>(host: HTMLElement, definition: PopupListDefinition<T>): PopupListHandle {
    if (!this.#active) throw new Error('Popup UI context is disposed');
    if (host !== this.container && !this.container.contains(host)) throw new Error('List host is outside the popup');
    const current = this.#lists.get(definition.id) as MountedPopupList<T> | undefined;
    const list = current ?? mountPopupList(this.container.ownerDocument, host, definition);
    if (current !== undefined) {
      current.update(definition);
      current.attach(host);
    } else this.#lists.set(definition.id, list as MountedPopupList<unknown>);
    this.#scheduleListSweep();
    return {
      element: list.element,
      refresh: (options) => list.refresh(options),
      scrollToKey: (key, options) => list.scrollToKey(key, options),
      selectedKey: () => list.selectedKey(),
      dispose: () => {
        list.dispose();
        if (this.#lists.get(definition.id) === list) this.#lists.delete(definition.id);
      },
    };
  }

  #scheduleListSweep(): void {
    if (this.#listSweepScheduled || !this.#active) return;
    this.#listSweepScheduled = true;
    queueMicrotask(() => {
      this.#listSweepScheduled = false;
      if (!this.#active) return;
      for (const [id, list] of this.#lists) {
        if (this.container.contains(list.element)) continue;
        list.dispose();
        if (this.#lists.get(id) === list) this.#lists.delete(id);
      }
    });
  }

  async canClose(): Promise<boolean> {
    for (const wizard of this.#wizards) if (!await wizard.canClose()) return false;
    return true;
  }

  refreshControls(root: HTMLElement = this.container): void {
    if (!this.#active || (root !== this.container && !this.container.contains(root))) return;
    this.#scheduleListSweep();
    for (const [select, state] of this.#enhanced) {
      if (this.container.contains(select)) continue;
      state.shell.remove();
      this.#enhanced.delete(select);
    }
    const candidates = [root, ...descendants(root)]
      .filter((node) => node.tagName === 'SELECT' && node.getAttribute(UI_CONTROL_ATTRIBUTE) === 'select') as HTMLSelectElement[];
    for (const select of candidates) {
      if (this.#enhanced.has(select)) continue;
      const nativeOptions = nativeSelectOptions(select);
      const options = nativeOptions.map(({ value, label, description, group }) => ({
        value,
        label,
        ...(description === undefined ? {} : { description }),
        ...(group === undefined ? {} : { group }),
      }));
      const id = select.id || `ss-helper-popup-select-${++popupSelectSequence}`;
      if (!select.id) select.id = id;
      const shell = createSelectControl(select.ownerDocument, {
        id: `${id}-control`,
        ariaLabel: select.getAttribute('aria-label') ?? (select.name || '选择'),
        disabled: select.disabled,
        options,
        value: selectedValue(select, nativeOptions),
        onSelect: (value) => {
          select.value = value;
          for (const option of nativeOptions) option.source.selected = option.value === value;
          dispatchChange(select);
        },
      });
      const state: EnhancedSelect = {
        select,
        shell,
        hidden: select.hidden,
        tabIndex: select.tabIndex,
        ariaHidden: select.getAttribute('aria-hidden'),
      };
      select.hidden = true;
      select.tabIndex = -1;
      select.setAttribute('aria-hidden', 'true');
      select.dataset.ssHelperEnhanced = 'true';
      select.after(shell);
      this.#enhanced.set(select, state);
    }
  }

  dispose(): void {
    if (!this.#active) return;
    this.#active = false;
    for (const wizard of this.#wizards) wizard.dispose();
    this.#wizards.clear();
    for (const menu of this.#menus) menu.dispose();
    this.#menus.clear();
    for (const confirmation of this.#confirmations) confirmation.dispose();
    this.#confirmations.clear();
    for (const list of this.#lists.values()) list.dispose();
    this.#lists.clear();
    for (const state of this.#enhanced.values()) {
      state.shell.remove();
      state.select.hidden = state.hidden;
      state.select.tabIndex = state.tabIndex;
      if (state.ariaHidden === null) state.select.removeAttribute('aria-hidden');
      else state.select.setAttribute('aria-hidden', state.ariaHidden);
      delete state.select.dataset.ssHelperEnhanced;
    }
    this.#enhanced.clear();
  }
}
