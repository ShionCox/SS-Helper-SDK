import { API_VERSION, SDK_PACKAGE_VERSION } from '@ss-helper/sdk';

export { CoreRuntime, type CoreRuntimeIdentity, type CoreRuntimeOptions } from './runtime/core-runtime.js';
export { installCoreRuntime } from './runtime/install-core-runtime.js';
export { PluginRegistry, type PluginSnapshot } from './plugins/plugin-registry.js';
export { createTavernHostPort, type TavernHostAdapter } from './host/tavern-host-port.js';
export { createSillyTavernHostBridge, type SillyTavernHostBridge } from './host/silly-tavern-adapter.js';
export {
  SettingsHost,
  SETTINGS_ROOT_ID,
  SETTINGS_CENTER_ID,
  SETTINGS_CENTER_OVERLAY_ID,
  type SettingsContributionSnapshot,
} from './settings/settings-host.js';
export { PopupHost } from './popup/popup-host.js';
export { ToastHost } from './toast/toast-host.js';
export { ChatIndicatorHost, chatIndicatorTargetFromRow } from './chat/chat-indicator-host.js';
export { ExtensionMenuHost, SS_HELPER_EXTENSION_MENU_GROUP_ID } from './ui/extension-menu-host.js';
export { createIconElement, ensureIconElement, SS_HELPER_ICON_TAG, type IconOptions } from './ui/icon-element.js';

export const CORE_EXTENSION_SKELETON = Object.freeze({
  id: 'ss-helper.core',
  installDirectory: 'third-party/SS-Helper-SDK',
  coreVersion: SDK_PACKAGE_VERSION,
  apiVersion: API_VERSION,
});
