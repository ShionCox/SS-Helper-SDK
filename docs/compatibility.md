# Compatibility and security boundaries

Core artifact version, SDK package version, API major/minor, and plugin version
are independent axes. A compatible plugin may connect when version text differs;
matching text never overrides an API, capability, or contract mismatch.

Discovery is generation-aware. Repeated compatible installs reuse the active
Core; disposal rejects new calls, closes sessions/listeners/UI, and publishes a
read-only disposed descriptor. A successor increments generation, while old
sessions fail stale calls. Reconnect is bounded (three attempts within ten
seconds) and must not leak timers/listeners.

Binary Host requests are narrowly capability-gated, size-bounded, and
authenticated privately by Core. The same-realm model prevents accidental API
misuse, not malicious extension execution: capability metadata and artifact
hashes are neither isolation nor a trust attestation.
