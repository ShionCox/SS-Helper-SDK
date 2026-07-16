# Migration

Consumers use the packaged local SDK tarball and Core discovery. Use typed
tokens/DTOs, Core-rendered settings, registered popups and the generic
`session.workspace` port; remove dual-path compatibility rather than retaining
a facade.

The current architecture is a clean cutover: LLM and Memory keep their business
logic in their own extensions, while SDK owns the shared SQLite workspace and
encrypted Secret API. No old Dexie, Vault, Memory server protocol, binary
SQLite backup, or legacy settings data is discovered, migrated or imported.
Consumers validate against the final local tgz, not workspace links or absolute
sibling paths.
