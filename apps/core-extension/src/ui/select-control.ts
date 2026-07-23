export interface SelectControlOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string | undefined;
  readonly group?: string | undefined;
}

export interface SelectControlOptions {
  readonly id: string;
  readonly label?: HTMLElement | undefined;
  readonly ariaLabel: string;
  readonly describedBy?: string | undefined;
  readonly invalid?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly options: readonly SelectControlOption[];
  readonly value?: string | undefined;
  readonly placeholder?: string | undefined;
  readonly onSelect: (value: string) => void;
}

function icon(document: Document, name: string): HTMLElement {
  return createIconElement(document, name, { decorative: true });
}

export function createSelectControl(document: Document, config: SelectControlOptions): HTMLElement {
  const shell = document.createElement('div');
  shell.className = 'stx-ui-select-wrap';
  shell.dataset.open = 'false';
  shell.dataset.ssHelperControl = 'select';
  const trigger = document.createElement('button');
  trigger.id = config.id;
  trigger.type = 'button';
  trigger.className = 'stx-ui-select-trigger';
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', config.ariaLabel);
  if (config.describedBy?.trim()) trigger.setAttribute('aria-describedby', config.describedBy.trim());
  trigger.disabled = config.disabled === true || config.options.length === 0;
  if (trigger.disabled) trigger.setAttribute('aria-disabled', 'true');
  if (config.invalid === true) trigger.setAttribute('aria-invalid', 'true');
  config.label?.setAttribute('for', trigger.id);

  const matchedIndex = config.options.findIndex((option) => option.value === config.value);
  const selectedIndex = matchedIndex >= 0 ? matchedIndex : config.placeholder === undefined && config.options.length > 0 ? 0 : -1;
  const selected = selectedIndex >= 0 ? config.options[selectedIndex] : undefined;
  const value = document.createElement('span');
  value.className = 'stx-ui-select-value';
  value.textContent = selected?.label ?? config.placeholder ?? '暂无可用选项';
  const arrow = document.createElement('span');
  arrow.className = 'stx-ui-select-arrow';
  arrow.setAttribute('aria-hidden', 'true');
  arrow.append(icon(document, 'chevron-down'));
  trigger.append(value, arrow);

  const listbox = document.createElement('div');
  listbox.id = `${config.id}-listbox`;
  listbox.className = 'stx-ui-select-listbox';
  listbox.setAttribute('popover', 'manual');
  listbox.setAttribute('role', 'listbox');
  listbox.setAttribute('aria-label', config.ariaLabel);
  listbox.hidden = true;
  trigger.setAttribute('aria-controls', listbox.id);
  const optionNodes: HTMLElement[] = [];
  const checkNodes: HTMLElement[] = [];
  let activeIndex = selected === undefined ? 0 : selectedIndex;
  let typeahead = '';
  let typeaheadTimer: ReturnType<typeof setTimeout> | undefined;
  const view = document.defaultView;
  const topLayerListbox = listbox as HTMLElement & {
    hidePopover?: () => void;
    showPopover?: () => void;
  };
  const positionListbox = (): void => {
    if (typeof trigger.getBoundingClientRect !== 'function') return;
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = view?.innerWidth ?? document.documentElement?.clientWidth ?? rect.right;
    const viewportHeight = view?.innerHeight ?? document.documentElement?.clientHeight ?? rect.bottom;
    const edge = 8;
    const gap = 6;
    const width = Math.min(rect.width, Math.max(0, viewportWidth - edge * 2));
    const left = Math.min(Math.max(edge, rect.left), Math.max(edge, viewportWidth - width - edge));
    const spaceBelow = Math.max(0, viewportHeight - rect.bottom - gap - edge);
    const spaceAbove = Math.max(0, rect.top - gap - edge);
    const openAbove = spaceBelow < 120 && spaceAbove > spaceBelow;
    listbox.style.position = 'fixed';
    listbox.style.right = 'auto';
    listbox.style.left = `${left}px`;
    listbox.style.width = `${width}px`;
    listbox.style.maxHeight = `${Math.min(240, Math.max(80, openAbove ? spaceAbove : spaceBelow))}px`;
    if (openAbove) {
      listbox.style.top = 'auto';
      listbox.style.bottom = `${Math.max(edge, viewportHeight - rect.top + gap)}px`;
    } else {
      listbox.style.top = `${Math.min(viewportHeight - edge, rect.bottom + gap)}px`;
      listbox.style.bottom = 'auto';
    }
  };
  const stopTrackingPosition = (): void => {
    view?.removeEventListener('resize', positionListbox);
    view?.removeEventListener('scroll', positionListbox, true);
  };

  const syncSelected = (index: number): void => {
    optionNodes.forEach((node, optionIndex) => node.setAttribute('aria-selected', String(optionIndex === index)));
    checkNodes.forEach((node, optionIndex) => { node.hidden = optionIndex !== index; });
  };

  const syncActive = (): void => {
    optionNodes.forEach((node, index) => { node.dataset.active = String(index === activeIndex); });
    const active = optionNodes[activeIndex];
    if (active !== undefined && !listbox.hidden) {
      trigger.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView?.({ block: 'nearest' });
    } else trigger.removeAttribute('aria-activedescendant');
  };
  const close = (): void => {
    stopTrackingPosition();
    try { topLayerListbox.hidePopover?.(); } catch { /* The popover may already be closed. */ }
    listbox.hidden = true;
    shell.dataset.open = 'false';
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-activedescendant');
  };
  const open = (): void => {
    if (trigger.disabled) return;
    listbox.hidden = false;
    positionListbox();
    try { topLayerListbox.showPopover?.(); } catch { /* Fixed-position fallback remains usable. */ }
    view?.addEventListener('resize', positionListbox);
    view?.addEventListener('scroll', positionListbox, true);
    shell.dataset.open = 'true';
    trigger.setAttribute('aria-expanded', 'true');
    syncActive();
  };
  const choose = (index: number): void => {
    const option = config.options[index];
    if (option === undefined) return;
    activeIndex = index;
    value.textContent = option.label;
    syncSelected(index);
    close();
    config.onSelect(option.value);
  };
  const move = (index: number): void => {
    activeIndex = Math.max(0, Math.min(config.options.length - 1, index));
    syncActive();
  };

  let renderedGroup: string | undefined;
  config.options.forEach((option, index) => {
    const group = option.group?.trim();
    if (group && group !== renderedGroup) {
      const heading = document.createElement('div');
      heading.className = 'stx-ui-select-group';
      heading.setAttribute('role', 'presentation');
      heading.textContent = group;
      listbox.append(heading);
      renderedGroup = group;
    }
    const node = document.createElement('div');
    node.id = `${config.id}-option-${index}`;
    node.className = 'stx-ui-select-option';
    node.setAttribute('role', 'option');
    node.setAttribute('aria-selected', String(option.value === selected?.value));
    node.tabIndex = -1;
    if (option.description?.trim()) node.setAttribute('aria-label', `${option.label}，${option.description.trim()}`);
    const copy = document.createElement('span');
    copy.className = 'stx-ui-select-option-copy';
    const text = document.createElement('span');
    text.textContent = option.label;
    copy.append(text);
    if (option.description?.trim()) {
      const description = document.createElement('small');
      description.textContent = option.description.trim();
      copy.append(description);
    }
    node.append(copy);
    const check = document.createElement('span');
    check.className = 'stx-ui-select-check';
    check.setAttribute('aria-hidden', 'true');
    check.hidden = option.value !== selected?.value;
    check.append(icon(document, 'check'));
    checkNodes.push(check);
    node.append(check);
    node.addEventListener('pointerdown', (event) => event.preventDefault());
    node.addEventListener('pointermove', () => move(index));
    node.addEventListener('click', () => choose(index));
    optionNodes.push(node);
    listbox.append(node);
  });

  trigger.addEventListener('click', () => { if (listbox.hidden) open(); else close(); });
  trigger.addEventListener('blur', () => queueMicrotask(() => { if (!shell.contains(document.activeElement)) close(); }));
  trigger.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Escape') { if (!listbox.hidden) { event.preventDefault(); event.stopPropagation(); close(); } return; }
    if (event.key === 'Tab') { close(); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (listbox.hidden) open(); else move(activeIndex + (event.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); if (listbox.hidden) open(); move(event.key === 'Home' ? 0 : config.options.length - 1); return; }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (listbox.hidden) open(); else choose(activeIndex); return; }
    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      if (typeaheadTimer !== undefined) clearTimeout(typeaheadTimer);
      typeahead += event.key.toLocaleLowerCase();
      typeaheadTimer = setTimeout(() => { typeahead = ''; typeaheadTimer = undefined; }, 700);
      const match = config.options.findIndex((option, index) => index > activeIndex && option.label.toLocaleLowerCase().startsWith(typeahead));
      const wrapped = match >= 0 ? match : config.options.findIndex((option) => option.label.toLocaleLowerCase().startsWith(typeahead));
      if (wrapped >= 0) { event.preventDefault(); if (listbox.hidden) open(); move(wrapped); }
    }
  });

  syncSelected(selectedIndex);
  syncActive();
  shell.append(trigger, listbox);
  return shell;
}
import { createIconElement } from './icon-element.js';
