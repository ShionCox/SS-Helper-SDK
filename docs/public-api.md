# Public API

## Export boundary

The package exports `.`; `./contracts/core`, `plugin`, `services`, `events`,
`settings`, `ui`, `host`, `llm`, `memory`; and `./errors`. These exports contain
the connector, typed tokens, contract descriptors, DTOs, schema definitions,
and public error types. All other paths are private and unsupported.

## Interaction boundary

`connectSSHelper` creates a session to the existing Core generation. Pass a
plugin descriptor with `id`, `displayName`, `pluginVersion`, and the requested
`capabilities`; the connector supplies the SDK and API version fields. Use
`bootstrapSSHelper` when the plugin must reconnect after Core is replaced.
Plugins use typed service/event tokens and plain-data inputs/outputs; Core owns
registration, dispatch, cancellation, lifecycle cleanup, and diagnostics.
Consumers must handle public connection/call errors rather than bypassing the
contract.

## Plain data and privacy

Public values must be serializable plain data. They cannot carry raw Tavern
objects, DOM/classes/functions, database handles, credentials, arbitrary
request headers, or CSRF values. The HostPort is a narrow, capability-gated
facade, not an escape hatch into Core internals.
