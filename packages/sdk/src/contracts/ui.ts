import type { PlainData } from './plain-data.js';

export interface PopupToken<Input extends PlainData = PlainData> {
  readonly kind: 'popup';
  readonly provider: string;
  readonly name: string;
  readonly version: number;
}

export interface PopupRegistration<Input extends PlainData = PlainData> {
  readonly token: PopupToken<Input>;
  readonly title: string;
  readonly ariaLabel?: string;
  render(container: HTMLElement, input: Input): void | (() => void);
}

export interface UiPort {
  openPopup<Input extends PlainData>(token: PopupToken<Input>, input: Input): void;
}
