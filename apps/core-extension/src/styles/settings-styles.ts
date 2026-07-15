export const SETTINGS_CSS = `
#ss-helper-settings-root { display: grid; gap: .75rem; padding: .75rem; }
#ss-helper-settings-root section { border: 1px solid var(--SmartThemeBorderColor, #666); border-radius: .5rem; padding: .75rem; }
#ss-helper-settings-root [data-field-id] { display: grid; gap: .25rem; margin-block: .5rem; }
#ss-helper-settings-root input, #ss-helper-settings-root select, #ss-helper-settings-root button { font: inherit; color: inherit; }
#ss-helper-settings-root [data-health="degraded"] { border-color: var(--warning, #c77b00); }
[data-ss-helper-popup] { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; background: rgb(0 0 0 / .55); }
[data-ss-helper-popup] [role="dialog"] { max-width: min(90vw, 60rem); max-height: 90vh; overflow: auto; background: var(--SmartThemeBlurTintColor, #222); color: var(--SmartThemeBodyColor, #fff); border-radius: .75rem; padding: 1rem; }
`;
