# G011 narrow binary Host artifact reissue

Canonical gate: `pnpm artifact:gate` (2026-07-14, PASS).

- SDK package: `artifacts/ss-helper-sdk-1.0.0.tgz`
- SDK SHA-256: `425e5509fdff5c73cdc7cf1200f969359caa76de9645199dd00fdda0fd9524ad`
- Core archive: `artifacts/ss-helper-core-1.0.0.zip`
- Core archive SHA-256: `73f35d03156f49460592fba71625feca4f8ca7a108a3f5353afc9281d20da125`
- Core payload contentDigest: `baaa73720a8eb0a334a322a00e26c6e0da2d8a44fc18ff50b009eb5cd8b5c514`
- Axes: Core `1.0.0`, SDK `1.0.0`, API `1.1`; consumer plugin versions remain independent.
- Toolchain: Node `v24.5.0`, pnpm `10.21.0`, TypeScript `5.9.2`, Windows `10.0.22631 x64`.
- Official host: SillyTavern `1.16.0` at `e3b866b5d2bcc7fbaa889bb926fbb567cd1ed25b`.
- Browser: Chrome `150.0.7871.102` via CDP.
- Runtime descriptor capabilities: `tavern.context.read`, `tavern.identity.read`, `tavern.character.read`, `tavern.persona.read`, `tavern.chat.read`, `tavern.chat.write`, `tavern.chat.events`, `tavern.prompt.contribute`, `tavern.plugin.request`, `tavern.plugin.binary-request.v1`, `tavern.generation.read`, `tavern.generation.execute`, `tavern.worldbooks.read`, `tavern.worldbooks.write`.
- LLM tokens: completion v1, structured-task v1, embedding v1, rerank v1, route-diagnostics v1, route-changed v1.

Machine-readable evidence remains generated under the legacy pipeline filename `artifacts/g009-release-evidence.json` (SHA-256 `48cd5aeede7c26590325aca50f9efa52dcae4b023a7cd3e9df13bee946883d1b`). The artifact gate also proves isolated NodeNext/Bundler consumption, one runtime/root/generation, two consumers, non-empty capability discovery, an authenticated byte-exact SQLite export plus raw-byte import returning a strictly validated JSON acknowledgement, including private request SHA-256 verification, and real official-host browser startup. Raw Tavern context, CSRF headers, provider payloads, tokens, and local sibling filesystem roots are not part of persisted release evidence.
