# Plugin authoring

## Bootstrap and lifecycle

Use the local packaged SDK artifact, then call the public connector during the
plugin entry point. Register one typed descriptor, keep the returned session,
and dispose it on unload/reload. Connection failures (Core missing, timeout,
API/capability mismatch, stale generation) are explicit failures; never create
a consumer runtime or poll a global as a fallback.

## Typed platform access

Register and call services with SDK tokens, subscribe with event tokens, and
exchange only documented plain-data DTOs. Declare the smallest Host capability
set required by the plugin. Core owns authorization, request authentication,
size limits, diagnostics redaction, and cleanup.

## Settings and UI

Register ordinary settings through the typed schema. Core renders all normal
fields in its single settings root and owns persistence adapters, validation,
reload, accessibility, plugin health, and degraded presentation. Custom
workbenches may open only through the registered popup/dialog API; do not mount
an independent settings root.

## Icons

After connecting to Core, browser UI may use the Core-owned declarative element
`<ss-helper-icon name="brain" decorative></ss-helper-icon>`. Names use the local
Font Awesome Solid catalog without an `fa-` prefix. Use `decorative` when the
surrounding button or visible text already supplies meaning; otherwise provide a
`label`, for example `<ss-helper-icon name="circle-info" label="信息"></ss-helper-icon>`.
Do not load Font Awesome styles or fonts in a consumer and do not use global
`fa-*` classes. Core's isolated stylesheet cannot change SillyTavern icons.

## Prohibited integrations

Do not import SDK/Core source files, access raw Tavern globals,
create a registry/event bus/settings host, expose secrets/headers, or add a
legacy Memory compatibility facade. LLM and Memory business/storage ownership
does not move into Core.
