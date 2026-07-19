export interface SelectControlOption {
  readonly value: string;
  readonly label: string;
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
  const node = document.createElement('i');
  node.className = `fa-solid ${name}`;
  node.setAttribute('aria-hidden', 'true');
  return node;
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
  arrow.append(icon(document, 'fa-chevron-down'));
  trigger.append(value, arrow);

  const listbox = document.createElement('div');
  listbox.id = `${config.id}-listbox`;
  listbox.className = 'stx-ui-select-listbox';
  listbox.setAttribute('role', 'listbox');
  listbox.setAttribute('aria-label', config.ariaLabel);
  listbox.hidden = true;
  trigger.setAttribute('aria-controls', listbox.id);
  const optionNodes: HTMLElement[] = [];
  const checkNodes: HTMLElement[] = [];
  let activeIndex = selected === undefined ? 0 : selectedIndex;
  let typeahead = '';
  let typeaheadTimer: ReturnType<typeof setTimeout> | undefined;

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
    listbox.hidden = true;
    shell.dataset.open = 'false';
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-activedescendant');
  };
  const open = (): void => {
    if (trigger.disabled) return;
    listbox.hidden = false;
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

  config.options.forEach((option, index) => {
    const node = document.createElement('div');
    node.id = `${config.id}-option-${index}`;
    node.className = 'stx-ui-select-option';
    node.setAttribute('role', 'option');
    node.setAttribute('aria-selected', String(option.value === selected?.value));
    node.tabIndex = -1;
    const text = document.createElement('span');
    text.textContent = option.label;
    node.append(text);
    const check = document.createElement('span');
    check.className = 'stx-ui-select-check';
    check.setAttribute('aria-hidden', 'true');
    check.hidden = option.value !== selected?.value;
    check.append(icon(document, 'fa-check'));
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
