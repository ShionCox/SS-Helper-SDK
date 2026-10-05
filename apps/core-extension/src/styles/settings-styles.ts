export const SETTINGS_CSS = `
:where(#ss-helper-settings-root, #ss-helper-settings-center-overlay, #ss-helper-toast-root, [data-ss-helper-popup], .stx-popup-menu-list, .stx-popup-confirm-overlay, [data-ss-helper-message-action-panel]) {
  --ss-theme-surface: var(--SmartThemeBlurTintColor, #171717);
  --ss-theme-surface-2: color-mix(in srgb, var(--SmartThemeBlurTintColor, #171717) 88%, white 12%);
  --ss-theme-surface-3: rgba(0, 0, 0, .22);
  --ss-theme-text: var(--SmartThemeBodyColor, #ececec);
  --ss-theme-muted: var(--SmartThemeEmColor, #a7a7a7);
  --ss-theme-border: var(--SmartThemeBorderColor, rgba(255, 255, 255, .16));
  --ss-theme-border-strong: #b98b2f;
  --ss-theme-accent: #d2a84a;
  --ss-theme-accent-soft: rgba(210, 168, 74, .13);
  --ss-theme-danger: #f05d5d;
  --ss-theme-success: #54c66b;
  --ss-theme-warning: #e4ad46;
  color: var(--ss-theme-text);
  font-family: var(--mainFontFamily, "Segoe UI", "Microsoft YaHei UI", sans-serif);
  font-size: 14px;
}

:where(#ss-helper-settings-root, #ss-helper-settings-center-overlay, #ss-helper-toast-root, [data-ss-helper-popup], .stx-popup-menu-list, .stx-popup-confirm-overlay, [data-ss-helper-message-action-panel]) *,
:where(#ss-helper-settings-root, #ss-helper-settings-center-overlay, #ss-helper-toast-root, [data-ss-helper-popup], .stx-popup-menu-list, .stx-popup-confirm-overlay, [data-ss-helper-message-action-panel]) *::before,
:where(#ss-helper-settings-root, #ss-helper-settings-center-overlay, #ss-helper-toast-root, [data-ss-helper-popup], .stx-popup-menu-list, .stx-popup-confirm-overlay, [data-ss-helper-message-action-panel]) *::after { box-sizing: border-box; }

#chat .mes_buttons > button.stx-chat-message-action {
  appearance: none; border: 0; margin: 0; background: transparent; color: inherit;
  font: inherit; line-height: inherit;
  transition:
    opacity var(--animation-duration-2x, 250ms) ease-in-out,
    transform var(--animation-duration, 125ms) ease-out;
}
#chat .mes_buttons > button.stx-chat-message-action:is(:hover, :focus-visible, .is-open) { opacity: 1; }
#chat .mes_buttons > button.stx-chat-message-action:active { opacity: 1; transform: scale(.84); }
#chat .mes_buttons > button.stx-chat-message-action:focus-visible {
  outline: 2px solid var(--SmartThemeQuoteColor, #d2a84a); outline-offset: 1px;
}
#chat .mes_buttons > button.stx-chat-message-action:disabled { opacity: .3; cursor: not-allowed; transform: none; }
#chat .mes_buttons > button.stx-chat-message-action > * { width: 1em; height: 1em; pointer-events: none; }
@media (prefers-reduced-motion: reduce) {
  #chat .mes_buttons > button.stx-chat-message-action { transition: none; }
  #chat .mes_buttons > button.stx-chat-message-action:active { transform: none; }
}

[data-ss-helper-message-action-panel] {
  position: fixed; inset: 0; z-index: 10030; pointer-events: none;
}
[data-ss-helper-message-action-panel] > .stx-chat-message-action-panel {
  position: fixed; width: min(580px, calc(100vw - 24px)); max-height: min(720px, calc(100vh - 24px));
  overflow: auto; overscroll-behavior: contain; pointer-events: auto; outline: none;
  border: 1px solid var(--ss-theme-border); border-radius: 8px;
  background: var(--ss-theme-surface); box-shadow: 0 18px 56px rgba(0, 0, 0, .58);
}
[data-ss-helper-message-action-panel] > .stx-chat-message-action-panel:focus-visible {
  outline: 2px solid rgba(210, 168, 74, .45); outline-offset: 2px;
}
[data-ss-helper-message-action-panel] .stx-chat-message-action-loading {
  min-height: 96px; display: grid; place-items: center; padding: 18px;
  color: var(--ss-theme-muted); text-align: center;
}
[data-ss-helper-message-action-panel] :where(h1, h2, h3, h4, p, ul, ol, dl) { margin: 0; }
[data-ss-helper-message-action-panel][data-mobile="true"] > .stx-chat-message-action-panel {
  width: auto; max-height: min(78vh, 720px); border-radius: 10px 10px 6px 6px;
}
[data-ss-helper-message-action-panel][data-presentation="window"] { pointer-events: none; }
[data-ss-helper-message-action-panel] > .stx-chat-message-action-window {
  display: flex; flex-direction: column; overflow: hidden; max-height: none; min-width: 0; min-height: 0;
  border-color: color-mix(in srgb, var(--SmartThemeQuoteColor, #d2a84a) 34%, var(--ss-theme-border));
  border-radius: 10px; background: color-mix(in srgb, var(--ss-theme-surface) 97%, #000);
}
.stx-chat-action-window-header {
  flex: 0 0 auto; min-height: 58px; display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 10px 12px 10px 14px; border-bottom: 1px solid var(--ss-theme-border); cursor: move; user-select: none;
  background: color-mix(in srgb, var(--ss-theme-elevated, #1e2023) 92%, #000);
}
.stx-chat-action-window-identity { display: flex; align-items: center; min-width: 0; gap: 10px; }
.stx-chat-action-window-icon { width: 30px; height: 30px; display: grid; place-items: center; flex: 0 0 auto; border-radius: 7px; color: var(--SmartThemeQuoteColor, #d2a84a); background: rgba(210,168,74,.1); border: 1px solid rgba(210,168,74,.25); }
.stx-chat-action-window-title-line { min-width: 0; display: flex; align-items: center; gap: 7px; }
.stx-chat-action-window-title { font-size: 15px; line-height: 1.25; font-weight: 700; color: var(--ss-theme-text); }
.stx-chat-action-window-subtitle { margin-top: 3px !important; color: var(--ss-theme-muted); font-size: 11px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.stx-chat-action-window-commands { display: flex; align-items: center; gap: 5px; }
.stx-chat-action-window-status { padding: 3px 7px; border-radius: 999px; font-size: 10px; color: var(--ss-theme-muted); border: 1px solid var(--ss-theme-border); }
.stx-chat-action-window-status[data-tone="success"] { color: #8dd8a8; border-color: rgba(75,176,112,.45); background: rgba(75,176,112,.1); }
.stx-chat-action-window-status[data-tone="warning"] { color: #e4c276; border-color: rgba(210,168,74,.45); background: rgba(210,168,74,.1); }
.stx-chat-action-window-status[data-tone="danger"] { color: #ee9a9a; border-color: rgba(211,87,87,.45); background: rgba(211,87,87,.1); }
.stx-chat-action-window-command { width: 28px; height: 28px; padding: 0; display: grid; place-items: center; border: 0; border-radius: 6px; color: var(--ss-theme-muted); background: transparent; cursor: pointer; transition: color 120ms ease, background 120ms ease, transform 80ms ease; }
.stx-chat-action-window-command:hover { color: var(--ss-theme-text); background: rgba(255,255,255,.07); }
.stx-chat-action-window-command:active { transform: scale(.9); }
.stx-chat-action-window-command:focus-visible { outline: 2px solid rgba(210,168,74,.5); outline-offset: 1px; }
.stx-chat-action-window-body { flex: 1 1 auto; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
.stx-chat-action-window-resize { position: absolute; right: 0; bottom: 0; width: 22px; height: 22px; padding: 0; border: 0; background: linear-gradient(135deg, transparent 45%, rgba(210,168,74,.72) 46%, rgba(210,168,74,.72) 52%, transparent 53%, transparent 64%, rgba(210,168,74,.45) 65%, rgba(210,168,74,.45) 71%, transparent 72%); cursor: nwse-resize; }
.stx-chat-message-action-window[data-minimized="true"] { min-width: 320px; height: auto !important; }
[data-ss-helper-message-action-panel][data-mobile="true"] > .stx-chat-message-action-window { border-radius: 9px; max-height: none; }
[data-ss-helper-message-action-panel][data-mobile="true"] .stx-chat-action-window-header { cursor: default; }
@media (prefers-reduced-motion: reduce) { .stx-chat-action-window-command { transition: none; } .stx-chat-action-window-command:active { transform: none; } }

#ss-helper-extension-menu-group { display: block; }
#ss-helper-extension-menu-group > .stx-extension-menu-item {
  appearance: none; width: 100%; border: 0; padding: 5px; display: flex; align-items: center; gap: 10px;
  background: transparent; color: var(--SmartThemeBodyColor, #ececec); font: inherit; text-align: left;
  opacity: .5; cursor: pointer;
}
#ss-helper-extension-menu-group > .stx-extension-menu-item:hover,
#ss-helper-extension-menu-group > .stx-extension-menu-item:focus-visible {
  opacity: 1; background: color-mix(in srgb, var(--SmartThemeBodyColor, #ececec) 8%, transparent);
}
#ss-helper-extension-menu-group > .stx-extension-menu-item:focus-visible {
  outline: 2px solid var(--SmartThemeQuoteColor, #d2a84a); outline-offset: -2px;
}
#ss-helper-extension-menu-group > .stx-extension-menu-item:is(:disabled, [aria-disabled="true"]) { opacity: .35; cursor: wait; }
#ss-helper-extension-menu-group > .stx-extension-menu-item > span { min-width: 0; overflow-wrap: anywhere; }

#ss-helper-settings-root { display: block; padding: .75rem; }
#ss-helper-settings-root .stx-launcher-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: .65rem; }
#ss-helper-settings-root .stx-ui-title { margin: 0 0 .12rem; font-size: 1.05rem; font-weight: 700; }
#ss-helper-settings-root .stx-ui-subtitle { color: var(--ss-theme-muted); line-height: 1.4; }
#ss-helper-settings-root .stx-launcher-card {
  display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: .8rem;
  min-width: 0; padding: .72rem .8rem; border: 1px solid var(--ss-theme-border); border-radius: 6px;
  background: rgba(0, 0, 0, .12); box-shadow: 0 4px 16px rgba(0, 0, 0, .12);
}
#ss-helper-settings-root .stx-launcher-icon,
#ss-helper-settings-center .stx-center-brand-icon {
  display: grid; place-items: center; width: 2.2rem; height: 2.2rem; border: 1px solid rgba(210, 168, 74, .42);
  border-radius: 6px; background: var(--ss-theme-accent-soft); color: var(--ss-theme-accent); font-size: 1rem;
}
#ss-helper-settings-root .stx-launcher-copy { display: grid; gap: .15rem; min-width: 0; }
#ss-helper-settings-root .stx-launcher-copy strong { font-size: .96rem; }
#ss-helper-settings-root .stx-launcher-copy small { color: var(--ss-theme-muted); overflow-wrap: anywhere; }

#ss-helper-settings-center-overlay {
  position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; padding: 24px;
  background: rgba(0, 0, 0, .7); backdrop-filter: blur(3px);
}
#ss-helper-settings-center {
  width: min(1320px, calc(100vw - 48px)); height: min(880px, calc(100vh - 48px)); min-height: 560px;
  display: grid; grid-template-rows: 72px minmax(0, 1fr); overflow: hidden;
  border: 1px solid rgba(210, 168, 74, .62); border-radius: 7px; outline: none;
  background: var(--ss-theme-surface); box-shadow: 0 28px 90px rgba(0, 0, 0, .62);
}
#ss-helper-settings-center .stx-center-header {
  display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 0 22px;
  border-bottom: 1px solid var(--ss-theme-border); background: rgba(0, 0, 0, .14);
}
#ss-helper-settings-center .stx-center-brand { display: flex; align-items: center; gap: .75rem; min-width: 0; }
#ss-helper-settings-center .stx-center-brand h2 { margin: 0 0 .12rem; font-size: 1.18rem; font-weight: 700; }
#ss-helper-settings-center .stx-center-brand small { color: var(--ss-theme-muted); }
#ss-helper-settings-center .stx-center-close {
  display: grid; place-items: center; width: 36px; height: 36px; border: 0;
  border-radius: 6px; background: transparent; color: var(--ss-theme-muted); cursor: pointer; font-size: 1rem;
}
#ss-helper-settings-center .stx-center-close:hover,
#ss-helper-settings-center .stx-center-close:focus-visible { color: var(--ss-theme-text); background: var(--ss-theme-accent-soft); outline: 2px solid rgba(210, 168, 74, .24); outline-offset: 1px; }

#ss-helper-settings-center .stx-center-body { min-height: 0; display: grid; grid-template-columns: 238px minmax(0, 1fr); }
#ss-helper-settings-center .stx-center-sidebar {
  min-height: 0; display: flex; flex-direction: column; padding: 18px 12px 14px;
  border-right: 1px solid var(--ss-theme-border); background: rgba(0, 0, 0, .12);
}
#ss-helper-settings-center .stx-center-nav-label { padding: 0 10px 8px; color: var(--ss-theme-muted); font-size: .72rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
#ss-helper-settings-center .stx-center-nav { display: grid; gap: 5px; overflow: auto; }
#ss-helper-settings-center .stx-center-nav-item {
  width: 100%; display: grid; grid-template-columns: 34px minmax(0, 1fr) auto; align-items: center; gap: 9px;
  padding: 9px 10px; border: 1px solid transparent; border-radius: 6px; background: transparent;
  color: var(--ss-theme-text); cursor: pointer; text-align: left; font: inherit;
}
#ss-helper-settings-center .stx-center-nav-item:hover,
#ss-helper-settings-center .stx-center-nav-item:focus-visible { border-color: var(--ss-theme-border); background: rgba(255, 255, 255, .04); outline: none; }
#ss-helper-settings-center .stx-center-nav-item[aria-current="page"] { border-color: rgba(210, 168, 74, .46); background: var(--ss-theme-accent-soft); }
#ss-helper-settings-center .stx-center-nav-icon { display: grid; place-items: center; width: 32px; height: 32px; color: var(--ss-theme-muted); }
#ss-helper-settings-center .stx-center-nav-item[aria-current="page"] .stx-center-nav-icon { color: var(--ss-theme-accent); }
#ss-helper-settings-center .stx-center-nav-copy { display: grid; gap: 2px; min-width: 0; }
#ss-helper-settings-center .stx-center-nav-copy strong,
#ss-helper-settings-center .stx-center-nav-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#ss-helper-settings-center .stx-center-nav-copy strong { font-size: .88rem; font-weight: 600; }
#ss-helper-settings-center .stx-center-nav-copy small { color: var(--ss-theme-muted); font-size: .72rem; }
#ss-helper-settings-center .stx-health-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ss-theme-muted); }
#ss-helper-settings-center .stx-health-dot-healthy { background: var(--ss-theme-success); box-shadow: 0 0 0 3px rgba(84, 198, 107, .12); }
#ss-helper-settings-center .stx-health-dot-degraded { background: #e4ad46; box-shadow: 0 0 0 3px rgba(228, 173, 70, .12); }
#ss-helper-settings-center .stx-center-sidebar-meta { margin-top: auto; padding: 12px 10px 0; color: var(--ss-theme-muted); font-size: .7rem; line-height: 1.45; }

#ss-helper-settings-center .stx-center-main { min-width: 0; min-height: 0; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; }
#ss-helper-settings-center .stx-center-page-heading {
  min-height: 82px; display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 15px 22px;
  border-bottom: 1px solid var(--ss-theme-border); background: rgba(0, 0, 0, .06);
}
#ss-helper-settings-center .stx-center-page-heading h3 { margin: 0 0 4px; font-size: 1.16rem; }
#ss-helper-settings-center .stx-center-page-heading p { margin: 0; color: var(--ss-theme-muted); font-size: .82rem; }
#ss-helper-settings-center .stx-center-page-badges { display: flex; align-items: center; gap: 7px; }
#ss-helper-settings-center .stx-center-scroll { min-height: 0; overflow: auto; scrollbar-color: rgba(210, 168, 74, .42) transparent; }
#ss-helper-settings-center .stx-center-plugin-content { display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(min-content, 1fr); align-content: start; }
#ss-helper-settings-center .stx-ui-fields { min-width: 0; }
#ss-helper-settings-center .stx-center-searchbar {
  position: relative; display: flex; align-items: center; margin: 14px 20px 10px;
}
#ss-helper-settings-center .stx-center-searchbar > ss-helper-icon { position: absolute; left: 12px; z-index: 1; color: var(--ss-theme-muted); pointer-events: none; }
#ss-helper-settings-center .stx-center-searchbar .stx-ui-search { padding-left: 34px; }

:where(#ss-helper-settings-root, #ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel], .stx-popup-confirm-overlay) :is(.stx-ui-badge, [data-ss-helper-control="status"]) {
  display: inline-flex; align-items: center; min-height: 22px; padding: 3px 8px;
  border: 1px solid color-mix(in srgb, var(--ss-theme-text) 26%, transparent); border-radius: 999px;
  background: color-mix(in srgb, var(--ss-theme-text) 8%, transparent); color: var(--ss-theme-text);
  font-size: .72rem; line-height: 1; white-space: nowrap;
}
:where(#ss-helper-settings-root, #ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel], .stx-popup-confirm-overlay) :is(.stx-ui-badge-neutral, [data-ss-helper-control="status"][data-ss-helper-tone="neutral"]) {
  border-color: color-mix(in srgb, var(--ss-theme-text) 30%, transparent);
  background: color-mix(in srgb, var(--ss-theme-text) 10%, transparent); color: var(--ss-theme-text);
}
:where(#ss-helper-settings-root, #ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel], .stx-popup-confirm-overlay) [data-ss-helper-control="status"][data-ss-helper-tone="primary"] {
  border-color: color-mix(in srgb, var(--ss-theme-accent) 52%, transparent);
  background: color-mix(in srgb, var(--ss-theme-accent) 14%, transparent); color: var(--ss-theme-accent);
}
:where(#ss-helper-settings-root, #ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel], .stx-popup-confirm-overlay) :is(.stx-ui-badge-success, [data-ss-helper-control="status"][data-ss-helper-tone="success"]) {
  border-color: color-mix(in srgb, var(--ss-theme-success) 48%, transparent);
  background: color-mix(in srgb, var(--ss-theme-success) 14%, transparent);
  color: color-mix(in srgb, var(--ss-theme-success) 72%, var(--ss-theme-text));
}
:where(#ss-helper-settings-root, #ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel], .stx-popup-confirm-overlay) :is(.stx-ui-badge-warning, [data-ss-helper-control="status"][data-ss-helper-tone="warning"]) {
  border-color: color-mix(in srgb, var(--ss-theme-warning) 52%, transparent);
  background: color-mix(in srgb, var(--ss-theme-warning) 14%, transparent);
  color: color-mix(in srgb, var(--ss-theme-warning) 72%, var(--ss-theme-text));
}
:where(#ss-helper-settings-root, #ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel], .stx-popup-confirm-overlay) :is(.stx-ui-badge-error, [data-ss-helper-control="status"][data-ss-helper-tone="error"], [data-ss-helper-control="status"][data-ss-helper-tone="danger"]) {
  border-color: color-mix(in srgb, var(--ss-theme-danger) 52%, transparent);
  background: color-mix(in srgb, var(--ss-theme-danger) 14%, transparent);
  color: color-mix(in srgb, var(--ss-theme-danger) 72%, var(--ss-theme-text));
}
#ss-helper-settings-center .stx-ui-status-badge {
  --stx-status-color: color-mix(in srgb, var(--ss-theme-text) 72%, #8b95a5);
  min-height: 32px; max-width: 100%; padding: 7px 11px; border-radius: 6px;
  border-color: color-mix(in srgb, var(--stx-status-color) 62%, transparent);
  border-left: 3px solid var(--stx-status-color);
  background: color-mix(in srgb, var(--stx-status-color) 16%, var(--ss-theme-surface));
  color: var(--ss-theme-text); font-size: .8rem; font-weight: 650; line-height: 1.35;
  white-space: normal; overflow-wrap: anywhere;
  box-shadow: inset 0 1px 0 color-mix(in srgb, white 7%, transparent), 0 1px 2px rgba(0, 0, 0, .24);
}
#ss-helper-settings-center .stx-ui-status-badge.stx-ui-badge-success { --stx-status-color: var(--ss-theme-success); color: var(--ss-theme-text); }
#ss-helper-settings-center .stx-ui-status-badge.stx-ui-badge-warning { --stx-status-color: var(--ss-theme-warning); color: var(--ss-theme-text); }
#ss-helper-settings-center .stx-ui-status-badge.stx-ui-badge-error { --stx-status-color: var(--ss-theme-danger); color: var(--ss-theme-text); }

:where(#ss-helper-settings-root, #ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel], .stx-popup-confirm-overlay) :is(.stx-ui-btn, [data-ss-helper-control="button"], [data-ss-helper-control="file-trigger"]) {
  --ss-button-size: 36px; --ss-button-padding-inline: 16px; --ss-button-gap: 8px; --ss-button-radius: 5px;
  min-height: var(--ss-button-size); display: inline-flex; align-items: center; justify-content: center; gap: var(--ss-button-gap); padding: 0 var(--ss-button-padding-inline);
  border: 1px solid var(--ss-theme-border-strong); border-radius: var(--ss-button-radius); background: transparent;
  color: var(--ss-theme-text); cursor: pointer; font: inherit; font-weight: 600;
}
:where(#ss-helper-settings-root, #ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel], .stx-popup-confirm-overlay) :is([data-ss-helper-control="button"], [data-ss-helper-control="file-trigger"])[data-ss-helper-size="xs"] { --ss-button-size: 24px; --ss-button-padding-inline: 7px; --ss-button-gap: 4px; --ss-button-radius: 4px; font-size: .68rem; }
:where(#ss-helper-settings-root, #ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel], .stx-popup-confirm-overlay) :is([data-ss-helper-control="button"], [data-ss-helper-control="file-trigger"])[data-ss-helper-size="sm"] { --ss-button-size: 28px; --ss-button-padding-inline: 9px; --ss-button-gap: 5px; --ss-button-radius: 4px; font-size: .74rem; }
:where(#ss-helper-settings-root, #ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel], .stx-popup-confirm-overlay) :is([data-ss-helper-control="button"], [data-ss-helper-control="file-trigger"])[data-ss-helper-size="md"] { --ss-button-size: 36px; --ss-button-padding-inline: 16px; --ss-button-gap: 8px; --ss-button-radius: 5px; }
:where(#ss-helper-settings-root, #ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel], .stx-popup-confirm-overlay) :is([data-ss-helper-control="button"], [data-ss-helper-control="file-trigger"])[data-ss-helper-size="lg"] { --ss-button-size: 44px; --ss-button-padding-inline: 20px; --ss-button-gap: 9px; --ss-button-radius: 6px; font-size: .92rem; }
:where(#ss-helper-settings-root, #ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel], .stx-popup-confirm-overlay) :is(.stx-ui-btn, [data-ss-helper-control="button"], [data-ss-helper-control="file-trigger"]):hover,
:where(#ss-helper-settings-root, #ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel], .stx-popup-confirm-overlay) :is(.stx-ui-btn, [data-ss-helper-control="button"], [data-ss-helper-control="file-trigger"]):focus-visible { background: var(--ss-theme-accent-soft); outline: 2px solid rgba(210, 168, 74, .24); outline-offset: 1px; }
:where(#ss-helper-settings-root, #ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel], .stx-popup-confirm-overlay) :is(.stx-ui-btn-primary, [data-ss-helper-control="button"][data-ss-helper-tone="primary"], [data-ss-helper-control="file-trigger"][data-ss-helper-tone="primary"]) { border-color: var(--ss-theme-accent); background: var(--ss-theme-accent); color: #17120a; }
:where(#ss-helper-settings-root, #ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel], .stx-popup-confirm-overlay) :is(.stx-ui-btn-primary, [data-ss-helper-control="button"][data-ss-helper-tone="primary"], [data-ss-helper-control="file-trigger"][data-ss-helper-tone="primary"]):hover { background: #dfb95f; }
:where(#ss-helper-settings-root, #ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel], .stx-popup-confirm-overlay) :is(.stx-ui-btn-danger, [data-ss-helper-control="button"][data-ss-helper-tone="danger"], [data-ss-helper-control="file-trigger"][data-ss-helper-tone="danger"], [data-ss-helper-control="button"][data-ss-helper-tone="error"], [data-ss-helper-control="file-trigger"][data-ss-helper-tone="error"]) { border-color: rgba(240, 93, 93, .58); color: #ff9797; }
:where(#ss-helper-settings-root, #ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel], .stx-popup-confirm-overlay) :is([data-ss-helper-control="button"], [data-ss-helper-control="file-trigger"])[data-ss-helper-tone="success"] { border-color: color-mix(in srgb, var(--ss-theme-success) 58%, var(--ss-theme-border)); color: color-mix(in srgb, var(--ss-theme-success) 72%, var(--ss-theme-text)); }
:where(#ss-helper-settings-root, #ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel], .stx-popup-confirm-overlay) :is([data-ss-helper-control="button"], [data-ss-helper-control="file-trigger"])[data-ss-helper-tone="warning"] { border-color: color-mix(in srgb, var(--ss-theme-warning) 58%, var(--ss-theme-border)); color: color-mix(in srgb, var(--ss-theme-warning) 72%, var(--ss-theme-text)); }
:where(#ss-helper-settings-root, #ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel], .stx-popup-confirm-overlay) :is([data-ss-helper-control="button"], [data-ss-helper-control="file-trigger"])[data-ss-helper-icon-only] {
  width: var(--ss-button-size); min-width: var(--ss-button-size); height: var(--ss-button-size); min-height: var(--ss-button-size);
  padding: 0; border: 0; background: transparent; box-shadow: none;
}
:where(#ss-helper-settings-root, #ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel], .stx-popup-confirm-overlay) :is([data-ss-helper-control="button"], [data-ss-helper-control="file-trigger"])[data-ss-helper-icon-only]:hover,
:where(#ss-helper-settings-root, #ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel], .stx-popup-confirm-overlay) :is([data-ss-helper-control="button"], [data-ss-helper-control="file-trigger"])[data-ss-helper-icon-only]:focus-visible { border: 0; background: var(--ss-theme-accent-soft); }
:where(#ss-helper-settings-root, #ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel], .stx-popup-confirm-overlay) [data-ss-helper-control="segmented"] {
  display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); align-items: stretch; gap: 6px;
  padding: 3px; border: 0; border-radius: 7px;
  background: color-mix(in srgb, var(--ss-theme-surface-3) 72%, transparent);
}
:where(#ss-helper-settings-root, #ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel], .stx-popup-confirm-overlay) [data-ss-helper-control="segmented"] > [data-ss-helper-control="button"] {
  width: 100%; min-width: 0; border: 0; background: transparent; color: var(--ss-theme-muted); box-shadow: none;
  transition: background-color .16s ease, color .16s ease, filter .16s ease, transform .16s ease;
}
:where(#ss-helper-settings-root, #ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel], .stx-popup-confirm-overlay) [data-ss-helper-control="segmented"] > [data-ss-helper-control="button"]:hover {
  border: 0; outline: 0; background: color-mix(in srgb, var(--ss-theme-accent) 9%, transparent);
  color: var(--ss-theme-text); transform: translateY(-1px);
}
:where(#ss-helper-settings-root, #ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel], .stx-popup-confirm-overlay) [data-ss-helper-control="segmented"] > [data-ss-helper-control="button"]:active { transform: translateY(0); }
:where(#ss-helper-settings-root, #ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel], .stx-popup-confirm-overlay) [data-ss-helper-control="segmented"] > [data-ss-helper-control="button"]:focus-visible {
  border: 0; background: color-mix(in srgb, var(--ss-theme-accent) 9%, transparent);
}
:where(#ss-helper-settings-root, #ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel], .stx-popup-confirm-overlay) [data-ss-helper-control="segmented"] > [data-ss-helper-control="button"]:is([aria-pressed="true"], [aria-selected="true"]) {
  border: 0; background: color-mix(in srgb, var(--ss-theme-accent) 17%, var(--ss-theme-surface-2));
  color: var(--ss-theme-text); box-shadow: none; filter: brightness(1.12);
}
:where(#ss-helper-settings-root, #ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel], .stx-popup-confirm-overlay) :is(button, input, select, textarea):disabled { cursor: not-allowed; opacity: .48; }

#ss-helper-settings-center .stx-ui-tabs {
  display: flex; align-items: end; gap: 12px; min-height: 48px; padding: 0 20px; border-bottom: 1px solid var(--ss-theme-border);
}
#ss-helper-settings-center .stx-ui-tab {
  align-self: stretch; min-width: 76px; padding: 0 10px; border: 0; border-bottom: 2px solid transparent;
  background: transparent; color: var(--ss-theme-muted); cursor: pointer; font: inherit; font-weight: 600;
}
#ss-helper-settings-center .stx-ui-tab:hover,
#ss-helper-settings-center .stx-ui-tab:focus-visible { color: var(--ss-theme-text); outline: none; }
#ss-helper-settings-center .stx-ui-tab[aria-selected="true"] { border-bottom-color: var(--ss-theme-accent); color: var(--ss-theme-accent); }
#ss-helper-settings-center .stx-ui-panel[hidden] { display: none; }
#ss-helper-settings-center .stx-ui-fieldset { min-width: 0; margin: 14px 20px; padding: 0; border: 1px solid var(--ss-theme-border); border-radius: 6px; }
#ss-helper-settings-center .stx-ui-fieldset legend { margin-left: 12px; padding: 0 6px; color: var(--ss-theme-muted); font-size: .76rem; }
#ss-helper-settings-center .stx-ui-fieldset > summary { padding: 12px 16px; cursor: pointer; color: var(--ss-theme-muted); font-size: .85rem; }
#ss-helper-settings-center .stx-ui-fieldset > summary:hover { color: var(--ss-theme-text); }
#ss-helper-settings-center .stx-ui-fieldset > summary:focus-visible { outline: 2px solid var(--ss-theme-accent); outline-offset: 2px; }
#ss-helper-settings-center .stx-ui-field-row {
  min-height: 72px; display: grid; grid-template-columns: minmax(180px, 36%) minmax(0, 1fr); align-items: center; gap: 24px;
  padding: 10px 20px; border-bottom: 1px solid var(--ss-theme-border);
}
#ss-helper-settings-center .stx-ui-field-row:last-child { border-bottom: 0; }
#ss-helper-settings-center .stx-ui-field-row[hidden] { display: none; }
#ss-helper-settings-center .stx-ui-field-label { align-self: center; min-width: 0; }
#ss-helper-settings-center .stx-ui-field-action .stx-ui-field-label { display: grid; gap: 4px; }
#ss-helper-settings-center .stx-ui-item-title { color: var(--ss-theme-text); font-size: .91rem; font-weight: 500; }
#ss-helper-settings-center .stx-ui-field-value { min-width: 0; display: grid; gap: 4px; }
#ss-helper-settings-center .stx-ui-control { min-width: 0; display: flex; align-items: center; gap: 10px; }
#ss-helper-settings-center .stx-ui-control-action { justify-content: flex-start; }
#ss-helper-settings-center .stx-ui-control-action .stx-ui-btn { min-width: 120px; }
#ss-helper-settings-center .stx-ui-control-status { justify-content: flex-start; flex-wrap: wrap; }
#ss-helper-settings-center .stx-ui-control-status .stx-ui-status-action { min-width: 112px; }
#ss-helper-settings-center [data-nav-focus="true"] { border-color: var(--ss-theme-accent); box-shadow: 0 0 0 2px rgba(210, 168, 74, .18); }
#ss-helper-settings-center .stx-ui-item-desc { color: var(--ss-theme-muted); font-size: .74rem; line-height: 1.35; }
#ss-helper-settings-center .stx-ui-field-error { color: var(--ss-theme-danger); font-size: .74rem; line-height: 1.35; }
#ss-helper-settings-center .stx-ui-field-error[hidden] { display: none; }
#ss-helper-settings-center .stx-ui-search-empty,
#ss-helper-settings-center .stx-center-empty { margin: 18px 20px; color: var(--ss-theme-muted); }

:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) :is(.stx-ui-search, .stx-ui-input, [data-ss-helper-control="input"], [data-ss-helper-control="textarea"]) {
  width: 100%; min-height: 36px; padding: 7px 11px; border: 1px solid var(--ss-theme-border); border-radius: 5px;
  padding-inline-start: var(--ss-control-input-padding-inline-start, 11px);
  padding-inline-end: var(--ss-control-input-padding-inline-end, 11px);
  background: var(--ss-theme-surface-3); color: var(--ss-theme-text); font: inherit; outline: none;
}
:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) :is(.stx-ui-search, .stx-ui-input, [data-ss-helper-control="input"], [data-ss-helper-control="textarea"]):hover { border-color: rgba(210, 168, 74, .42); }
:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) :is(.stx-ui-search, .stx-ui-input, [data-ss-helper-control="input"], [data-ss-helper-control="textarea"]):focus { border-color: var(--ss-theme-accent); box-shadow: 0 0 0 2px rgba(210, 168, 74, .15); }
[data-ss-helper-popup] [data-ss-helper-control="textarea"] { resize: vertical; }
:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-ui-select-wrap { position: relative; width: 100%; min-width: 0; }
:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-ui-select-wrap[data-open="true"] { z-index: 30; }
:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-ui-select-trigger {
  width: 100%; min-height: 38px; display: grid; grid-template-columns: minmax(0, 1fr) 24px; align-items: center; gap: 8px;
  margin: 0; padding: 6px 9px 6px 12px; border: 1px solid var(--ss-theme-border); border-radius: 5px; appearance: none;
  background: var(--ss-theme-surface-3);
  color: var(--ss-theme-text); cursor: pointer; font: inherit; font-weight: 600; line-height: 1.35; outline: none; text-align: left;
  box-shadow: none; transition: border-color .16s ease, background .16s ease;
}
:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-ui-select-trigger:hover { border-color: color-mix(in srgb, var(--ss-theme-accent) 52%, var(--ss-theme-border)); background: color-mix(in srgb, var(--ss-theme-surface-2) 48%, var(--ss-theme-surface-3)); }
:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-ui-select-trigger:focus-visible,
:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-ui-select-wrap[data-open="true"] .stx-ui-select-trigger { border-color: var(--ss-theme-accent); box-shadow: 0 0 0 1px rgba(210, 168, 74, .14); }
:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-ui-select-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-ui-select-arrow {
  width: 24px; height: 24px; display: grid; place-items: center; color: var(--ss-theme-muted); pointer-events: none;
  font-size: .76rem; transition: color .16s ease, background .16s ease, transform .16s ease;
}
:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-ui-select-trigger:hover .stx-ui-select-arrow,
:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-ui-select-trigger:focus-visible .stx-ui-select-arrow,
:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-ui-select-wrap[data-open="true"] .stx-ui-select-arrow { color: var(--ss-theme-accent); }
:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-ui-select-wrap[data-open="true"] .stx-ui-select-arrow { transform: rotate(180deg); }
:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-ui-select-listbox {
  position: fixed; z-index: 2147483000; max-height: 240px; overflow-y: auto;
  margin: 0;
  padding: 4px; border: 1px solid color-mix(in srgb, var(--ss-theme-accent) 38%, var(--ss-theme-border)); border-radius: 5px;
  background: var(--ss-theme-surface); color: var(--ss-theme-text); box-shadow: none;
  scrollbar-color: rgba(210, 168, 74, .46) transparent;
}
:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-ui-select-listbox[hidden] { display: none; }
:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-ui-select-group {
  position: sticky; top: -4px; z-index: 1; margin: 2px 2px 3px; padding: 7px 8px 5px;
  border-bottom: 1px solid var(--ss-theme-border); background: var(--ss-theme-surface);
  color: var(--ss-theme-muted); font-size: .64rem; font-weight: 700; letter-spacing: .04em;
}
:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-ui-select-option {
  min-height: 36px; display: grid; grid-template-columns: minmax(0, 1fr) 22px; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: 5px; color: var(--ss-theme-text); cursor: pointer; font-weight: 550; line-height: 1.3;
}
:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-ui-select-option:hover,
:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-ui-select-option[data-active="true"] { background: color-mix(in srgb, var(--ss-theme-accent) 16%, var(--ss-theme-surface-2)); }
:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-ui-select-option[aria-selected="true"] { color: var(--ss-theme-accent); }
:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-ui-select-check { display: grid; place-items: center; color: var(--ss-theme-accent); font-size: .78rem; }
:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-ui-select-check[hidden] { display: none; }
:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) [aria-invalid="true"] { border-color: var(--ss-theme-danger); box-shadow: 0 0 0 2px rgba(240, 93, 93, .12); }

#ss-helper-settings-center .stx-ui-toggle { display: inline-flex; cursor: pointer; }
#ss-helper-settings-center .stx-ui-toggle input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
#ss-helper-settings-center .stx-ui-toggle-track {
  position: relative; width: 42px; height: 22px; border: 1px solid var(--ss-theme-border); border-radius: 999px; background: rgba(255, 255, 255, .1); transition: .16s ease;
}
#ss-helper-settings-center .stx-ui-toggle-track::after {
  content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #e5e5e5; box-shadow: 0 1px 4px rgba(0, 0, 0, .4); transition: .16s ease;
}
#ss-helper-settings-center .stx-ui-toggle input:checked + .stx-ui-toggle-track { border-color: var(--ss-theme-accent); background: var(--ss-theme-accent); }
#ss-helper-settings-center .stx-ui-toggle input:checked + .stx-ui-toggle-track::after { transform: translateX(20px); background: #fff; }
#ss-helper-settings-center .stx-ui-toggle input:focus-visible + .stx-ui-toggle-track { outline: 2px solid rgba(210, 168, 74, .28); outline-offset: 2px; }
:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) :is(.stx-ui-checkbox, [data-ss-helper-control="checkbox"]),
#ss-helper-settings-center .stx-ui-radio-option input { width: 18px; height: 18px; accent-color: var(--ss-theme-accent); }
#ss-helper-settings-center .stx-ui-control-radio { flex-wrap: wrap; gap: 18px; }
#ss-helper-settings-center .stx-ui-radio-option { display: inline-flex; align-items: center; gap: 7px; cursor: pointer; color: var(--ss-theme-text); }

#ss-helper-settings-center .stx-ui-number-stepper { width: 100%; display: grid; grid-template-columns: 38px minmax(0, 1fr) 38px auto; align-items: center; }
#ss-helper-settings-center .stx-ui-number-stepper .stx-ui-input { border-radius: 0; text-align: center; font-variant-numeric: tabular-nums; }
#ss-helper-settings-center .stx-ui-number-stepper .stx-ui-input::-webkit-inner-spin-button { appearance: none; }
#ss-helper-settings-center .stx-ui-step-button {
  height: 36px; display: grid; place-items: center; border: 1px solid var(--ss-theme-border); background: rgba(255, 255, 255, .04); color: var(--ss-theme-text); cursor: pointer;
}
#ss-helper-settings-center .stx-ui-step-button:first-child { border-radius: 5px 0 0 5px; border-right: 0; }
#ss-helper-settings-center .stx-ui-step-button:nth-last-child(1),
#ss-helper-settings-center .stx-ui-step-button:nth-last-child(2) { border-radius: 0 5px 5px 0; border-left: 0; }
#ss-helper-settings-center .stx-ui-step-button:hover,
#ss-helper-settings-center .stx-ui-step-button:focus-visible { color: var(--ss-theme-accent); background: var(--ss-theme-accent-soft); outline: none; }
#ss-helper-settings-center .stx-ui-unit { padding-left: 10px; color: var(--ss-theme-muted); white-space: nowrap; }
#ss-helper-settings-center .stx-ui-control-range { display: grid; grid-template-columns: minmax(0, 1fr) minmax(76px, 104px); align-items: center; gap: 10px; }
#ss-helper-settings-center .stx-ui-control-range > input[type="range"] { min-width: 0; padding-inline: 0; accent-color: var(--ss-theme-accent); }
#ss-helper-settings-center .stx-ui-range-number { width: 100%; min-width: 0; text-align: right; color: var(--ss-theme-accent); font-variant-numeric: tabular-nums; }
#ss-helper-settings-center .stx-ui-range-number::-webkit-inner-spin-button { appearance: none; }

#ss-helper-settings-center .stx-ui-multiselect { width: 100%; display: grid; gap: 7px; }
#ss-helper-settings-center .stx-ui-chips { display: flex; flex-wrap: wrap; gap: 6px; }
#ss-helper-settings-center .stx-ui-chip {
  display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 3px 4px 3px 9px;
  border: 1px solid var(--ss-theme-border); border-radius: 5px; background: rgba(255, 255, 255, .06); font-size: .8rem;
}
#ss-helper-settings-center .stx-ui-chip-remove { display: grid; place-items: center; width: 22px; height: 22px; border: 0; background: transparent; color: var(--ss-theme-muted); cursor: pointer; }
#ss-helper-settings-center .stx-ui-chip-remove:hover,
#ss-helper-settings-center .stx-ui-chip-remove:focus-visible { color: var(--ss-theme-danger); outline: none; }

#ss-helper-settings-center .stx-center-footer {
  min-height: 64px; display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 11px 20px;
  border-top: 1px solid var(--ss-theme-border); background: rgba(0, 0, 0, .16);
}
#ss-helper-settings-center .stx-save-state { display: inline-flex; align-items: center; gap: 8px; color: var(--ss-theme-muted); font-size: .78rem; }
#ss-helper-settings-center .stx-save-state-saved { color: #76d687; }
#ss-helper-settings-center .stx-save-state-saving { color: var(--ss-theme-accent); }
#ss-helper-settings-center .stx-save-state-warning { color: #e4ad46; }
#ss-helper-settings-center .stx-save-state-error { color: #ff9797; }
#ss-helper-settings-center .stx-save-state-saving ss-helper-icon { animation: stx-spin .85s linear infinite; }
#ss-helper-settings-center .stx-center-footer-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 10px; }

#ss-helper-settings-center .stx-overview-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding: 18px 20px; }
#ss-helper-settings-center .stx-overview-card { min-width: 0; padding: 16px; border: 1px solid var(--ss-theme-border); border-radius: 6px; background: rgba(0, 0, 0, .1); }
#ss-helper-settings-center .stx-overview-card[data-health="degraded"] { border-color: rgba(228, 173, 70, .38); }
#ss-helper-settings-center .stx-overview-card-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 13px; }
#ss-helper-settings-center .stx-overview-card-icon { display: grid; place-items: center; width: 32px; height: 32px; color: var(--ss-theme-accent); }
#ss-helper-settings-center .stx-overview-card > small { display: block; margin-bottom: 5px; color: var(--ss-theme-muted); }
#ss-helper-settings-center .stx-overview-card > strong { display: block; font-size: 1.25rem; }
#ss-helper-settings-center .stx-overview-card p { margin: 8px 0 0; color: var(--ss-theme-muted); font-size: .75rem; line-height: 1.45; overflow-wrap: anywhere; }
#ss-helper-settings-center .stx-overview-list { margin: 0 20px 20px; border: 1px solid var(--ss-theme-border); border-radius: 6px; overflow: hidden; }
#ss-helper-settings-center .stx-overview-list h4 { margin: 0; padding: 13px 16px; border-bottom: 1px solid var(--ss-theme-border); font-size: .86rem; }
#ss-helper-settings-center .stx-overview-plugin { min-height: 48px; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 15px; padding: 9px 16px; border-bottom: 1px solid var(--ss-theme-border); }
#ss-helper-settings-center .stx-overview-plugin:last-child { border-bottom: 0; }
#ss-helper-settings-center .stx-overview-plugin > span:not(.stx-ui-badge) { color: var(--ss-theme-muted); font-size: .78rem; }

[data-ss-helper-popup] :is(button, input, select, textarea) { font: inherit; }
[data-ss-helper-popup] :is(button, summary) { cursor: pointer; }
[data-ss-helper-popup] :is(button, input, select, textarea, summary):focus-visible { outline: 2px solid var(--ss-theme-accent); outline-offset: 2px; }
[data-ss-helper-popup] [data-ss-helper-control="input"],
[data-ss-helper-popup] [data-ss-helper-control="textarea"] { width: 100%; min-width: 0; }
[data-ss-helper-popup] [data-ss-helper-control="checkbox"] { flex: 0 0 auto; }
[data-ss-helper-popup] .stx-popup-toggle {
  position: relative; width: 34px; min-width: 34px; height: 20px; padding: 0; border: 1px solid var(--ss-theme-border);
  border-radius: 999px; background: color-mix(in srgb, var(--ss-theme-text) 10%, transparent); color: var(--ss-theme-text);
  transition: border-color .16s ease, background .16s ease;
}
[data-ss-helper-popup] .stx-popup-toggle::after {
  content: ""; position: absolute; top: 3px; left: 3px; width: 12px; height: 12px; border-radius: 50%;
  background: currentColor; transition: transform .16s ease;
}
[data-ss-helper-popup] .stx-popup-toggle[aria-checked="true"] { border-color: var(--ss-theme-accent); background: var(--ss-theme-accent); color: #fff; }
[data-ss-helper-popup] .stx-popup-toggle[aria-checked="true"]::after { transform: translateX(14px); }
[data-ss-helper-popup] .stx-popup-toggle[aria-busy="true"] { opacity: .62; }
[data-ss-helper-popup] .stx-popup-menu { display: inline-flex; }
[data-ss-helper-popup] .stx-popup-menu-trigger { width: 30px; min-width: 30px; padding: 0; border-color: transparent; background: transparent; }
.stx-popup-menu-list {
  position: fixed; z-index: 10240; min-width: 164px; display: grid; padding: 5px;
  border: 1px solid var(--ss-theme-border); border-radius: 6px; background: var(--ss-theme-surface-2);
  color: var(--ss-theme-text); box-shadow: 0 12px 30px rgba(0, 0, 0, .46);
}
.stx-popup-menu-item {
  min-height: 34px; display: grid; grid-template-columns: 18px minmax(0, 1fr); align-items: center; gap: 8px;
  padding: 6px 9px; border: 0; border-radius: 4px; background: transparent; color: inherit; text-align: left;
}
.stx-popup-menu-item:not(:has(ss-helper-icon)) { grid-template-columns: 1fr; }
.stx-popup-menu-item:hover, .stx-popup-menu-item:focus-visible { background: var(--ss-theme-accent-soft); outline: 2px solid var(--ss-theme-accent); outline-offset: -2px; }
.stx-popup-menu-item[data-tone="danger"] { color: var(--ss-theme-danger); }
.stx-popup-menu-item[data-separator-before="true"] { margin-top: 5px; border-top: 1px solid var(--ss-theme-border); border-radius: 0 0 4px 4px; }
.stx-popup-menu-item:disabled { cursor: not-allowed; opacity: .5; }
.stx-popup-confirm-overlay {
  position: fixed; inset: 0; z-index: 10260; display: grid; place-items: center; padding: 16px; background: rgba(0, 0, 0, .7);
}
.stx-popup-confirm {
  width: min(92vw, 29rem); display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 14px; padding: 20px;
  border: 1px solid var(--ss-theme-border); border-radius: 7px; background: var(--ss-theme-surface-2);
  color: var(--ss-theme-text); box-shadow: 0 18px 54px rgba(0, 0, 0, .56);
}
.stx-popup-confirm > ss-helper-icon { margin-top: 2px; color: var(--ss-theme-accent); font-size: 1.1rem; }
.stx-popup-confirm[role="alertdialog"] > ss-helper-icon { color: var(--ss-theme-danger); }
.stx-popup-confirm h3, .stx-popup-confirm p { margin: 0; }
.stx-popup-confirm h3 { font-size: .96rem; line-height: 1.35; }
.stx-popup-confirm p { margin-top: 7px; color: var(--ss-theme-muted); font-size: .76rem; line-height: 1.55; }
.stx-popup-confirm-actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 8px; padding-top: 6px; }
[data-ss-helper-popup] [data-ss-helper-control="progress"] {
  width: 100%; height: 9px; overflow: hidden; border: 0; border-radius: 999px; appearance: none;
  background: color-mix(in srgb, var(--ss-theme-text) 12%, transparent); accent-color: var(--ss-theme-accent);
}
[data-ss-helper-popup] [data-ss-helper-control="progress"]::-webkit-progress-bar { background: color-mix(in srgb, var(--ss-theme-text) 12%, transparent); border-radius: 999px; }
[data-ss-helper-popup] [data-ss-helper-control="progress"]::-webkit-progress-value { background: var(--ss-theme-accent); border-radius: 999px; }
[data-ss-helper-popup] [data-ss-helper-control="progress"]::-moz-progress-bar { background: var(--ss-theme-accent); border-radius: 999px; }
[data-ss-helper-popup] [data-ss-helper-control="file-trigger"] { position: relative; overflow: hidden; }
[data-ss-helper-popup] [data-ss-helper-control="file-trigger"] > input[type="file"] { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

[data-ss-helper-popup] { position: fixed; inset: 0; z-index: 10100; display: grid; place-items: center; padding: 1rem; background: rgba(0, 0, 0, .68); }
[data-ss-helper-popup] [role="dialog"] {
  width: min(92vw, 64rem); max-height: 90vh; overflow: auto; padding: 1rem;
  border: 1px solid var(--SmartThemeBorderColor, rgba(210, 168, 74, .5)); border-radius: 7px;
  background: var(--SmartThemeBlurTintColor, #1d1d1d); color: var(--SmartThemeBodyColor, #ececec); box-shadow: 0 22px 72px rgba(0, 0, 0, .58);
}
[data-ss-helper-popup] [role="dialog"][data-presentation="workspace"] {
  position: relative; width: min(96vw, 88rem); height: min(92vh, 58rem); min-width: min(42rem, 96vw); min-height: min(32rem, 92vh);
  max-width: calc(100vw - 2rem); max-height: calc(100vh - 2rem); overflow: hidden; padding: 0;
  display: grid; grid-template-rows: auto minmax(0, 1fr); box-shadow: none;
}
:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-ui-select-option-copy {
  min-width: 0; display: grid; gap: 3px;
}
:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-ui-select-option-copy > span {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
:where(#ss-helper-settings-center, [data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-ui-select-option-copy > small {
  min-width: 0; overflow: hidden; color: var(--ss-theme-muted); font-size: .66rem; font-weight: 500; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap;
}
[data-ss-helper-popup] [data-popup-resize-handle="true"] {
  position: absolute; right: 0; bottom: 0; z-index: 3; width: 24px; height: 24px; padding: 0; border: 0;
  background: transparent; color: var(--ss-theme-accent, #d2a84a); cursor: nwse-resize; touch-action: none;
}
[data-ss-helper-popup] [data-popup-resize-handle="true"]::after {
  content: ""; position: absolute; right: 3px; bottom: 3px; width: 16px; height: 16px;
  background: currentColor; clip-path: polygon(100% 0, 100% 100%, 0 100%); opacity: .48;
}
[data-ss-helper-popup] [data-popup-resize-handle="true"][data-popup-resize-edge="left"] { right: auto; left: 0; cursor: sw-resize; }
[data-ss-helper-popup] [data-popup-resize-handle="true"][data-popup-resize-edge="left"]::after {
  right: auto; left: 3px; clip-path: polygon(0 0, 0 100%, 100% 100%);
}
[data-ss-helper-popup] [data-popup-header="true"] {
  min-height: 58px; display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  padding: 0 20px; border-bottom: 1px solid var(--SmartThemeBorderColor, rgba(210, 168, 74, .38));
  background: rgba(0, 0, 0, .16);
}
[data-ss-helper-popup] [data-popup-header="true"] h2 { margin: 0; color: var(--SmartThemeBodyColor, #ececec); font-size: 1.1rem; font-weight: 700; }
[data-ss-helper-popup] [data-popup-header="true"] button {
  min-width: 36px; min-height: 36px; border: 0; border-radius: 5px;
  background: transparent; color: var(--SmartThemeEmColor, #a7a7a7); cursor: pointer; font: inherit;
}
[data-ss-helper-popup] [data-popup-header="true"] button:hover,
[data-ss-helper-popup] [data-popup-header="true"] button:focus-visible {
  background: rgba(210, 168, 74, .13); color: var(--SmartThemeBodyColor, #ececec); outline: 2px solid rgba(210, 168, 74, .24); outline-offset: 1px;
}
[data-ss-helper-popup] [data-popup-content="true"] { min-width: 0; min-height: 0; overflow: hidden; }
[data-ss-helper-popup] [role="dialog"]:has(.stx-popup-wizard) {
  width: min(94vw, 76.5rem); height: min(88vh, 49.75rem); max-height: calc(100vh - 2rem); overflow: hidden; padding: 0;
  display: grid; grid-template-rows: auto minmax(0, 1fr);
}
[data-ss-helper-popup] .stx-popup-wizard,
[data-ss-helper-popup] .stx-popup-wizard :where(h3, h4, p, ol, ul) { margin: 0; }
[data-ss-helper-popup] .stx-popup-wizard {
  height: 100%; min-width: 0; min-height: 0; display: grid; grid-template-rows: minmax(0, 1fr) auto;
  color: var(--ss-theme-text); background: var(--ss-theme-surface);
}
[data-ss-helper-popup] .stx-popup-wizard-content {
  min-width: 0; min-height: 0; display: grid; grid-template-columns: 14rem minmax(25rem, 1fr) 13.25rem;
  overflow: hidden;
}
[data-ss-helper-popup] .stx-popup-wizard-nav {
  min-width: 0; padding: 24px 16px; border-right: 1px solid var(--ss-theme-border); background: rgba(0, 0, 0, .16); overflow-y: auto;
}
[data-ss-helper-popup] .stx-popup-wizard-nav-title {
  padding: 0 10px 14px; color: var(--ss-theme-muted); font-size: .68rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase;
}
[data-ss-helper-popup] .stx-popup-wizard-nav ol { display: grid; gap: 6px; padding: 0; list-style: none; }
[data-ss-helper-popup] .stx-popup-wizard-step {
  width: 100%; min-width: 0; display: grid; grid-template-columns: 30px minmax(0, 1fr); align-items: center; gap: 10px;
  padding: 10px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--ss-theme-muted); text-align: left;
}
[data-ss-helper-popup] .stx-popup-wizard-step:not(:disabled):hover { background: var(--ss-theme-surface-2); color: var(--ss-theme-text); }
[data-ss-helper-popup] .stx-popup-wizard-step[data-state="current"] {
  border-color: color-mix(in srgb, var(--ss-theme-accent) 54%, transparent); background: var(--ss-theme-accent-soft); color: var(--ss-theme-text);
}
[data-ss-helper-popup] .stx-popup-wizard-step[data-state="complete"] { color: var(--ss-theme-text); }
[data-ss-helper-popup] .stx-popup-wizard-step:disabled { cursor: default; opacity: .58; }
[data-ss-helper-popup] .stx-popup-wizard-step-marker {
  width: 28px; height: 28px; display: grid; place-items: center; border: 1px solid var(--ss-theme-border); border-radius: 50%;
  color: var(--ss-theme-muted); font-size: .72rem; font-weight: 700;
}
[data-ss-helper-popup] .stx-popup-wizard-step[data-state="current"] .stx-popup-wizard-step-marker,
[data-ss-helper-popup] .stx-popup-wizard-step[data-state="complete"] .stx-popup-wizard-step-marker {
  border-color: var(--ss-theme-accent); color: var(--ss-theme-accent);
}
[data-ss-helper-popup] .stx-popup-wizard-step > span:last-child { min-width: 0; display: grid; gap: 2px; }
[data-ss-helper-popup] .stx-popup-wizard-step strong { font-size: .82rem; line-height: 1.35; }
[data-ss-helper-popup] .stx-popup-wizard-step small {
  min-width: 0; overflow: visible; font-size: .66rem; line-height: 1.35; text-overflow: clip; white-space: normal;
}
[data-ss-helper-popup] .stx-popup-wizard-main { min-width: 0; min-height: 0; padding: 28px 30px; overflow-y: auto; }
[data-ss-helper-popup] .stx-popup-wizard-heading { display: grid; gap: 7px; padding-bottom: 22px; border-bottom: 1px solid var(--ss-theme-border); }
[data-ss-helper-popup] .stx-popup-wizard-heading > span { color: var(--ss-theme-accent); font-size: .68rem; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
[data-ss-helper-popup] .stx-popup-wizard-heading h3 { color: var(--ss-theme-text); font-size: 1.18rem; line-height: 1.3; }
[data-ss-helper-popup] .stx-popup-wizard-heading p { color: var(--ss-theme-muted); font-size: .76rem; line-height: 1.55; }
[data-ss-helper-popup] .stx-popup-wizard-form { display: grid; gap: 18px; padding-top: 22px; }
[data-ss-helper-popup] .stx-popup-wizard-field { min-width: 0; display: grid; gap: 7px; }
[data-ss-helper-popup] .stx-popup-wizard-field-label { color: var(--ss-theme-text); font-size: .78rem; font-weight: 680; line-height: 1.35; }
[data-ss-helper-popup] .stx-popup-wizard-field-control { min-width: 0; }
[data-ss-helper-popup] .stx-popup-wizard-field-description,
[data-ss-helper-popup] .stx-popup-wizard-field-error { display: block; color: var(--ss-theme-muted); font-size: .68rem; line-height: 1.45; }
[data-ss-helper-popup] .stx-popup-wizard-field-error { color: var(--ss-theme-danger); }
[data-ss-helper-popup] .stx-popup-wizard-field-error[hidden] { display: none; }
[data-ss-helper-popup] .stx-popup-wizard-input-wrap { min-width: 0; position: relative; }
[data-ss-helper-popup] .stx-popup-wizard-input-wrap > .stx-ui-input,
[data-ss-helper-popup] .stx-popup-wizard-field-control > .stx-ui-select-wrap {
  width: 100%; min-height: 36px;
}
[data-ss-helper-popup] .stx-popup-wizard-input-wrap:has(.stx-popup-wizard-secret-toggle) > .stx-ui-input { padding-right: 40px; }
[data-ss-helper-popup] .stx-popup-wizard-select-custom { display: grid; gap: 8px; }
[data-ss-helper-popup] .stx-popup-wizard-select-custom > .stx-ui-select-wrap,
[data-ss-helper-popup] .stx-popup-wizard-select-custom > .stx-ui-input { width: 100%; min-height: 36px; }
[data-ss-helper-popup] .stx-popup-wizard-secret-toggle {
  position: absolute; top: 50%; right: 4px; width: 30px; height: 30px; min-width: 30px; padding: 0;
  display: grid; place-items: center; transform: translateY(-50%);
  border: 0; border-radius: 5px; background: transparent; box-shadow: none;
  color: var(--ss-theme-muted); cursor: pointer; transition: color .16s ease, filter .16s ease;
}
[data-ss-helper-popup] .stx-popup-wizard-secret-toggle:hover,
[data-ss-helper-popup] .stx-popup-wizard-secret-toggle:focus-visible {
  border: 0; background: transparent; color: var(--ss-theme-text); filter: brightness(1.35);
}
[data-ss-helper-popup] .stx-popup-wizard-secret-toggle[aria-pressed="true"] {
  color: var(--ss-theme-accent); filter: brightness(1.18);
}
[data-ss-helper-popup] .stx-popup-wizard-secret-toggle:focus-visible {
  outline: 1px solid var(--ss-theme-accent); outline-offset: 1px;
}
[data-ss-helper-popup] .stx-popup-wizard-secret-toggle ss-helper-icon { font-size: .86rem; }
[data-ss-helper-popup] .stx-popup-wizard-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
[data-ss-helper-popup] .stx-popup-wizard-option {
  min-width: 0; min-height: 40px; display: flex; align-items: center; gap: 9px; padding: 9px 11px;
  border: 1px solid var(--ss-theme-border); border-radius: 6px; background: var(--ss-theme-surface-2); color: var(--ss-theme-text);
}
[data-ss-helper-popup] .stx-popup-wizard-option:has(input:checked) { border-color: var(--ss-theme-accent); background: var(--ss-theme-accent-soft); }
[data-ss-helper-popup] .stx-popup-wizard-option input { accent-color: var(--ss-theme-accent); }
[data-ss-helper-popup] .stx-popup-wizard-review {
  min-height: 110px; display: grid; grid-template-columns: 32px minmax(0, 1fr); align-items: center; gap: 14px;
  padding: 18px; border: 1px solid var(--ss-theme-border); border-radius: 7px; background: var(--ss-theme-surface-2);
}
[data-ss-helper-popup] .stx-popup-wizard-review > i { color: var(--ss-theme-accent); font-size: 1.15rem; }
[data-ss-helper-popup] .stx-popup-wizard-review div { display: grid; gap: 5px; }
[data-ss-helper-popup] .stx-popup-wizard-review p { color: var(--ss-theme-muted); font-size: .72rem; line-height: 1.5; }
[data-ss-helper-popup] .stx-popup-wizard-aside {
  min-width: 0; padding: 28px 20px; border-left: 1px solid var(--ss-theme-border); background: rgba(0, 0, 0, .12); overflow-y: auto;
}
[data-ss-helper-popup] .stx-popup-wizard-aside h4 { font-size: .9rem; }
[data-ss-helper-popup] .stx-popup-wizard-aside > p { margin-top: 7px; color: var(--ss-theme-muted); font-size: .7rem; line-height: 1.5; }
[data-ss-helper-popup] .stx-popup-wizard-aside ul { display: grid; gap: 6px; padding: 18px 0 0; list-style: none; }
[data-ss-helper-popup] .stx-popup-wizard-aside li {
  min-width: 0; display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 9px; padding: 10px 8px; border-radius: 5px;
}
[data-ss-helper-popup] .stx-popup-wizard-aside li[data-state="running"] { background: var(--ss-theme-accent-soft); }
[data-ss-helper-popup] .stx-popup-wizard-aside li[data-state="success"] { color: var(--ss-theme-success); }
[data-ss-helper-popup] .stx-popup-wizard-aside li[data-state="error"] { color: var(--ss-theme-danger); }
[data-ss-helper-popup] .stx-popup-wizard-check-marker { width: 22px; height: 22px; display: grid; place-items: center; color: var(--ss-theme-muted); }
[data-ss-helper-popup] .stx-popup-wizard-aside li[data-state="running"] .stx-popup-wizard-check-marker { color: var(--ss-theme-accent); animation: stx-spin 1s linear infinite; }
[data-ss-helper-popup] .stx-popup-wizard-aside li[data-state="success"] .stx-popup-wizard-check-marker,
[data-ss-helper-popup] .stx-popup-wizard-aside li[data-state="error"] .stx-popup-wizard-check-marker { color: currentColor; }
[data-ss-helper-popup] .stx-popup-wizard-aside li > div { min-width: 0; display: grid; gap: 3px; }
[data-ss-helper-popup] .stx-popup-wizard-aside li strong { color: var(--ss-theme-text); font-size: .75rem; }
[data-ss-helper-popup] .stx-popup-wizard-aside li small { color: var(--ss-theme-muted); font-size: .65rem; line-height: 1.4; overflow-wrap: anywhere; }
[data-ss-helper-popup] .stx-popup-wizard-footer {
  min-height: 64px; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 18px;
  border-top: 1px solid var(--ss-theme-border); background: var(--ss-theme-surface-2);
}
[data-ss-helper-popup] .stx-popup-wizard-status { min-width: 0; display: flex; align-items: center; gap: 8px; color: var(--ss-theme-muted); font-size: .7rem; }
[data-ss-helper-popup] .stx-popup-wizard-status[data-tone="success"] { color: var(--ss-theme-success); }
[data-ss-helper-popup] .stx-popup-wizard-status[data-tone="warning"] { color: var(--ss-theme-accent); }
[data-ss-helper-popup] .stx-popup-wizard-status[data-tone="error"] { color: var(--ss-theme-danger); }
[data-ss-helper-popup] .stx-popup-wizard-status code { color: inherit; font-size: .66rem; }

#ss-helper-toast-root {
  position: fixed; top: 18px; right: 18px; z-index: 10200; width: min(360px, calc(100vw - 36px));
  display: grid; align-items: start; pointer-events: none;
  --stx-toast-gap: 8px;
}
#ss-helper-toast-root .stx-toast {
  grid-area: 1 / 1; position: relative; min-width: 0; min-height: 64px; display: grid;
  grid-template-columns: 20px minmax(0, 1fr) 28px; align-items: start; gap: 10px;
  padding: 13px 10px 13px 13px; border: 1px solid var(--ss-theme-border); border-radius: 6px;
  background: var(--ss-theme-surface-2); color: var(--ss-theme-text); box-shadow: 0 12px 34px rgba(0, 0, 0, .42);
  pointer-events: auto; transform-origin: top center; transition: transform .18s ease, opacity .18s ease, box-shadow .18s ease;
}
#ss-helper-toast-root .stx-toast:nth-child(1) { z-index: 5; }
#ss-helper-toast-root .stx-toast:nth-child(2) { z-index: 4; transform: translateY(8px) scale(.985); }
#ss-helper-toast-root .stx-toast:nth-child(3) { z-index: 3; transform: translateY(16px) scale(.97); }
#ss-helper-toast-root .stx-toast:nth-child(4) { z-index: 2; transform: translateY(24px) scale(.955); }
#ss-helper-toast-root .stx-toast:nth-child(5) { z-index: 1; transform: translateY(32px) scale(.94); }
#ss-helper-toast-root:hover,
#ss-helper-toast-root:focus-within,
#ss-helper-toast-root[data-expanded="true"] { gap: 12px; }
#ss-helper-toast-root:hover .stx-toast,
#ss-helper-toast-root:focus-within .stx-toast,
#ss-helper-toast-root[data-expanded="true"] .stx-toast { grid-area: auto; transform: none; }

.recentChat .chatNameContainer > .chatName { min-width: 0; }
[data-ss-helper-chat-indicators="true"] {
  min-width: 0; max-width: min(6rem, 24%); display: inline-flex; flex: 0 0 auto; align-items: center; gap: 3px;
  overflow-x: auto; overflow-y: hidden; white-space: nowrap; scrollbar-width: none;
}
[data-ss-helper-chat-indicators="true"]::-webkit-scrollbar { display: none; }
[data-ss-helper-chat-indicator-plugin] {
  position: relative; width: 1.25em; height: 1.25em; display: inline-grid; flex: 0 0 auto; place-items: center;
  color: var(--SmartThemeQuoteColor, var(--SmartThemeBodyColor, currentColor)); font-size: .9em; line-height: 1;
}
[data-ss-helper-chat-indicator-plugin][data-state="retained"] {
  color: var(--SmartThemeEmColor, #999); opacity: .62;
}
[data-ss-helper-chat-indicator-plugin][data-state="retained"]::after {
  content: ""; position: absolute; top: -8%; left: 50%; width: 2px; height: 116%; border-radius: 999px;
  background: currentColor; box-shadow: 0 0 0 1px color-mix(in srgb, var(--SmartThemeBlurTintColor, #171717) 70%, transparent);
  transform: translateX(-50%) rotate(42deg); pointer-events: none;
}
#ss-helper-toast-root .stx-toast-icon { margin-top: 2px; color: var(--ss-theme-muted); font-size: .92rem; text-align: center; }
#ss-helper-toast-root .stx-toast-success .stx-toast-icon { color: var(--ss-theme-success); }
#ss-helper-toast-root .stx-toast-warning .stx-toast-icon { color: var(--ss-theme-accent); }
#ss-helper-toast-root .stx-toast-error .stx-toast-icon { color: var(--ss-theme-danger); }
#ss-helper-toast-root .stx-toast-content { min-width: 0; display: grid; gap: 4px; }
#ss-helper-toast-root .stx-toast-title { font-size: .9rem; font-weight: 650; line-height: 1.3; }
#ss-helper-toast-root .stx-toast-message { margin: 0; color: var(--ss-theme-muted); font-size: .78rem; line-height: 1.45; overflow-wrap: anywhere; }
#ss-helper-toast-root .stx-toast-close {
  width: 28px; height: 28px; display: grid; place-items: center; margin: -7px -4px 0 0; padding: 0;
  border: 0; border-radius: 4px; background: transparent; color: var(--ss-theme-muted); cursor: pointer;
}
#ss-helper-toast-root .stx-toast-close:hover,
#ss-helper-toast-root .stx-toast-close:focus-visible { background: var(--ss-theme-accent-soft); color: var(--ss-theme-text); outline: 2px solid rgba(210, 168, 74, .24); outline-offset: 1px; }

:where([data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-popup-list {
  position: relative; min-width: 0; min-height: 0; height: 100%; overflow: auto; overscroll-behavior: contain;
  scrollbar-color: color-mix(in srgb, var(--ss-theme-accent) 60%, transparent) transparent;
}
:where([data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-popup-list:focus-visible { outline: 2px solid color-mix(in srgb, var(--ss-theme-accent) 56%, transparent); outline-offset: -2px; }
:where([data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-popup-list-canvas { position: relative; min-height: 100%; }
:where([data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-popup-list-rows { position: absolute; inset: 0 0 auto; min-width: 0; }
:where([data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-popup-list-row { box-sizing: border-box; min-width: 0; overflow: hidden; contain: layout paint style; }
:where([data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-popup-list-row[role="option"] { cursor: pointer; }
:where([data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-popup-list-row[role="option"]:focus-visible { outline: 2px solid color-mix(in srgb, var(--ss-theme-accent) 60%, transparent); outline-offset: -2px; }
:where([data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-popup-list-status {
  position: sticky; inset: auto 0 0; z-index: 2; min-height: 28px; display: grid; place-items: center; padding: 5px 10px;
  background: color-mix(in srgb, var(--ss-theme-surface) 92%, transparent); color: var(--ss-theme-muted); font-size: .76rem;
}
:where([data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-popup-list-status[hidden] { display: none; }
:where([data-ss-helper-popup], [data-ss-helper-message-action-panel]) .stx-popup-list-status[data-tone="error"] { color: var(--ss-theme-danger); }

@keyframes stx-spin { to { transform: rotate(360deg); } }

@media (max-width: 900px) {
  #ss-helper-settings-center-overlay { padding: 10px; }
  #ss-helper-settings-center { width: calc(100vw - 20px); height: calc(100vh - 20px); min-height: 0; }
  #ss-helper-settings-center .stx-center-body { grid-template-columns: 190px minmax(0, 1fr); }
  #ss-helper-settings-center .stx-overview-grid { grid-template-columns: 1fr; }
  [data-ss-helper-popup] .stx-popup-wizard-content { grid-template-columns: 12.5rem minmax(20rem, 1fr); }
  [data-ss-helper-popup] .stx-popup-wizard-aside { grid-column: 2; border-top: 1px solid var(--ss-theme-border); border-left: 0; }
  [data-ss-helper-popup] .stx-popup-wizard-main { grid-row: 1; grid-column: 2; }
  [data-ss-helper-popup] .stx-popup-wizard-nav { grid-row: 1 / span 2; }
}

@media (max-width: 680px) {
  #ss-helper-settings-root { padding: .5rem; }
  #ss-helper-settings-root .stx-launcher-card { grid-template-columns: auto minmax(0, 1fr); }
  #ss-helper-settings-root .stx-launcher-card .stx-ui-btn { grid-column: 1 / -1; width: 100%; }
  #ss-helper-settings-center-overlay { padding: 0; }
  #ss-helper-settings-center { width: 100vw; height: 100vh; border: 0; border-radius: 0; }
  #ss-helper-settings-center .stx-center-header { height: 64px; padding: 0 14px; }
  #ss-helper-settings-center .stx-center-brand small { display: none; }
  #ss-helper-settings-center .stx-center-body { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); }
  #ss-helper-settings-center .stx-center-sidebar { display: block; padding: 8px; border-right: 0; border-bottom: 1px solid var(--ss-theme-border); overflow-x: auto; }
  #ss-helper-settings-center .stx-center-nav-label,
  #ss-helper-settings-center .stx-center-sidebar-meta { display: none; }
  #ss-helper-settings-center .stx-center-nav { display: flex; width: max-content; overflow: visible; }
  #ss-helper-settings-center .stx-center-nav-item { width: 156px; }
  #ss-helper-settings-center .stx-center-page-heading { min-height: 72px; padding: 12px 14px; }
  #ss-helper-settings-center .stx-center-searchbar { margin-inline: 12px; }
  #ss-helper-settings-center .stx-ui-tabs { overflow-x: auto; flex-wrap: nowrap; padding-inline: 12px; }
  #ss-helper-settings-center .stx-ui-tab { flex: 0 0 auto; white-space: nowrap; }
  #ss-helper-settings-center .stx-ui-field-row { grid-template-columns: 1fr; gap: 7px; padding: 12px 14px; }
  #ss-helper-settings-center .stx-ui-control-action .stx-ui-btn { width: 100%; }
  #ss-helper-settings-center .stx-ui-control-status { align-items: flex-start; flex-direction: column; }
  #ss-helper-settings-center .stx-ui-control-status .stx-ui-status-action { width: 100%; }
  #ss-helper-settings-center .stx-center-footer { align-items: stretch; flex-direction: column; padding: 10px 12px; }
  #ss-helper-settings-center .stx-center-footer-actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  #ss-helper-settings-center .stx-center-footer-actions .stx-ui-btn { width: 100%; }
  #ss-helper-settings-center .stx-overview-grid { padding: 14px 12px; }
  #ss-helper-settings-center .stx-overview-list { margin-inline: 12px; }
  #ss-helper-toast-root { top: 8px; right: 8px; width: calc(100vw - 16px); }
  [data-ss-helper-popup] { padding: 0; }
  [data-ss-helper-popup] [role="dialog"][data-presentation="workspace"] { width: 100vw !important; height: 100vh !important; min-width: 0; min-height: 0; max-width: none; max-height: none; border: 0; border-radius: 0; }
  [data-ss-helper-popup] [data-popup-resize-handle="true"] { display: none; }
  [data-ss-helper-popup] [data-popup-header="true"] { min-height: 54px; padding: 0 14px; }
  [data-ss-helper-popup] [role="dialog"]:has(.stx-popup-wizard) { width: 100vw; height: 100vh; max-height: none; border: 0; border-radius: 0; }
  [data-ss-helper-popup] .stx-popup-wizard-content { display: grid; grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); }
  [data-ss-helper-popup] .stx-popup-wizard-nav { grid-row: 1; padding: 8px 10px; border-right: 0; border-bottom: 1px solid var(--ss-theme-border); overflow-x: auto; overflow-y: hidden; }
  [data-ss-helper-popup] .stx-popup-wizard-nav-title { display: none; }
  [data-ss-helper-popup] .stx-popup-wizard-nav ol { width: max-content; display: flex; gap: 4px; }
  [data-ss-helper-popup] .stx-popup-wizard-step { width: 144px; grid-template-columns: 24px minmax(0, 1fr); padding: 7px; }
  [data-ss-helper-popup] .stx-popup-wizard-step-marker { width: 22px; height: 22px; }
  [data-ss-helper-popup] .stx-popup-wizard-step small { display: none; }
  [data-ss-helper-popup] .stx-popup-wizard-main { grid-row: 2; grid-column: 1; padding: 20px 16px; }
  [data-ss-helper-popup] .stx-popup-wizard-aside { display: none; }
  [data-ss-helper-popup] .stx-popup-wizard-options { grid-template-columns: 1fr; }
  [data-ss-helper-popup] .stx-popup-wizard-footer { display: grid; grid-template-columns: 1fr 1fr; padding: 9px 12px; }
  [data-ss-helper-popup] .stx-popup-wizard-status { grid-column: 1 / -1; grid-row: 1; }
  [data-ss-helper-popup] .stx-popup-wizard-footer > .stx-ui-btn { width: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  #ss-helper-settings-center *, #ss-helper-settings-center *::before, #ss-helper-settings-center *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
  #ss-helper-toast-root *, #ss-helper-toast-root *::before, #ss-helper-toast-root *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
  [data-ss-helper-popup] *, [data-ss-helper-popup] *::before, [data-ss-helper-popup] *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
}

@media (forced-colors: active) {
  [data-ss-helper-popup] :is([data-ss-helper-control="button"], [data-ss-helper-control="file-trigger"], [data-ss-helper-control="input"], [data-ss-helper-control="textarea"], .stx-ui-select-trigger, .stx-ui-select-listbox) { border-color: CanvasText; }
  [data-ss-helper-popup] [data-ss-helper-control="segmented"] > [data-ss-helper-control="button"]:is([aria-pressed="true"], [aria-selected="true"]) { outline: 2px solid Highlight; outline-offset: -2px; }
}
`;

export function ensureCoreUiStyles(document: Document): void {
  const current = document.getElementById('ss-helper-core-ui-styles');
  if (current !== null) {
    if (current.textContent !== SETTINGS_CSS) current.textContent = SETTINGS_CSS;
    return;
  }
  const style = document.createElement('style');
  style.id = 'ss-helper-core-ui-styles';
  style.dataset.ssHelperStyle = 'core-ui';
  style.textContent = SETTINGS_CSS;
  (document.head ?? document.body).append(style);
}
