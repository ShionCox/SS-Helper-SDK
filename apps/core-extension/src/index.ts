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

export const CORE_EXTENSION_SKELETON = Object.freeze({
  id: 'ss-helper.core',
  installDirectory: 'third-party/SS-Helper-SDK',
  coreVersion: '2.2.0',
  apiMajor: 2,
  apiMinor: 2,
});
