import type { PlainData } from './plain-data.js';

export interface PopupToken<Input extends PlainData = PlainData> {
  readonly kind: 'popup';
  readonly provider: string;
  readonly name: string;
  readonly version: number;
}

export type PopupPresentation = 'default' | 'workspace';

export const UI_CONTROL_ATTRIBUTE = 'data-ss-helper-control' as const;
export const UI_CONTROL_TONE_ATTRIBUTE = 'data-ss-helper-tone' as const;
export type UiControlKind = 'button' | 'input' | 'textarea' | 'checkbox' | 'select' | 'status' | 'progress' | 'file-trigger';
export type UiControlTone = 'neutral' | 'primary' | 'danger' | 'success' | 'warning' | 'error';

export interface PopupUiContext {
  /** Re-applies Core-owned component behavior after a plugin replaces popup DOM. */
  refreshControls(root?: HTMLElement): void;
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

export interface UiPort {
  openPopup<Input extends PlainData>(token: PopupToken<Input>, input: Input): void;
  showToast(notification: ToastNotification): void;
}
