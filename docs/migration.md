# Migration

Migrate consumers from old SDK/source-relative imports, window globals, and old
settings roots to the packaged local SDK tarball and Core discovery. Use typed
tokens/DTOs, Core-rendered settings, and registered popups; remove dual-path
compatibility rather than retaining a facade.

LLM retains its own Dexie data. Its v4-to-v1 cutover copies only LLM stores,
verifies parity before writing a marker, leaves non-LLM legacy rows unchanged,
and rolls back partial writes without changing the old authority prematurely.
Memory retains its SQLite schema, server protocol, data ownership, and version
metadata; its binary backup/import contract remains Core-mediated without a
schema or protocol rewrite. Consumers validate against the final local tgz, not
workspace links or absolute sibling paths.
