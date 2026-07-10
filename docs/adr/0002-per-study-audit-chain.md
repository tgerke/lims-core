# ADR-0002: Per-study hash-chained audit trail

Status: accepted (2026-07-10)

## Context

The audit trail must be tamper-evident (21 CFR Part 11 §11.10(e)): every write
to a regulated table records a hash-chained event, and any retroactive edit is
detectable by recomputing the chain. `ctms-core`'s writer
(`ctms_audit()`) links every event to the single global tail and takes
`pg_advisory_xact_lock(hashtext('ctms_audit_chain'))` on every write — one
global chain serializing all writes system-wide.

LIMS has high-throughput write paths CTMS does not: bulk accessioning of a
shipment, instrument result loads, freezer-move batches. A single global chain
would serialize all of them behind one advisory lock, and a busy study would
throttle every other study's writes.

## Decision

Partition the chain by **study** (scope key `study:<uuid>`, or `global` for
rows without a study). Each scope is an independent chain:

- `audit_event.chain_scope` carries the key (column added in `0000_init.sql`,
  before the append-only table is frozen — it can't be added cheaply later).
- `prev_hash` links within a scope; the hash covers `chain_scope`, so events
  can't be replayed into another scope.
- The advisory lock is keyed per scope
  (`hashtextextended('lims_audit_chain:' || scope, 0)`), so appends serialize
  only within a study.
- `lims_verify_audit_chain(scope)` replays one scope, or every scope when
  called with NULL.

The trigger derives the scope from the row's own `study_id`. `custody_event`
denormalizes `study_id` from its sample so the trigger never needs a lookup.

## Consequences

No global write bottleneck; a study's chain is independently verifiable and
exportable. The cost: verification and "is the whole trail intact?" iterate
over scopes rather than one list, and cross-study ordering is not defined by
the chain (it is still recoverable from `occurred_at`/`id`). The scope column
is load-bearing and immutable — a future need to re-scope (e.g. per-site)
would require a new column, not an edit.
