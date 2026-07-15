# Settings schema and popup rules

Core renders supported ordinary schema field kinds through one settings host.
Each field supplies its label/description, value contract, validation and
disabled/degraded semantics; adapters own persistence and reload behavior.
Validation or adapter failures surface an accessible degraded state without
breaking unrelated plugins. The host maintains a plugin list with version,
health, compatibility, and capability information.

Schema UI must preserve labels, descriptions, keyboard/focus behavior, and
accessible error reporting. Plugins may not create old standalone settings
roots or direct settings mounts. A specialized workbench belongs in the
Core-owned popup/dialog flow registered by the plugin; popup lifetime is tied
to its plugin session and Core cleanup.
