import type { PlainData } from './plain-data.js';
import type { SelectField, SettingsField, SettingsOption } from './settings.js';
import type { ChatMessageSnapshot } from './host.js';

declare const POPUP_TOKEN_INPUT: unique symbol;

export interface PopupToken<Input extends PlainData = PlainData> {
  /** Compile-time-only marker that binds a token to its popup input DTO. */
  readonly [POPUP_TOKEN_INPUT]?: Input;
  readonly kind: 'popup';
  readonly provider: string;
  readonly name: string;
  readonly version: number;
}

export type PopupPresentation = 'default' | 'workspace';

export const UI_CONTROL_ATTRIBUTE = 'data-ss-helper-control' as const;
export const UI_CONTROL_TONE_ATTRIBUTE = 'data-ss-helper-tone' as const;
export const UI_CONTROL_SIZE_ATTRIBUTE = 'data-ss-helper-size' as const;
export const UI_CONTROL_ICON_ONLY_ATTRIBUTE = 'data-ss-helper-icon-only' as const;
export type UiControlKind = 'button' | 'segmented' | 'input' | 'textarea' | 'checkbox' | 'select' | 'status' | 'progress' | 'file-trigger' | 'toggle' | 'menu' | 'list';
export type UiControlTone = 'neutral' | 'primary' | 'danger' | 'success' | 'warning' | 'error';
export type UiControlSize = 'xs' | 'sm' | 'md' | 'lg';

export interface PopupCustomSelectField extends SelectField {
  /** Keeps a Core-owned manual entry available when discovery is unavailable or incomplete. */
  readonly allowCustom?: boolean;
  readonly customPlaceholder?: string;
}
export type PopupSegmentedField = Omit<Extract<SettingsField, { kind: 'radio' }>, 'kind'> & {
  readonly kind: 'segmented';
};
export type PopupFormField =
  (Exclude<SettingsField, { kind: 'section' | 'action' | 'select' }>
  | PopupCustomSelectField
  | PopupSegmentedField) & {
    readonly span?: 'half' | 'full';
    readonly trailingAction?: { readonly id: string; readonly label: string; readonly icon: string };
  };
export interface PopupFormSection {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly status?: PopupWizardSnapshot['status'];
  readonly column?: 'primary' | 'secondary';
  readonly collapsible?: boolean;
  readonly fields: readonly PopupFormField[];
}
export type PopupWizardCheckState = 'idle' | 'running' | 'success' | 'error';

export interface PopupWizardStep {
  readonly id: string;
  readonly label: string;
  readonly title?: string;
  readonly description?: string;
  readonly fields: readonly PopupFormField[];
}

export interface PopupWizardAside {
  readonly title: string;
  readonly description?: string;
  readonly checks: readonly {
    readonly id: string;
    readonly label: string;
    readonly icon?: string;
    readonly description?: string;
  }[];
}

export interface PopupDiscardConfirmation {
  readonly title: string;
  readonly message: string;
}

export interface PopupWizardDefinition {
  readonly id: string;
  readonly steps: readonly PopupWizardStep[];
  readonly submitLabel: string;
  readonly busyLabel?: string;
  readonly aside?: PopupWizardAside;
  readonly confirmDiscard?: PopupDiscardConfirmation;
  /** Direct editing uses the same fields and close protection without step navigation. */
  readonly form?: { readonly sections: readonly PopupFormSection[]; readonly description?: string; readonly footerHint?: string };
}

export interface PopupWizardCheckSnapshot {
  readonly state: PopupWizardCheckState;
  readonly description?: string;
}

export interface PopupWizardSnapshot {
  readonly activeStepId: string;
  readonly completedStepIds: readonly string[];
  readonly values: Readonly<Record<string, PlainData>>;
  readonly fieldErrors?: Readonly<Record<string, string>>;
  readonly fieldOptions?: Readonly<Record<string, readonly SettingsOption[]>>;
  readonly disabledFieldIds?: readonly string[];
  /** Fields omitted from the rendered form and accessibility tree for this snapshot. */
  readonly hiddenFieldIds?: readonly string[];
  readonly dirty?: boolean;
  readonly busy?: boolean;
  readonly submitDisabled?: boolean;
  readonly status?: {
    readonly tone: 'neutral' | 'success' | 'warning' | 'error';
    readonly message: string;
    readonly code?: string;
  };
  readonly checks?: Readonly<Record<string, PopupWizardCheckSnapshot>>;
}

export interface PopupWizardAdapter {
  snapshot(): PopupWizardSnapshot;
  change(fieldId: string, value: PlainData): void;
  navigate(stepId: string): void;
  back(): void;
  submit(): void | Promise<void>;
  action?(actionId: string): void | Promise<void>;
  subscribe?(listener: () => void): () => void;
}

export interface PopupWizardHandle {
  update(snapshot?: PopupWizardSnapshot): void;
  focusField(fieldId: string): void;
  dispose(): void;
}

export interface PopupButtonOptions {
  readonly label: string;
  readonly ariaLabel?: string;
  readonly icon?: string;
  readonly iconOnly?: boolean;
  readonly tone?: 'neutral' | 'primary' | 'danger';
  readonly size?: UiControlSize;
  readonly disabled?: boolean;
}

export interface PopupIconOptions {
  readonly name: string;
  readonly label?: string;
  readonly decorative?: boolean;
  readonly fixedWidth?: boolean;
}

export interface PopupToggleOptions {
  readonly label: string;
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly onChange: (checked: boolean) => void | Promise<void>;
}

export interface PopupMenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: string;
  readonly tone?: 'neutral' | 'danger';
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly separatorBefore?: boolean;
}

export interface PopupMenuOptions {
  readonly label: string;
  readonly items: readonly PopupMenuItem[];
  readonly onSelect: (itemId: string) => void | Promise<void>;
}

export interface PopupMenuHandle {
  readonly element: HTMLElement;
  update(items: readonly PopupMenuItem[]): void;
  dispose(): void;
}

export interface PopupListRequest {
  readonly cursor?: string;
  readonly limit: number;
  readonly signal: AbortSignal;
}

export interface PopupListPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly total?: number;
}

export interface PopupListItemContext {
  readonly index: number;
  readonly selected: boolean;
  readonly focused: boolean;
  readonly setSize?: number;
}

export interface PopupListDefinition<T> {
  /** Stable within the popup. Reusing an id reattaches the same cached list instance. */
  readonly id: string;
  readonly ariaLabel: string;
  /** Changes whenever search, filters, sorting, or chat scope changes. */
  readonly queryKey: string;
  readonly loadPage: (request: PopupListRequest) => Promise<PopupListPage<T>>;
  readonly getKey: (item: T) => string;
  readonly renderItem: (item: T, context: PopupListItemContext) => HTMLElement;
  readonly selectable?: boolean;
  readonly selectedKey?: string;
  readonly onSelect?: (item: T, context: PopupListItemContext) => void | Promise<void>;
  readonly pageSize?: number;
  readonly overscan?: number;
  readonly maxCachedPages?: number;
  /** Fixed row height. Omit it to enable measured dynamic rows. */
  readonly itemHeight?: number;
  /** Visual space between rows, reserved inside each fixed or measured row slot. */
  readonly itemGap?: number;
  readonly estimatedItemHeight?: number;
  readonly emptyLabel?: string;
  readonly loadingLabel?: string;
  readonly errorLabel?: string;
}

export interface PopupListHandle {
  readonly element: HTMLElement;
  refresh(options?: { readonly preserveAnchor?: boolean }): void;
  scrollToKey(key: string, options?: { readonly align?: 'start' | 'center' | 'end' }): Promise<boolean>;
  selectedKey(): string | undefined;
  dispose(): void;
}

export interface PopupInputOptions {
  readonly label: string;
  readonly type?: 'text' | 'password' | 'search' | 'url' | 'number';
  readonly value?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
}

export interface PopupTextareaOptions {
  readonly label: string;
  readonly value?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
}

export interface PopupSelectOptions {
  readonly label: string;
  readonly options: readonly SettingsOption[];
  readonly value?: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
}

export interface PopupConfirmationOptions {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly danger?: boolean;
}

export interface CoreUiControlContext {
  createButton(options: PopupButtonOptions): HTMLButtonElement;
  createIcon(options: PopupIconOptions): HTMLElement;
  createInput(options: PopupInputOptions): HTMLInputElement;
  createTextarea(options: PopupTextareaOptions): HTMLTextAreaElement;
  createSelect(options: PopupSelectOptions): HTMLElement;
  confirm(options: PopupConfirmationOptions): Promise<boolean>;
  createToggle(options: PopupToggleOptions): HTMLButtonElement;
  createMenu(options: PopupMenuOptions): PopupMenuHandle;
  /** Writes user-requested text to the clipboard without logging or retaining the payload. */
  copyText(text: string): Promise<void>;
  /** Closes the current Core-owned surface. */
  close(): void;
}

export interface PopupUiContext extends CoreUiControlContext {
  /** Re-applies Core-owned component behavior after a plugin replaces popup DOM. */
  refreshControls(root?: HTMLElement): void;
  /** Mounts a Core-owned accessible form, with optional multi-step navigation. */
  mountWizard(definition: PopupWizardDefinition, adapter: PopupWizardAdapter): PopupWizardHandle;
  /** Mounts or reattaches a Core-owned cursor-paged virtual list. */
  mountList<T>(host: HTMLElement, definition: PopupListDefinition<T>): PopupListHandle;
}

export interface PopupRegistration<Input extends PlainData = PlainData> {
  readonly token: PopupToken<Input>;
  readonly title: string;
  readonly ariaLabel?: string;
  readonly closeLabel?: string;
  readonly presentation?: PopupPresentation;
  render(container: HTMLElement, input: Input, ui?: PopupUiContext): void | (() => void);
}

export type ToastLevel = 'info' | 'success' | 'warning' | 'error';

export interface ToastNotification {
  readonly level: ToastLevel;
  readonly message: string;
  readonly title?: string;
  readonly code?: string;
  readonly durationMs?: number;
}

export type ChatIndicatorKind = 'direct' | 'dependency';
export type ChatIndicatorState = 'hidden' | 'enabled' | 'retained';

export interface ChatIndicatorTarget {
  /** Stable opaque identity generated by Core for this workspace/chat pair. */
  readonly key: string;
  readonly workspaceId: string;
  readonly chatKey: string;
  readonly characterId?: string;
  readonly groupId?: string;
}

export interface ChatIndicatorResolution {
  readonly targetKey: string;
  readonly state: ChatIndicatorState;
  /** Dependencies actively used by this plugin for this chat. */
  readonly activeDependencies?: readonly `${string}.${string}`[];
}

export interface ChatIndicatorRegistration {
  readonly label: string;
  /** Safe Font Awesome glyph name without the `fa-` prefix. */
  readonly icon: string;
  readonly kind?: ChatIndicatorKind;
  readonly order?: number;
  resolve(targets: readonly ChatIndicatorTarget[]): readonly ChatIndicatorResolution[] | Promise<readonly ChatIndicatorResolution[]>;
  subscribe?(listener: (targetKeys?: readonly string[]) => void): () => void;
}

export interface ExtensionMenuItemRegistration {
  /** Stable identifier unique within the registering plugin. */
  readonly id: string;
  readonly label: string;
  /** Safe Font Awesome glyph name without the `fa-` prefix. */
  readonly icon: string;
  /** Lower values appear first inside the Core-owned SS-Helper group. */
  readonly order?: number;
  onActivate(): void | Promise<void>;
}

export type ChatMessageActionState = 'hidden' | 'enabled' | 'disabled';

export interface ChatMessageActionTarget {
  /** Opaque identity for the current workspace/chat/message variant. */
  readonly key: string;
  readonly workspaceId: string;
  readonly chatKey: string;
  readonly message: ChatMessageSnapshot;
}

export interface ChatMessageActionResolution {
  readonly targetKey: string;
  readonly state: ChatMessageActionState;
  readonly ariaLabel?: string;
  readonly disabledReason?: string;
  readonly window?: ChatMessageActionWindowState;
}

export interface ChatMessageActionWindowState {
  readonly title: string;
  readonly subtitle?: string;
  readonly status?: Readonly<{ label: string; tone?: 'success' | 'warning' | 'danger' | 'neutral' }>;
}

export interface ChatMessageActionWindowPresentation {
  readonly kind: 'window';
  readonly initialWidth: number;
  readonly initialHeight: number;
  readonly minWidth: number;
  readonly minHeight: number;
  readonly draggable?: boolean;
  readonly resizable?: boolean;
  readonly minimizable?: boolean;
  readonly persistKey?: string;
}

export interface ChatMessageActionResolveContext {
  /** Aborted when the chat scope changes, a newer resolution supersedes this one, or the session is disposed. */
  readonly signal: AbortSignal;
}

export interface ChatMessageActionUiContext extends CoreUiControlContext {
  /** Mounts a Core-owned cursor-paged virtual list inside the action panel. */
  mountList<T>(host: HTMLElement, definition: PopupListDefinition<T>): PopupListHandle;
}

export interface ChatMessageActionRegistration {
  /** Stable identifier unique within the registering plugin. */
  readonly id: string;
  readonly label: string;
  /** Safe Font Awesome glyph name without the `fa-` prefix. */
  readonly icon: string;
  readonly order?: number;
  /** Defaults to the legacy anchor popover when omitted. */
  readonly presentation?: ChatMessageActionWindowPresentation;
  /**
   * Resolves actions for any targets whose availability is currently known.
   * A target may be omitted while an asynchronous lookup is in progress; Core
   * will leave it uncached until the registration publishes a targeted update.
   */
  resolve(
    targets: readonly ChatMessageActionTarget[],
    context?: ChatMessageActionResolveContext,
  ): readonly ChatMessageActionResolution[] | Promise<readonly ChatMessageActionResolution[]>;
  subscribe?(listener: (targetKeys?: readonly string[]) => void): () => void;
  render(
    container: HTMLElement,
    target: ChatMessageActionTarget,
    ui: ChatMessageActionUiContext,
  ): void | (() => void) | Promise<void | (() => void)>;
}

export interface UiPort {
  openPopup<Input extends PlainData>(token: PopupToken<Input>, input: Input): void;
  showToast(notification: ToastNotification): void;
}
