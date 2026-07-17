import type { PlainData } from './plain-data.js';

export interface PopupToken<Input extends PlainData = PlainData> {
  readonly kind: 'popup';
  readonly provider: string;
  readonly name: string;
  readonly version: number;
}

export type PopupPresentation = 'default' | 'workspace';

export interface PopupRegistration<Input extends PlainData = PlainData> {
  readonly token: PopupToken<Input>;
  readonly title: string;
  readonly ariaLabel?: string;
  readonly presentation?: PopupPresentation;
  render(container: HTMLElement, input: Input): void | (() => void);
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
