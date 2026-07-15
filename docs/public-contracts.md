# Public contracts

`@ss-helper/sdk` is a stateless ESM-only contract package. Consumers import
only `@ss-helper/sdk`, its documented `./contracts/*` subpaths, and `./errors`;
`src/*`, Core implementation modules, test fixtures, and raw SillyTavern
globals are private.

Core is the sole runtime owner. A consumer connects through discovery, registers
with a typed plugin descriptor, uses typed service/event tokens and plain-data
DTOs, and disposes its session. It must not construct a registry, event hub,
settings root, popup host, HostPort, or compatibility runtime.

## Contract rules

- Tokens are structural (`kind`, `provider`, `name`, `version`, `schemaId`),
  never bare service/event strings.
- Public DTOs are plain data: no DOM nodes, classes, functions, storage handles,
  `AbortSignal`, or Core/plugin-private objects.
- `coreVersion`, `sdkPackageVersion`, API major/minor, and each plugin version
  are independent axes. Compatibility uses API/capability/contract versions,
  not matching version text.
- Host access is capability-gated and Core-mediated. Consumers never receive
  arbitrary headers, CSRF tokens, API keys, or a raw Tavern context.

The complete export and error boundary is in [public-api.md](public-api.md);
authoring and lifecycle rules are in [plugin-authoring.md](plugin-authoring.md).
