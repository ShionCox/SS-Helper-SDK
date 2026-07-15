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
export interface TextField extends SettingsFieldBase<'text'> { readonly defaultValue?: string; readonly placeholder?: string; readonly validation?: ValidationRule; readonly secret?: boolean; }
export interface NumberField extends SettingsFieldBase<'number'> { readonly defaultValue?: number; readonly validation?: ValidationRule; }
export interface RangeField extends SettingsFieldBase<'range'> { readonly min: number; readonly max: number; readonly step?: number; readonly defaultValue?: number; }
export interface SelectField extends SettingsFieldBase<'select'> { readonly options: readonly { readonly value: string; readonly label: string }[]; readonly defaultValue?: string; }
export interface ActionField extends SettingsFieldBase<'action'> { readonly actionId: string; readonly tone?: 'neutral' | 'danger'; readonly popup?: PopupToken; }
export interface StatusField extends SettingsFieldBase<'status'> { readonly value: string; readonly tone?: 'neutral' | 'success' | 'warning' | 'error'; }

export type SettingsField = SectionField | ToggleField | TextField | NumberField | RangeField | SelectField | ActionField | StatusField;

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
}
