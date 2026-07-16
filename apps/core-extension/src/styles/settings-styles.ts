export const SETTINGS_CSS = `
:where(#ss-helper-settings-root, #ss-helper-settings-center-overlay, #ss-helper-toast-root) {
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
  color: var(--ss-theme-text);
  font-family: var(--mainFontFamily, "Segoe UI", "Microsoft YaHei UI", sans-serif);
  font-size: 14px;
}

:where(#ss-helper-settings-root, #ss-helper-settings-center-overlay, #ss-helper-toast-root) *,
:where(#ss-helper-settings-root, #ss-helper-settings-center-overlay, #ss-helper-toast-root) *::before,
:where(#ss-helper-settings-root, #ss-helper-settings-center-overlay, #ss-helper-toast-root) *::after { box-sizing: border-box; }

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
  display: grid; place-items: center; width: 36px; height: 36px; border: 1px solid var(--ss-theme-border);
  border-radius: 6px; background: transparent; color: var(--ss-theme-muted); cursor: pointer; font-size: 1rem;
}
#ss-helper-settings-center .stx-center-close:hover,
#ss-helper-settings-center .stx-center-close:focus-visible { border-color: var(--ss-theme-border-strong); color: var(--ss-theme-text); background: var(--ss-theme-accent-soft); outline: none; }

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
#ss-helper-settings-center .stx-center-plugin-content { display: grid; grid-template-rows: auto minmax(min-content, 1fr); align-content: start; }
#ss-helper-settings-center .stx-center-searchbar {
  position: relative; display: flex; align-items: center; margin: 14px 20px 10px;
}
#ss-helper-settings-center .stx-center-searchbar > i { position: absolute; left: 12px; z-index: 1; color: var(--ss-theme-muted); pointer-events: none; }
#ss-helper-settings-center .stx-center-searchbar .stx-ui-search { padding-left: 34px; }

#ss-helper-settings-center .stx-ui-badge,
#ss-helper-settings-root .stx-ui-badge {
  display: inline-flex; align-items: center; min-height: 22px; padding: 3px 8px;
  border: 1px solid var(--ss-theme-border); border-radius: 999px; color: var(--ss-theme-muted); font-size: .72rem; line-height: 1; white-space: nowrap;
}
:where(#ss-helper-settings-root, #ss-helper-settings-center) .stx-ui-badge-success { border-color: rgba(84, 198, 107, .42); color: #76d687; }
:where(#ss-helper-settings-root, #ss-helper-settings-center) .stx-ui-badge-warning { border-color: rgba(228, 173, 70, .5); color: #e4bd72; }
:where(#ss-helper-settings-root, #ss-helper-settings-center) .stx-ui-badge-error { border-color: rgba(240, 93, 93, .52); color: #ff9797; }

:where(#ss-helper-settings-root, #ss-helper-settings-center) .stx-ui-btn {
  min-height: 36px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 7px 16px;
  border: 1px solid var(--ss-theme-border-strong); border-radius: 5px; background: transparent;
  color: var(--ss-theme-text); cursor: pointer; font: inherit; font-weight: 600;
}
:where(#ss-helper-settings-root, #ss-helper-settings-center) .stx-ui-btn:hover,
:where(#ss-helper-settings-root, #ss-helper-settings-center) .stx-ui-btn:focus-visible { background: var(--ss-theme-accent-soft); outline: 2px solid rgba(210, 168, 74, .24); outline-offset: 1px; }
:where(#ss-helper-settings-root, #ss-helper-settings-center) .stx-ui-btn-primary { border-color: var(--ss-theme-accent); background: var(--ss-theme-accent); color: #17120a; }
:where(#ss-helper-settings-root, #ss-helper-settings-center) .stx-ui-btn-primary:hover { background: #dfb95f; }
:where(#ss-helper-settings-root, #ss-helper-settings-center) .stx-ui-btn-danger { border-color: rgba(240, 93, 93, .58); color: #ff9797; }
:where(#ss-helper-settings-root, #ss-helper-settings-center) button:disabled,
:where(#ss-helper-settings-root, #ss-helper-settings-center) input:disabled,
:where(#ss-helper-settings-root, #ss-helper-settings-center) select:disabled { cursor: not-allowed; opacity: .48; }

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

#ss-helper-settings-center .stx-ui-search,
#ss-helper-settings-center .stx-ui-input,
#ss-helper-settings-center .stx-ui-select {
  width: 100%; min-height: 36px; padding: 7px 11px; border: 1px solid var(--ss-theme-border); border-radius: 5px;
  background: var(--ss-theme-surface-3); color: var(--ss-theme-text); font: inherit; outline: none;
}
#ss-helper-settings-center .stx-ui-search:hover,
#ss-helper-settings-center .stx-ui-input:hover,
#ss-helper-settings-center .stx-ui-select:hover { border-color: rgba(210, 168, 74, .42); }
#ss-helper-settings-center .stx-ui-search:focus,
#ss-helper-settings-center .stx-ui-input:focus,
#ss-helper-settings-center .stx-ui-select:focus { border-color: var(--ss-theme-accent); box-shadow: 0 0 0 2px rgba(210, 168, 74, .15); }
#ss-helper-settings-center [aria-invalid="true"] { border-color: var(--ss-theme-danger); box-shadow: 0 0 0 2px rgba(240, 93, 93, .12); }

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
#ss-helper-settings-center .stx-ui-checkbox,
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
#ss-helper-settings-center .stx-ui-control-range .stx-ui-input { padding-inline: 0; accent-color: var(--ss-theme-accent); }
#ss-helper-settings-center .stx-ui-range-output { min-width: 44px; color: var(--ss-theme-accent); text-align: right; font-variant-numeric: tabular-nums; }

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
#ss-helper-settings-center .stx-save-state-error { color: #ff9797; }
#ss-helper-settings-center .stx-save-state-saving i { animation: stx-spin .85s linear infinite; }
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

[data-ss-helper-popup] { position: fixed; inset: 0; z-index: 10100; display: grid; place-items: center; padding: 1rem; background: rgba(0, 0, 0, .68); }
[data-ss-helper-popup] [role="dialog"] {
  width: min(92vw, 64rem); max-height: 90vh; overflow: auto; padding: 1rem;
  border: 1px solid var(--SmartThemeBorderColor, rgba(210, 168, 74, .5)); border-radius: 7px;
  background: var(--SmartThemeBlurTintColor, #1d1d1d); color: var(--SmartThemeBodyColor, #ececec); box-shadow: 0 22px 72px rgba(0, 0, 0, .58);
}

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

@keyframes stx-spin { to { transform: rotate(360deg); } }

@media (max-width: 900px) {
  #ss-helper-settings-center-overlay { padding: 10px; }
  #ss-helper-settings-center { width: calc(100vw - 20px); height: calc(100vh - 20px); min-height: 0; }
  #ss-helper-settings-center .stx-center-body { grid-template-columns: 190px minmax(0, 1fr); }
  #ss-helper-settings-center .stx-overview-grid { grid-template-columns: 1fr; }
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
}

@media (prefers-reduced-motion: reduce) {
  #ss-helper-settings-center *, #ss-helper-settings-center *::before, #ss-helper-settings-center *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
  #ss-helper-toast-root *, #ss-helper-toast-root *::before, #ss-helper-toast-root *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
`;

export function ensureCoreUiStyles(document: Document): void {
  if (document.getElementById('ss-helper-core-ui-styles') !== null) return;
  const style = document.createElement('style');
  style.id = 'ss-helper-core-ui-styles';
  style.dataset.ssHelperStyle = 'core-ui';
  style.textContent = SETTINGS_CSS;
  (document.head ?? document.body).append(style);
}
