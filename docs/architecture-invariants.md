# Architecture invariants audit

This audit records the concrete source boundary and evidence for every
non-negotiable constraint. It is an implementation/evidence audit, not an
independent code-review or architecture approval. At the time of this historical
evidence snapshot, both approvals were pending for G008; this audit does not
state that either has since completed.

| Invariant | Source boundary | Proof |
|---|---|---|
| One Core discovery/root/generation | `apps/core-extension/src/runtime/install-core-runtime.ts`, `core-runtime.ts`, `lifecycle.ts`, `settings/settings-host.ts` | `tests/core-runtime.test.mjs` checks immutable discovery snapshots, exact generation transitions and corrupt-bridge fail-close; `tests/settings-popup.test.mjs` and official ST/Chrome evidence measure one settings root/Core instance. |
| Typed public contracts; no raw globals | `packages/sdk/src/contracts/*`, `client/connect-core.ts`, `apps/core-extension/src/communication/contracts.ts` | `tests/contracts.test.mjs` and type fixtures accept structured tokens/DTOs; `scripts/lint-boundaries.mjs` and the legacy scan reject retired-global/raw-global leakage. |
| Core-only settings host; plugin popup boundary | `apps/core-extension/src/settings/settings-host.ts`, `popup/popup-host.ts`, SDK `contracts/settings.ts` and `contracts/ui.ts` | `tests/settings-popup.test.mjs` covers the single root, adapter persistence/degraded state, and registered popup access; official browser evidence reports one root after reload. |
| Version and artifact identity are separate axes | SDK `contracts/core.ts`; Core `manifest.json`; `scripts/artifact-lib.mjs`, `scripts/artifact-gate.mjs` | Contract tests exercise API/capability compatibility separately from version text. Artifact gate recomputes inventory, archive SHA-256 and canonical path-NUL-lowercase-SHA-256-LF `contentDigest`. |
| No workspace/link/absolute sibling dependency | `packages/sdk/package.json`, `scripts/verify-package.mjs`, `scripts/artifact-gate.mjs`, `scripts/legacy-scan.mjs` | Isolated tarball install/import checks PASS; all-root scan reports SDK 38/31/15, LLM 37/10/6, Memory 46/36/4 with no violations. |
| LLM v4-to-v1 migration remains LLM-owned | `I:\VUE\SS-Helper-LLM\src\storage\database.ts` and its migration tests | LLM `c11731b` reports typecheck/lint/test **21/21**, Chrome IndexedDB cutover/rollback and package/build PASS; Core contains no LLM persistence. |
| SDK owns generic workspace storage; Memory owns every memory rule | `server-plugin/index.js`, `packages/sdk/src/contracts/workspace.ts`, Memory `MemoryRepository` and `SdkMemoryHostContext` | The server plugin creates `data/_ss-helper/ss-helper.sqlite3` once per Tavern instance and exposes only health/browser/workspace routes. Memory is a frontend-only consumer of `session.workspace`; SDK contains no Memory schema, worker, dynamic import, route, fact conflict or recall implementation. |
| Scope exclusions stay excluded | `scripts/legacy-scan.mjs`, artifact/package gate records, repository scope audit | No registry publish or credential use; no original LLMHub change; no other-plugin migration; no Memory schema/protocol/version-ownership change. |
| Legacy residues fail closed | `scripts/legacy-scan.mjs`, `tests/legacy-scan.test.mjs`, `scripts/lint-boundaries.mjs` | The scanner rejects relative SDK imports, the retired global and memory facades, and legacy settings roots outside its explicit audit/test allowlist; final three-root scan has no violations. |
| Security and diagnostics are redacted | `apps/core-extension/src/diagnostics/diagnostics-store.ts`, `host/tavern-host-port.ts`, SDK plain-data contracts | `tests/communication-runtime.test.mjs` asserts diagnostics expose fixed redacted fields rather than payloads/secrets; HostPort tests enforce capability, payload, timeout and binary boundaries. |
| Official runtime proof is real | `scripts/real-st-browser-smoke.mjs`, `scripts/artifact-gate.mjs` | `artifacts/g009-release-evidence.json` records official SillyTavern 1.16.0 commit `e3b866b5d2bcc7fbaa889bb926fbb567cd1ed25b` and Chrome/150 CDP PASS with one Core/root and stable generation. |

See the [historical artifact/runtime evidence](artifact-gate.md#historical-artifactruntime-evidence--g008-fresh-rerun-required)
for hashes, verification commands, raw evidence locations, and the explicit
pending review condition.
