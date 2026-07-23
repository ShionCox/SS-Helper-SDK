import {
  UI_CONTROL_ATTRIBUTE,
  type PopupUiContext,
} from '@ss-helper/sdk';
import { createSelectControl } from '../ui/select-control.js';

interface EnhancedSelect {
  readonly select: HTMLSelectElement;
  readonly shell: HTMLElement;
  readonly hidden: boolean;
  readonly tabIndex: number;
  readonly ariaHidden: string | null;
}

let popupSelectSequence = 0;

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
  #active = true;

  constructor(private readonly container: HTMLElement, private readonly requestClose: () => void = () => undefined) {}

  close(): void {
    if (this.#active) this.requestClose();
  }

  refreshControls(root: HTMLElement = this.container): void {
    if (!this.#active || (root !== this.container && !this.container.contains(root))) return;
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
