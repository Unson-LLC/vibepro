# regression_risk review #5

status: needs_changes

Authority-loss, lock, partial bootstrap, traversal, legacy CLI compatibility, and authority non-expansion are coherently fail-closed. Two schema-migration boundaries require revision:

1. Migration of an older `cancelled` Run conflicts with byte-for-byte repeated cancellation unless migration precedence is explicit.
2. Managed Run migration needs an authority-first mirror synchronization and recovery contract, including mirror-failure and restart fixtures.

Evidence: Architecture migration, Lifecycle, and Command contract sections; Spec `S-004`, `S-005`, `INV-005`; existing `writeExecutionStateWithLinkedCopies` authority-first behavior.
