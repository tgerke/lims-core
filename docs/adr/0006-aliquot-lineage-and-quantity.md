# ADR-0006: Aliquot identity and quantity conservation

Status: accepted (2026-07-10)

## Context

The vertical slice can accession, store, order, result, sign, and audit a single
specimen, but it cannot split one. Aliquoting is the highest-leverage next step
in the [completeness review](../completeness-review.md): a trial biobank draws
child aliquots from a parent specimen and manages inventory by volume. The schema
already reserved the seams — `sample_lineage` with an `aliquot` relation, the
`aliquot` custody event type, and audit-trigger coverage on `sample_lineage` — but
`sample` had no quantity, and there was no aliquoting logic, so nothing conserved
volume or recorded the parent→child relationship.

Two decisions had real design weight.

**How child aliquots are named.** Options were a fresh top-level accession id per
child (from the per-study counter) or a parent-suffixed id. A fresh id keeps
`formatAccessionId` untouched but hides lineage in the id — you cannot tell a child
from an independent specimen without querying `sample_lineage`.

**Whether volume is mandatory.** Requiring a recorded quantity before any sample
can be aliquoted enforces stricter inventory discipline, but it adds friction to
the demo and to early workflows where a lab hasn't captured volumes yet.

## Decision

- **Aliquot ids are parent-suffixed:** `formatAliquotId(parent, n)` → `PARENT.n`
  (e.g. `DEMO-001-00001.1`, `.2`). The ordinal is 1-based and continues across
  repeat aliquot operations by counting existing `aliquot` lineage children. The
  accession-id validator (`ACCESSION_ID_PATTERN`) accepts an optional `.\d+`
  suffix so aliquots still round-trip and render as DataMatrix labels.
- **Quantity is optional but conserved when present.** `sample.quantity` /
  `quantity_unit` / `initial_quantity` are nullable. If a parent has a tracked
  quantity, aliquoting requires a per-child volume, asserts
  `count * volume <= quantity`, deducts it, and marks the parent `depleted` at
  zero. A sample with no tracked quantity still aliquots (children carry no
  volume). Quantity is operational-mutable; its changes are captured by the
  existing `sample` audit trigger (AFTER UPDATE), so there is no separate audit
  path and no forge path for the runtime role.
- **Lineage and custody are recorded atomically.** In one `withActor`
  transaction, each child is inserted, linked by a `sample_lineage` row
  (`relation = 'aliquot'`), and opened with an `aliquot` custody event; the parent
  records one `aliquot` custody event naming the children and the parent quantity
  is deducted. This is requirement **CoC-04**: aliquoting preserves an auditable
  parent→child lineage and conserves quantity.

## Consequences

Lineage is legible at a glance from the id, which matches common biobank
practice and keeps the DataMatrix label self-describing. Optional quantity keeps
the demo and early adoption low-friction while still enforcing conservation the
moment a lab starts tracking volumes — the discipline scales with the data, not
ahead of it.

The cost is that `sample.accession_id` is no longer purely counter-derived, so the
uniqueness guarantee now spans two id shapes; the unique constraint still enforces
it, and the suffix is deterministic from parent + ordinal. Freeze-thaw cycle
counts, pooling (many parents → one child), and derivation (e.g. blood → DNA) reuse
`sample_lineage` but are out of scope here and left for a later change.
