# Final dual artifact gate

Run the final evidence gate from the repository root:

```powershell
pnpm artifact:gate
```

The gate restores the locked toolchain, creates fresh SDK/Core artifacts, verifies package exports/declarations and isolated tarball installation, checks Core inventory and canonical `contentDigest`, then runs the official SillyTavern 1.16.0 + browser/CDP smoke with artifact consumers. It emits the current release evidence under `artifacts/`; do not commit generated binaries.

1. restore the exact locked toolchain with `pnpm install --frozen-lockfile`, then clean previous `dist` and `artifacts` outputs;
2. build and pack a fresh `@ss-helper/sdk` tarball;
3. enforce its file/export/declaration allowlist and types-first exports;
4. copy it outside the repository, generate a lockfile, reinstall with `--frozen-lockfile`, and run NodeNext, Bundler, and runtime checks after moving the tarball;
5. build an installable Core extension zip under `third-party/SS-Helper-SDK` with artifact-owned SDK runtime files and CSS;
6. verify every payload size/hash and the canonical, non-self-referential `contentDigest` in `artifact-manifest.json`;
7. verify/cache the official SillyTavern `1.16.0` tag at commit `e3b866b5d2bcc7fbaa889bb926fbb567cd1ed25b`, install its official lockfile, and start it with a fresh temporary data root/config and dynamic localhost port;
8. side-load the extracted Core plus two artifact-SDK consumer fixtures into that isolated data root, then use a fresh headless Chrome/Edge profile and a minimal CDP client to measure ready discovery, stable generation, one Core, one settings root, and two connected consumers in the actual page;
9. write the current release-evidence JSON and `artifacts/README.md`, including both artifact hashes, content inventory, official ST/browser/toolchain versions, command exit codes, and measured results;
10. stop the server/browser and delete all temporary data, profile, extraction, and consumer directories.

`archiveSha256` is deliberately recorded only in release evidence. It is recalculated from the completed zip and is not included in the payload `contentDigest`, avoiding a self-referential digest.

`contentDigest` is SHA-256 over payload inventory entries sorted by ordinal path. Each UTF-8 entry is exactly `path + NUL + lowercaseSha256 + LF`; file sizes, JSON serialization, `artifact-manifest.json`, and the archive hash are excluded.

The workspace release manifest records the SDK tarball with `sdkTarball.sourcePath`
relative to the repository root (`SS-Helper-SDK/artifacts/<file>`). The tarball is
an input/source artifact for consumer installation and is intentionally not copied
into `dist` or the SillyTavern plugin directories; the deployed Core artifact
contains its own browser SDK runtime.

## Historical artifact/runtime evidence — G008 fresh rerun required

`artifacts/g009-release-evidence.json` indexes **historical G009** artifact/runtime verification. It is not final fresh G008 evidence: G008 remains `in_progress` and requires a new full rerun before any completion claim. Memory's current post-transcoding baseline is `ab55ec7`; `b84d8a1` is only a pre-transcoding historical evidence node. This record does not authorize
publishing, registry credentials, a change to the original LLMHub, another-plugin
migration, or a Memory schema/server/protocol change. At the time of this
historical evidence snapshot, final independent `code-reviewer` approval and
`architect` clearance were **pending**; this record does not state that either
has since completed, and aggregate completion must not be claimed from it.

| Check | Result | Raw evidence location |
|---|---|---|
| Locked install, typecheck, lint, build, pack | PASS | historical G007/G009 run record; fresh G008 rerun required; reproduce with the commands below |
| Test suite | **57/57 PASS** | historical G007/G009 run record; fresh G008 rerun required |
| Isolated package verification | PASS; **59 entries** | `artifacts/g009-release-evidence.json` (historical G009; fresh G008 rerun required) |
| Artifact gate and official runtime | PASS; SillyTavern 1.16.0 + Chrome/150 CDP | `artifacts/g009-release-evidence.json` (historical G009; fresh G008 rerun required) |
| Documentation links | **14 tracked Markdown files valid** | `pnpm verify:docs` output in the historical G007/G009 run record; fresh G008 rerun required |
| LLM (`c11731b`) | typecheck/lint/test **21/21**, Chrome v4-to-v1 migration, build/package PASS | historical LLM verification record; fresh G008 rerun required |
| Memory (`ab55ec7` current post-transcoding baseline) | Pre-transcoding historical node `b84d8a1`: typecheck/lint/test **136 passed**, one environment-gated skip, build/legacy scan PASS | historical Memory verification record; fresh G008 rerun required |
| Final legacy scan | SDK **38/31/15**, LLM **37/10/6**, Memory **46/36/4**; no violations | historical all-root scan output; fresh G008 rerun required |

Historical G009 artifact identity for this evidence set:

- SDK SHA-256: `425e5509fdff5c73cdc7cf1200f969359caa76de9645199dd00fdda0fd9524ad`
- Core ZIP SHA-256: `73f35d03156f49460592fba71625feca4f8ca7a108a3f5353afc9281d20da125`
- Core canonical `contentDigest`: `baaa73720a8eb0a334a322a00e26c6e0da2d8a44fc18ff50b009eb5cd8b5c514`
- Official SillyTavern 1.16.0 commit: `e3b866b5d2bcc7fbaa889bb926fbb567cd1ed25b`

`archiveSha256` hashes archive bytes. `contentDigest` hashes the sorted payload
inventory (`path + NUL + lowercase SHA-256 + LF`) and is distinct from both the
archive hash and a timestamped JSON-evidence hash.

Reproduce from `I:\VUE\SS-Helper-SDK` after restoring locked dependencies:

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm pack:sdk
pnpm verify:package
pnpm artifact:gate
pnpm verify:docs
node scripts/legacy-scan.mjs --sdk-root . --llm-root I:\VUE\SS-Helper-LLM --memory-root I:\VUE\SS-Helper-Memory
```

The artifact gate currently writes structured evidence to
`artifacts/g009-release-evidence.json`; that filename denotes historical G009 artifact/runtime evidence and does not make it final fresh G008 evidence. Generated artifacts are evidence output,
not documentation changes to commit. A rerun can change timestamps and the
evidence-file hash without changing the artifact identity above.
## Evidence naming and identity

The final SDK tarball SHA-256, Core zip SHA-256, and Core `contentDigest` are
artifact identities. They are not interchangeable with the hash of a release
evidence JSON. Evidence files contain timestamps and command output, so their
own hash normally changes whenever evidence is refreshed even if the artifacts
do not. Record artifact hashes in the final release evidence/inventory and
label timestamped evidence-file hashes separately. Do not add generated binary
artifacts to Git merely to update this documentation.

