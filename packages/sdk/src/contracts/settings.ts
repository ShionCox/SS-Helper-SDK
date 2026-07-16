import type { PlainData } from './plain-data.js';
import type { PopupToken } from './ui.js';

export interface AriaMetadata {
  readonly label?: string;
  readonly description?: string;
}

export interface ValidationRule {
  readonly required?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly pattern?: string;
  readonly message?: string;
}

interface SettingsFieldBase<Kind extends string> {
  readonly kind: Kind;
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly disabledReason?: string;
  readonly aria?: AriaMetadata;
}

export interface SectionField extends SettingsFieldBase<'section'> { readonly children: readonly SettingsField[]; }
export interface ToggleField extends SettingsFieldBase<'toggle'> { readonly defaultValue?: boolean; }
export interface CheckboxField extends SettingsFieldBase<'checkbox'> { readonly defaultValue?: boolean; readonly validation?: ValidationRule; }
export interface TextField extends SettingsFieldBase<'text'> { readonly defaultValue?: string; readonly placeholder?: string; readonly validation?: ValidationRule; readonly secret?: boolean; }
export interface NumberField extends SettingsFieldBase<'number'> { readonly defaultValue?: number; readonly validation?: ValidationRule; readonly step?: number; readonly unit?: string; readonly showStepper?: boolean; }
export interface RangeField extends SettingsFieldBase<'range'> { readonly min: number; readonly max: number; readonly step?: number; readonly defaultValue?: number; }
export interface SettingsOption { readonly value: string; readonly label: string; }
export interface SelectField extends SettingsFieldBase<'select'> { readonly options: readonly SettingsOption[]; readonly defaultValue?: string; readonly validation?: ValidationRule; }
export interface RadioField extends SettingsFieldBase<'radio'> { readonly options: readonly SettingsOption[]; readonly defaultValue?: string; readonly validation?: ValidationRule; }
export interface MultiSelectField extends SettingsFieldBase<'multiSelect'> { readonly options: readonly SettingsOption[]; readonly defaultValue?: readonly string[]; readonly placeholder?: string; readonly validation?: ValidationRule; }
export type SettingsTone = 'neutral' | 'success' | 'warning' | 'error';
export interface SettingsNavigationTarget {
  readonly pluginId: string;
  readonly tabId?: string;
  readonly fieldId?: string;
}
export interface SettingsStatusSnapshot {
  readonly value: string;
  readonly tone: SettingsTone;
  readonly description?: string;
}
export interface SettingsFieldStateSnapshot {
  readonly disabled: boolean;
  readonly disabledReason?: string;
}
export type SettingsFieldStateMap = Readonly<Record<string, SettingsFieldStateSnapshot>>;
export interface StatusAction {
  readonly buttonLabel: string;
  readonly target: SettingsNavigationTarget;
  readonly showWhen?: readonly SettingsTone[];
}
export interface ActionField extends SettingsFieldBase<'action'> {
  readonly actionId: string;
  readonly tone?: 'neutral' | 'danger';
  readonly popup?: PopupToken;
  readonly placement?: 'footer' | 'inline';
  readonly buttonLabel?: string;
}
export interface StatusField extends SettingsFieldBase<'status'> { readonly value: string; readonly tone?: SettingsTone; readonly action?: StatusAction; }

export type SettingsField = SectionField | ToggleField | CheckboxField | TextField | NumberField | RangeField | SelectField | RadioField | MultiSelectField | ActionField | StatusField;

export interface SettingsSchema {
  readonly id: string;
  readonly title: string;
  readonly fields: readonly SettingsField[];
}

export type SettingsValues = Readonly<Record<string, PlainData>>;

export interface SettingsAdapter {
  load(): SettingsValues | Promise<SettingsValues>;
  save(values: SettingsValues): void | Promise<void>;
  reset(): SettingsValues | Promise<SettingsValues>;
  subscribe?(listener: (values: SettingsValues) => void): () => void;
  loadStatus?(): Readonly<Record<string, SettingsStatusSnapshot>> | Promise<Readonly<Record<string, SettingsStatusSnapshot>>>;
  subscribeStatus?(listener: (status: Readonly<Record<string, SettingsStatusSnapshot>>) => void): () => void;
  loadFieldState?(): SettingsFieldStateMap | Promise<SettingsFieldStateMap>;
  subscribeFieldState?(listener: (state: SettingsFieldStateMap) => void): () => void;
}
