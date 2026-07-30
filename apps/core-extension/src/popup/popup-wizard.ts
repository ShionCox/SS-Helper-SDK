import {
  type PlainData,
  type PopupFormField,
  type PopupConfirmationOptions,
  type PopupWizardAdapter,
  type PopupWizardDefinition,
  type PopupWizardHandle,
  type PopupWizardSnapshot,
  type SettingsOption,
} from '@ss-helper/sdk';
import { createIconElement } from '../ui/icon-element.js';
import { createSelectControl } from '../ui/select-control.js';

export interface MountedPopupWizard extends PopupWizardHandle {
  canClose(): Promise<boolean>;
}

function idPart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/gu, '-');
}

function button(document: Document, label: string, tone: 'neutral' | 'primary' = 'neutral'): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = `stx-ui-btn stx-ui-btn-${tone}`;
  node.dataset.ssHelperControl = 'button';
  node.textContent = label;
  return node;
}

function valueFor(snapshot: PopupWizardSnapshot, field: PopupFormField): PlainData | undefined {
  const value = snapshot.values[field.id];
  if (value !== undefined) return value;
  return 'defaultValue' in field ? field.defaultValue : undefined;
}

function optionsFor(snapshot: PopupWizardSnapshot, field: Extract<PopupFormField, { kind: 'select' | 'radio' | 'multiSelect' }>): readonly SettingsOption[] {
  return snapshot.fieldOptions?.[field.id] ?? field.options;
}

function appendDescription(document: Document, parent: HTMLElement, id: string, value: string | undefined): void {
  if (!value?.trim()) return;
  const description = document.createElement('small');
  description.id = id;
  description.className = 'stx-popup-wizard-field-description';
  description.textContent = value.trim();
  parent.append(description);
}

function appendError(document: Document, parent: HTMLElement, id: string, value: string | undefined): void {
  const error = document.createElement('small');
  error.id = id;
  error.className = 'stx-popup-wizard-field-error';
  error.setAttribute('role', 'alert');
  error.hidden = !value;
  error.textContent = value ?? '';
  parent.append(error);
}

class PopupWizardController implements MountedPopupWizard {
  readonly #revealedSecrets = new Set<string>();
  readonly #unsubscribe: () => void;
  #active = true;
  #snapshot: PopupWizardSnapshot;

  constructor(
    private readonly document: Document,
    private readonly container: HTMLElement,
    private readonly definition: PopupWizardDefinition,
    private readonly adapter: PopupWizardAdapter,
    private readonly confirm: (options: PopupConfirmationOptions) => Promise<boolean>,
  ) {
    this.#snapshot = adapter.snapshot();
    this.#unsubscribe = adapter.subscribe?.(() => this.update()) ?? (() => undefined);
    this.update(this.#snapshot);
  }

  async canClose(): Promise<boolean> {
    const snapshot = this.adapter.snapshot();
    if (snapshot.dirty !== true || this.definition.confirmDiscard === undefined) return true;
    return this.confirm(this.definition.confirmDiscard);
  }

  update(snapshot: PopupWizardSnapshot = this.adapter.snapshot()): void {
    if (!this.#active) return;
    this.#snapshot = snapshot;
    const active = this.document.activeElement as HTMLInputElement | null;
    const restoreFieldId = active?.dataset.popupWizardField;
    const selectionStart = active?.selectionStart;
    const selectionEnd = active?.selectionEnd;
    this.#render();
    if (restoreFieldId !== undefined) {
      const next = this.container.querySelector<HTMLInputElement>(`[data-popup-wizard-field="${restoreFieldId}"]`);
      next?.focus();
      if (next !== null && next !== undefined && selectionStart !== null && selectionStart !== undefined) {
        try { next.setSelectionRange(selectionStart, selectionEnd ?? selectionStart); } catch { /* Not all input types expose a text selection. */ }
      }
    }
  }

  focusField(fieldId: string): void {
    this.container.querySelector<HTMLElement>(`[data-popup-wizard-field="${idPart(fieldId)}"]`)?.focus();
  }

  dispose(): void {
    if (!this.#active) return;
    this.#active = false;
    this.#unsubscribe();
    this.container.replaceChildren();
  }

  #render(): void {
    const snapshot = this.#snapshot;
    const steps = this.definition.steps;
    const activeIndex = steps.findIndex((step) => step.id === snapshot.activeStepId);
    const step = steps[Math.max(0, activeIndex)] ?? steps[0];
    if (step === undefined) {
      this.container.textContent = '向导没有可用步骤。';
      return;
    }

    const shell = this.document.createElement('div');
    shell.className = 'stx-popup-wizard';
    shell.dataset.wizardId = this.definition.id;
    shell.dataset.busy = String(snapshot.busy === true);

    const navigation = this.document.createElement('nav');
    navigation.className = 'stx-popup-wizard-nav';
    navigation.setAttribute('aria-label', '配置步骤');
    const navTitle = this.document.createElement('p');
    navTitle.className = 'stx-popup-wizard-nav-title';
    navTitle.textContent = '配置流程';
    const stepList = this.document.createElement('ol');
    steps.forEach((candidate, index) => {
      const item = this.document.createElement('li');
      const control = this.document.createElement('button');
      const complete = snapshot.completedStepIds.includes(candidate.id);
      const current = candidate.id === step.id;
      control.type = 'button';
      control.className = 'stx-popup-wizard-step';
      control.dataset.state = current ? 'current' : complete ? 'complete' : 'pending';
      control.disabled = snapshot.busy === true || (!current && !complete);
      if (current) control.setAttribute('aria-current', 'step');
      const marker = this.document.createElement('span');
      marker.className = 'stx-popup-wizard-step-marker';
      marker.setAttribute('aria-hidden', 'true');
      if (complete && !current) marker.append(createIconElement(this.document, 'check', { decorative: true }));
      else marker.textContent = String(index + 1);
      const copy = this.document.createElement('span');
      const label = this.document.createElement('strong');
      label.textContent = candidate.label;
      const description = this.document.createElement('small');
      description.textContent = candidate.description ?? '';
      copy.append(label, description);
      control.append(marker, copy);
      control.addEventListener('click', () => this.adapter.navigate(candidate.id));
      item.append(control);
      stepList.append(item);
    });
    navigation.append(navTitle, stepList);

    const main = this.document.createElement('main');
    main.className = 'stx-popup-wizard-main';
    const heading = this.document.createElement('header');
    heading.className = 'stx-popup-wizard-heading';
    const kicker = this.document.createElement('span');
    kicker.textContent = `步骤 ${Math.max(1, activeIndex + 1)} / ${steps.length}`;
    const title = this.document.createElement('h3');
    title.textContent = step.title ?? step.label;
    const lead = this.document.createElement('p');
    lead.textContent = step.description ?? '';
    heading.append(kicker, title, lead);

    const form = this.document.createElement('div');
    form.className = 'stx-popup-wizard-form';
    form.setAttribute('role', 'group');
    form.setAttribute('aria-label', step.label);
    for (const field of step.fields) this.#renderField(form, field);
    if (step.fields.length === 0) {
      const empty = this.document.createElement('div');
      empty.className = 'stx-popup-wizard-review';
      empty.append(createIconElement(this.document, snapshot.status?.tone === 'success' ? 'circle-check' : 'flask', { decorative: true }));
      const copy = this.document.createElement('div');
      const reviewTitle = this.document.createElement('strong');
      reviewTitle.textContent = snapshot.busy === true ? this.definition.busyLabel ?? '正在验证连接' : '准备验证资源';
      const reviewDescription = this.document.createElement('p');
      reviewDescription.textContent = '不会提前保存配置。全部检查通过后，资源才会写入并启用。';
      copy.append(reviewTitle, reviewDescription);
      empty.append(copy);
      form.append(empty);
    }
    main.append(heading, form);

    const aside = this.#renderAside();
    const content = this.document.createElement('div');
    content.className = 'stx-popup-wizard-content';
    content.append(navigation, main);
    if (aside !== undefined) content.append(aside);

    const footer = this.document.createElement('footer');
    footer.className = 'stx-popup-wizard-footer';
    const status = this.document.createElement('div');
    status.className = 'stx-popup-wizard-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    if (snapshot.status !== undefined) {
      status.dataset.tone = snapshot.status.tone;
      const message = this.document.createElement('span');
      message.textContent = snapshot.status.message;
      status.append(message);
      if (snapshot.status.code !== undefined) {
        const code = this.document.createElement('code');
        code.textContent = snapshot.status.code;
        status.append(code);
      }
    }
    const back = button(this.document, '返回');
    back.disabled = snapshot.busy === true || activeIndex <= 0;
    back.addEventListener('click', () => this.adapter.back());
    const submitLabel = snapshot.busy === true
      ? this.definition.busyLabel ?? '处理中…'
      : activeIndex === steps.length - 1 ? this.definition.submitLabel : '继续';
    const submit = button(this.document, submitLabel, 'primary');
    submit.disabled = snapshot.busy === true || snapshot.submitDisabled === true;
    submit.dataset.popupWizardSubmit = 'true';
    submit.addEventListener('click', () => { void this.adapter.submit(); });
    footer.append(back, status, submit);
    shell.append(content, footer);
    this.container.replaceChildren(shell);
  }

  #renderField(parent: HTMLElement, field: PopupFormField): void {
    const snapshot = this.#snapshot;
    const fieldId = `${idPart(this.definition.id)}-${idPart(field.id)}`;
    const descriptionId = `${fieldId}-description`;
    const errorId = `${fieldId}-error`;
    const errorValue = snapshot.fieldErrors?.[field.id];
    const disabled = snapshot.busy === true || snapshot.disabledFieldIds?.includes(field.id) === true;
    const value = valueFor(snapshot, field);
    const row = this.document.createElement('div');
    row.className = `stx-popup-wizard-field stx-popup-wizard-field-${field.kind}`;
    row.dataset.fieldId = field.id;
    if (errorValue !== undefined) row.dataset.invalid = 'true';
    const label = this.document.createElement('label');
    label.className = 'stx-popup-wizard-field-label';
    label.textContent = field.label;
    const control = this.document.createElement('div');
    control.className = 'stx-popup-wizard-field-control';

    if (field.kind === 'status') {
      const badge = this.document.createElement('span');
      badge.className = `stx-ui-badge stx-ui-badge-${field.tone ?? 'neutral'}`;
      badge.textContent = field.value;
      control.append(badge);
    } else if (field.kind === 'select') {
      const currentValue = typeof value === 'string' ? value : '';
      const choices = optionsFor(snapshot, field);
      const customValue = '__ss_helper_custom_value__';
      const hasDiscoveredValue = choices.some((option) => option.value === currentValue);
      const select = createSelectControl(this.document, {
        id: fieldId,
        label,
        ariaLabel: field.aria?.label ?? field.label,
        describedBy: `${descriptionId} ${errorId}`,
        invalid: errorValue !== undefined,
        disabled,
        options: field.allowCustom === true
          ? [...choices, { value: customValue, label: '手动输入模型 ID' }]
          : choices,
        value: field.allowCustom === true && !hasDiscoveredValue ? customValue : currentValue,
        onSelect: (selected) => this.adapter.change(field.id, selected === customValue ? '' : selected),
      });
      if (field.allowCustom === true) {
        const customWrap = this.document.createElement('div');
        customWrap.className = 'stx-popup-wizard-select-custom';
        customWrap.append(select);
        if (!hasDiscoveredValue) {
          const customInput = this.document.createElement('input');
          customInput.className = 'stx-ui-input';
          customInput.dataset.popupWizardField = idPart(field.id);
          customInput.disabled = disabled;
          customInput.value = currentValue;
          customInput.placeholder = field.customPlaceholder ?? '输入模型 ID';
          customInput.setAttribute('aria-label', `${field.label}（手动输入）`);
          customInput.setAttribute('aria-describedby', `${descriptionId} ${errorId}`);
          if (errorValue !== undefined) customInput.setAttribute('aria-invalid', 'true');
          customInput.addEventListener('input', () => this.adapter.change(field.id, customInput.value));
          customWrap.append(customInput);
        }
        control.append(customWrap);
      } else {
        control.append(select);
      }
    } else if (field.kind === 'radio') {
      control.className += ' stx-popup-wizard-options';
      control.setAttribute('role', 'radiogroup');
      control.setAttribute('aria-label', field.aria?.label ?? field.label);
      for (const option of optionsFor(snapshot, field)) {
        const optionLabel = this.document.createElement('label');
        optionLabel.className = 'stx-popup-wizard-option';
        const input = this.document.createElement('input');
        input.type = 'radio';
        input.name = fieldId;
        input.value = option.value;
        input.checked = value === option.value;
        input.disabled = disabled;
        input.dataset.popupWizardField = idPart(field.id);
        input.addEventListener('change', () => { if (input.checked) this.adapter.change(field.id, option.value); });
        const text = this.document.createElement('span');
        text.textContent = option.label;
        optionLabel.append(input, text);
        control.append(optionLabel);
      }
    } else if (field.kind === 'checkbox' || field.kind === 'toggle') {
      const input = this.document.createElement('input');
      input.id = fieldId;
      input.type = 'checkbox';
      input.checked = value === true;
      input.disabled = disabled;
      input.dataset.popupWizardField = idPart(field.id);
      input.addEventListener('change', () => this.adapter.change(field.id, input.checked));
      label.setAttribute('for', input.id);
      control.append(input);
    } else if (field.kind === 'multiSelect') {
      const selected = Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
      const options = optionsFor(snapshot, field);
      const list = this.document.createElement('div');
      list.className = 'stx-popup-wizard-options';
      for (const option of options) {
        const optionLabel = this.document.createElement('label');
        optionLabel.className = 'stx-popup-wizard-option';
        const input = this.document.createElement('input');
        input.type = 'checkbox';
        input.checked = selected.includes(option.value);
        input.disabled = disabled;
        input.addEventListener('change', () => this.adapter.change(field.id, input.checked ? [...selected, option.value] : selected.filter((entry) => entry !== option.value)));
        const text = this.document.createElement('span');
        text.textContent = option.label;
        optionLabel.append(input, text);
        list.append(optionLabel);
      }
      control.append(list);
    } else {
      const wrap = this.document.createElement('div');
      wrap.className = 'stx-popup-wizard-input-wrap';
      const input = this.document.createElement('input');
      input.id = fieldId;
      input.className = 'stx-ui-input';
      input.dataset.popupWizardField = idPart(field.id);
      input.disabled = disabled;
      input.setAttribute('aria-describedby', `${descriptionId} ${errorId}`);
      if (errorValue !== undefined) input.setAttribute('aria-invalid', 'true');
      if (field.kind === 'number' || field.kind === 'range') {
        input.type = 'number';
        if (typeof value === 'number') input.value = String(value);
        if (field.kind === 'range') {
          input.min = String(field.min);
          input.max = String(field.max);
          input.step = String(field.step ?? 1);
        } else {
          if (field.validation?.min !== undefined) input.min = String(field.validation.min);
          if (field.validation?.max !== undefined) input.max = String(field.validation.max);
          input.step = String(field.step ?? 1);
        }
        input.addEventListener('input', () => this.adapter.change(field.id, input.value === '' ? Number.NaN : Number(input.value)));
      } else {
        const secret = field.secret === true;
        input.type = secret && !this.#revealedSecrets.has(field.id) ? 'password' : 'text';
        input.placeholder = field.placeholder ?? '';
        input.value = typeof value === 'string' ? value : '';
        input.autocomplete = secret ? 'new-password' : 'off';
        input.addEventListener('input', () => this.adapter.change(field.id, input.value));
        if (secret) {
          const revealed = this.#revealedSecrets.has(field.id);
          const actionLabel = `${revealed ? '隐藏' : '显示'}${field.label}`;
          const reveal = this.document.createElement('button');
          reveal.type = 'button';
          reveal.className = 'stx-popup-wizard-secret-toggle';
          reveal.setAttribute('aria-label', actionLabel);
          reveal.setAttribute('aria-pressed', String(revealed));
          reveal.title = actionLabel;
          reveal.append(createIconElement(this.document, revealed ? 'eye-slash' : 'eye', { decorative: true }));
          reveal.addEventListener('click', () => {
            if (this.#revealedSecrets.has(field.id)) this.#revealedSecrets.delete(field.id);
            else this.#revealedSecrets.add(field.id);
            this.update();
            this.focusField(field.id);
          });
          wrap.append(input, reveal);
        }
      }
      label.setAttribute('for', input.id);
      wrap.prepend(input);
      control.append(wrap);
    }
    row.append(label, control);
    appendDescription(this.document, row, descriptionId, field.description);
    appendError(this.document, row, errorId, errorValue);
    parent.append(row);
  }

  #renderAside(): HTMLElement | undefined {
    const asideDefinition = this.definition.aside;
    if (asideDefinition === undefined) return undefined;
    const aside = this.document.createElement('aside');
    aside.className = 'stx-popup-wizard-aside';
    const title = this.document.createElement('h4');
    title.textContent = asideDefinition.title;
    const description = this.document.createElement('p');
    description.textContent = asideDefinition.description ?? '';
    const list = this.document.createElement('ul');
    for (const check of asideDefinition.checks) {
      const snapshot = this.#snapshot.checks?.[check.id];
      const item = this.document.createElement('li');
      item.dataset.state = snapshot?.state ?? 'idle';
      const marker = this.document.createElement('span');
      marker.className = 'stx-popup-wizard-check-marker';
      marker.setAttribute('aria-hidden', 'true');
      const iconName = snapshot?.state === 'success'
        ? 'check'
        : snapshot?.state === 'error'
          ? 'xmark'
          : snapshot?.state === 'running'
            ? 'rotate'
            : check.icon ?? 'circle';
      marker.append(createIconElement(this.document, iconName, { decorative: true }));
      const copy = this.document.createElement('div');
      const label = this.document.createElement('strong');
      label.textContent = check.label;
      const detail = this.document.createElement('small');
      detail.textContent = snapshot?.description ?? check.description ?? '';
      copy.append(label, detail);
      item.append(marker, copy);
      list.append(item);
    }
    aside.append(title, description, list);
    return aside;
  }
}

export function mountPopupWizard(
  document: Document,
  container: HTMLElement,
  definition: PopupWizardDefinition,
  adapter: PopupWizardAdapter,
  confirm: (options: PopupConfirmationOptions) => Promise<boolean>,
): MountedPopupWizard {
  return new PopupWizardController(document, container, definition, adapter, confirm);
}
