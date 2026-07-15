import {
  SSHelperError,
  type CoreDescriptor,
  type PlainData,
  type SettingsAdapter,
  type SettingsField,
  type SettingsSchema,
  type SettingsValues,
  type PopupToken,
} from '@ss-helper/sdk';
import type { SessionScope } from '../plugins/session-scope.js';
import { SETTINGS_CSS } from '../styles/settings-styles.js';
import { assertPayload } from '../communication/contracts.js';

export const SETTINGS_ROOT_ID = 'ss-helper-settings-root';

export interface SettingsPluginIdentity {
  readonly id: string;
  readonly displayName: string;
  readonly pluginVersion: string;
  readonly capabilities: readonly string[];
}

export interface SettingsContributionSnapshot extends SettingsPluginIdentity {
  readonly schema: SettingsSchema;
  readonly health: 'healthy' | 'degraded';
  readonly lastError?: string;
  readonly values: SettingsValues;
}

interface Contribution {
  readonly identity: SettingsPluginIdentity;
  readonly schema: SettingsSchema;
  readonly adapter: SettingsAdapter;
  values: SettingsValues;
  health: 'healthy' | 'degraded';
  lastError?: string;
  unsubscribe?: () => void;
  readonly openPopup: (token: PopupToken, input: PlainData) => void;
}

const SETTINGS_FIELD_KINDS = new Set(['section', 'toggle', 'text', 'number', 'range', 'select', 'action', 'status']);

function fields(schema: SettingsSchema): readonly SettingsField[] {
  const result: SettingsField[] = [];
  const visit = (field: SettingsField): void => {
    result.push(field);
    if (field.kind === 'section') field.children.forEach(visit);
  };
  schema.fields.forEach(visit);
  return result;
}

function validateSchema(pluginId: string, schema: SettingsSchema): void {
  if (schema.id !== pluginId || schema.title.trim() === '') throw new SSHelperError('PAYLOAD_INVALID', 'The settings schema is invalid', { reason: 'schema_identity' });
  const ids = new Set<string>();
  for (const field of fields(schema)) {
    if (!SETTINGS_FIELD_KINDS.has(field.kind)) {
      throw new SSHelperError('PAYLOAD_INVALID', 'The settings field kind is invalid', { reason: 'settings_schema_invalid' });
    }
    if (!/^[a-z][A-Za-z0-9]*(?:[-.][A-Za-z0-9]+)*$/u.test(field.id) || ids.has(field.id) || field.label.trim() === '') {
      throw new SSHelperError('PAYLOAD_INVALID', 'The settings field is invalid', { reason: 'field_identity' });
    }
    ids.add(field.id);
    if (field.kind === 'select' && field.options.length === 0) throw new SSHelperError('PAYLOAD_INVALID', 'Select fields require options', { reason: 'select_options' });
    if (field.kind === 'range' && (field.min > field.max || (field.step ?? 1) <= 0)) throw new SSHelperError('PAYLOAD_INVALID', 'Range field bounds are invalid', { reason: 'range_bounds' });
  }
}

function validateValue(field: SettingsField, value: PlainData | undefined): string | undefined {
  if (field.kind === 'section' || field.kind === 'action' || field.kind === 'status') return undefined;
  if ('validation' in field && field.validation?.required === true && (value === undefined || (typeof value === 'string' && value.trim() === ''))) {
    return field.validation.message ?? 'This field is required';
  }
  if (value === undefined) return undefined;
  if (field.kind === 'toggle') return typeof value === 'boolean' ? undefined : 'Expected a boolean value';
  if (field.kind === 'text') {
    if (typeof value !== 'string') return 'Expected text';
    if (field.validation?.min !== undefined && value.length < field.validation.min) return field.validation.message ?? `Minimum length is ${field.validation.min}`;
    if (field.validation?.max !== undefined && value.length > field.validation.max) return field.validation.message ?? `Maximum length is ${field.validation.max}`;
    if (field.validation?.pattern !== undefined) {
      try { if (!new RegExp(field.validation.pattern, 'u').test(value)) return field.validation.message ?? 'The value format is invalid'; }
      catch { return 'The validation pattern is invalid'; }
    }
    return undefined;
  }
  if (field.kind === 'select') return typeof value === 'string' && field.options.some((option) => option.value === value) ? undefined : 'Choose a valid option';
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'Expected a number';
  const min = field.kind === 'range' ? field.min : field.validation?.min;
  const max = field.kind === 'range' ? field.max : field.validation?.max;
  if (min !== undefined && value < min) return `Minimum value is ${min}`;
  if (max !== undefined && value > max) return `Maximum value is ${max}`;
  return undefined;
}

function validateValues(schema: SettingsSchema, values: SettingsValues, phase: string): SettingsValues {
  assertPayload(values, undefined, phase);
  for (const field of fields(schema)) {
    const message = validateValue(field, values[field.id]);
    if (message !== undefined) throw new SSHelperError('PAYLOAD_INVALID', message, { pluginId: schema.id, field: field.id });
  }
  return Object.freeze({ ...values });
}

export class SettingsHost {
  readonly #contributions = new Map<string, Contribution>();
  #root?: HTMLElement;

  constructor(readonly core: CoreDescriptor) {}

  mount(container: HTMLElement): HTMLElement {
    const document = container.ownerDocument;
    const existing = document.getElementById(SETTINGS_ROOT_ID);
    if (existing !== null) {
      if (existing.dataset.ssHelperOwner !== 'core') throw new SSHelperError('BRIDGE_CORRUPTED', 'The settings root is not owned by Core');
      this.#root = existing;
      this.#render();
      return existing;
    }
    const root = document.createElement('section');
    root.id = SETTINGS_ROOT_ID;
    root.setAttribute('aria-label', 'SS-Helper settings');
    root.dataset.ssHelperOwner = 'core';
    container.append(root);
    this.#root = root;
    this.#render();
    return root;
  }

  register(scope: SessionScope, identity: SettingsPluginIdentity, schema: SettingsSchema, adapter: SettingsAdapter, openPopup: (token: PopupToken, input: PlainData) => void): () => void {
    scope.assertActive();
    validateSchema(identity.id, schema);
    if (this.#contributions.has(identity.id)) throw new SSHelperError('PAYLOAD_INVALID', 'The plugin already registered settings', { reason: 'duplicate_settings' });
    const contribution: Contribution = { identity, schema, adapter, values: Object.freeze({}), health: 'healthy', openPopup };
    this.#contributions.set(identity.id, contribution);
    void this.#load(contribution);
    if (adapter.subscribe !== undefined) {
      try { contribution.unsubscribe = adapter.subscribe((values) => {
        try { contribution.values = validateValues(contribution.schema, values, 'settings_subscribe'); this.#render(); }
        catch { this.#degrade(contribution); }
      }); }
      catch { this.#degrade(contribution); }
    }
    this.#render();
    return scope.addCleanup(() => {
      contribution.unsubscribe?.();
      this.#contributions.delete(identity.id);
      this.#render();
    });
  }

  async #load(contribution: Contribution): Promise<void> {
    try {
      const values = await contribution.adapter.load();
      contribution.values = validateValues(contribution.schema, values, 'settings_load');
      contribution.health = 'healthy';
      delete contribution.lastError;
      this.#render();
    } catch { this.#degrade(contribution); }
  }

  #degrade(contribution: Contribution): void {
    contribution.health = 'degraded';
    contribution.lastError = 'SETTINGS_ADAPTER_ERROR';
    this.#render();
  }

  async save(pluginId: string, values: SettingsValues): Promise<void> {
    const contribution = this.#contributions.get(pluginId);
    if (contribution === undefined) throw new SSHelperError('SETTINGS_ADAPTER_ERROR', 'Settings are not registered', { pluginId });
    const validatedValues = validateValues(contribution.schema, values, 'settings_save');
    try {
      await contribution.adapter.save(validatedValues);
      contribution.values = validatedValues;
      contribution.health = 'healthy';
      delete contribution.lastError;
      this.#render();
    } catch {
      this.#degrade(contribution);
      throw new SSHelperError('SETTINGS_ADAPTER_ERROR', 'The plugin settings adapter failed', { pluginId });
    }
  }

  async reset(pluginId: string): Promise<SettingsValues> {
    const contribution = this.#contributions.get(pluginId);
    if (contribution === undefined) throw new SSHelperError('SETTINGS_ADAPTER_ERROR', 'Settings are not registered', { pluginId });
    try {
      const resetValues = await contribution.adapter.reset();
      const values = validateValues(contribution.schema, resetValues, 'settings_reset');
      contribution.values = values;
      contribution.health = 'healthy';
      delete contribution.lastError;
      this.#render();
      return values;
    } catch {
      this.#degrade(contribution);
      throw new SSHelperError('SETTINGS_ADAPTER_ERROR', 'The plugin settings adapter failed', { pluginId });
    }
  }

  snapshot(): readonly SettingsContributionSnapshot[] {
    return Object.freeze([...this.#contributions.values()].map((entry) => Object.freeze({
      ...entry.identity,
      schema: entry.schema,
      health: entry.health,
      ...(entry.lastError === undefined ? {} : { lastError: entry.lastError }),
      values: Object.freeze(Object.fromEntries(Object.entries(entry.values).map(([key, value]) => {
        const field = fields(entry.schema).find((candidate) => candidate.id === key);
        return [key, field?.kind === 'text' && field.secret === true ? '[REDACTED]' : value];
      }))),
    })));
  }

  #render(): void {
    const root = this.#root;
    if (root === undefined) return;
    root.replaceChildren();
    const document = root.ownerDocument;
    const heading = document.createElement('h2');
    const style = document.createElement('style');
    style.dataset.ssHelperStyle = 'settings';
    style.textContent = SETTINGS_CSS;
    root.append(style);
    heading.textContent = 'SS-Helper';
    root.append(heading);
    const core = document.createElement('div');
    core.dataset.pluginId = this.core.id;
    core.dataset.generation = String(this.core.generation);
    core.textContent = `Core ${this.core.coreVersion} · SDK ${this.core.sdkPackageVersion} · API ${this.core.apiMajor}.${this.core.apiMinor} · generation ${this.core.generation} · ${this.core.capabilities.join(', ')}`;
    root.append(core);
    for (const contribution of this.#contributions.values()) {
      const section = document.createElement('section');
      section.dataset.pluginId = contribution.identity.id;
      section.dataset.health = contribution.health;
      const title = document.createElement('h3');
      title.textContent = `${contribution.identity.displayName} ${contribution.identity.pluginVersion}`;
      section.append(title);
      this.#renderFields(document, section, contribution, contribution.schema.fields);
      root.append(section);
    }
  }

  #renderFields(document: Document, parent: HTMLElement, contribution: Contribution, entries: readonly SettingsField[]): void {
    for (const field of entries) {
      if (field.kind === 'section') {
        const group = document.createElement('fieldset');
        const legend = document.createElement('legend');
        legend.textContent = field.label;
        group.append(legend);
        this.#renderFields(document, group, contribution, field.children);
        parent.append(group);
        continue;
      }
      const row = document.createElement('div');
      row.dataset.fieldId = field.id;
      const label = document.createElement('label');
      label.textContent = field.label;
      const descriptionId = `${contribution.identity.id}-${field.id}-description`;
      if (field.description !== undefined || field.disabledReason !== undefined) {
        const description = document.createElement('small');
        description.id = descriptionId;
        description.textContent = field.disabledReason ?? field.description ?? '';
        row.append(description);
      }
      if (field.kind === 'status') {
        row.setAttribute('role', 'status');
        row.textContent = `${field.label}: ${field.value}`;
      } else if (field.kind === 'action') {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = field.label;
        button.disabled = field.disabledReason !== undefined;
        if (field.popup !== undefined) button.addEventListener('click', () => contribution.openPopup(field.popup!, { actionId: field.actionId }));
        row.append(button);
      } else {
        const input = field.kind === 'select' ? document.createElement('select') : document.createElement('input');
        input.id = `${contribution.identity.id}-${field.id}`;
        label.htmlFor = input.id;
        input.setAttribute('aria-label', field.aria?.label ?? field.label);
        if (field.description !== undefined || field.disabledReason !== undefined) input.setAttribute('aria-describedby', descriptionId);
        input.disabled = field.disabledReason !== undefined;
        if (input.tagName === 'INPUT') {
          const htmlInput = input as HTMLInputElement;
          htmlInput.type = field.kind === 'toggle' ? 'checkbox' : field.kind === 'text' && field.secret === true ? 'password' : field.kind === 'range' ? 'range' : field.kind === 'number' ? 'number' : 'text';
          const value = contribution.values[field.id];
          if (typeof value === 'boolean') htmlInput.checked = value;
          else if (typeof value === 'string' || typeof value === 'number') htmlInput.value = String(value);
          if (field.kind === 'text' && field.placeholder !== undefined) htmlInput.placeholder = field.placeholder;
          if (field.kind === 'range') { htmlInput.min = String(field.min); htmlInput.max = String(field.max); htmlInput.step = String(field.step ?? 1); }
          if (field.kind === 'number') {
            if (field.validation?.min !== undefined) htmlInput.min = String(field.validation.min);
            if (field.validation?.max !== undefined) htmlInput.max = String(field.validation.max);
          }
        } else if (field.kind === 'select') {
          for (const option of field.options) { const node = document.createElement('option'); node.value = option.value; node.textContent = option.label; input.append(node); }
          const value = contribution.values[field.id]; if (typeof value === 'string') input.value = value;
        }
        input.addEventListener('change', () => {
          let value: PlainData;
          if (field.kind === 'toggle') value = (input as HTMLInputElement).checked;
          else if (field.kind === 'number' || field.kind === 'range') value = Number(input.value);
          else value = input.value;
          void this.save(contribution.identity.id, Object.freeze({ ...contribution.values, [field.id]: value })).then(() => {
            input.removeAttribute('aria-invalid');
            delete row.dataset.validationError;
          }, (error: unknown) => {
            input.setAttribute('aria-invalid', 'true');
            row.dataset.validationError = error instanceof Error ? error.message : 'Invalid value';
          });
        });
        row.prepend(label);
        row.append(input);
      }
      parent.append(row);
    }
  }
}
