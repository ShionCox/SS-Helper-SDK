# SS-Helper SDK/Core

This workspace delivers the two SS-Helper platform artifacts:

- `@ss-helper/sdk` is a stateless, ESM-only public client. It exports typed
  connection, plugin, service, event, HostPort, settings, UI, LLM, and Memory
  contracts; it never creates a fallback runtime.
- `@ss-helper/core-extension` is the sole SillyTavern runtime owner. It owns
  discovery, lifecycle generations, plugin sessions, typed service/event
  communication, the capability-gated HostPort, settings host, popup host, and
  diagnostics.

LLM and Memory remain independent consumers: Core/SDK owns platform mechanisms,
the generic SQLite workspace and encrypted Secret API; each consumer owns its
business rules, mapping, validation and recovery. No consumer-specific schema
or legacy migration code belongs in SDK.

## Use the public SDK

Install only the fresh local package artifact when validating a consumer; do
not use a workspace link, a source-relative import, or a raw Tavern global.

```ts
import { connectSSHelper } from '@ss-helper/sdk';
import { LLM_COMPLETION_V1 } from '@ss-helper/sdk/contracts/llm';

const session = await connectSSHelper({
  id: 'example.plugin',
  displayName: 'Example Plugin',
  pluginVersion: '1.0.0',
  capabilities: [],
});
await session.services.call(LLM_COMPLETION_V1, {
  messages: [{ role: 'user', content: 'Hello' }],
});
await session.dispose();
```

See [plugin authoring](docs/plugin-authoring.md), the
[public API](docs/public-api.md), [settings schema](docs/settings-schema.md),
[compatibility](docs/compatibility.md), and [migration](docs/migration.md).

## Settings and custom UI

Register normal settings as a schema plus load/save/reset adapter. Core owns the
single settings root and the renderer; plugin values remain plugin-owned. Core
renders validation, disabled states, descriptions, accessibility labels, plugin
health, and reload behavior consistently. A plugin-specific workbench may open
only through its registered popup/dialog, never through an extra top-level
settings card or direct legacy-settings-container mount.

Browser consumers access shared data only through `session.workspace` and the
capability-gated `session.secrets`; the Core-owned internal bridge is the only
browser storage transport. Use `open/defineCollection/query/transaction` for
records and `secrets.set/get/delete/list` for credentials. The server plugin
creates `data/_ss-helper/ss-helper.sqlite3` and its AES-256-GCM key on first
startup. Backups never contain Secret values.

SillyTavern extensions share one origin and therefore use a cooperative trust
model. The internal bridge removes public generic workspace CRUD endpoints,
headers, and accidental caller spoofing from consumer APIs, but it cannot make
an actively malicious same-origin extension a fully isolated security subject.

## Commands

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm verify:docs
pnpm legacy:scan -- --llm-root ../SS-Helper-LLM --memory-root ../SS-Helper-Memory
pnpm verify:package
node scripts/verify-doc-links.mjs
node scripts/legacy-scan.mjs --sdk-root . --llm-root <LLM-root> --memory-root <Memory-root>
```

`pnpm artifact:gate` rebuilds artifacts and writes timestamped evidence; it is a
release-quality gate, not a documentation-only check. See [public API](docs/public-api.md),
[plugin authoring](docs/plugin-authoring.md), [settings schema](docs/settings-schema.md),
[compatibility](docs/compatibility.md), [migration](docs/migration.md), and the
[architecture invariants](docs/architecture-invariants.md).
