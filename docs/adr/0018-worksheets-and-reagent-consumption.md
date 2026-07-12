# ADR-0018: Worksheets/runs and reagent consumption

Status: accepted (2026-07-11)

## Context

Reagent inventory (ADR-0016) and analytical specifications (ADR-0017) both left
a forward reference to the same seam: a real assay run batches orders onto an
instrument and consumes reagent lots, and that consumption should be traceable
to the run that caused it. This slice builds the worksheet/run that closes the
seam. It is the first analytical *operation* — the prior slices were catalog and
evaluation; this one is the batch of work.

## Decision

- **A worksheet is a study-scoped batch of orders.** `worksheet`,
  `worksheet_item`, and a per-study `worksheet_counter` mirror the shipment
  shape (`STUDY-001-WS-00042` identity, denormalized `study_id` on the item for
  the per-study audit chain, ADR-0002). Orders are batchable while open
  (`ordered`/`resulted`/`verified`); a signed or cancelled order is closed, and
  an order already in an open run cannot be double-batched — the same
  open-membership guard shipments use.
- **`worksheet_reagent` is the seam, and it points at the ledger.** Recording a
  run's reagent use calls the inventory `consumeLot` path (so every draw goes
  through the same append-only ledger, expiry, and depletion rules as ADR-0016)
  and links the resulting `inventory_transaction` by id. A run's reagent usage
  is therefore reconstructable from the ledger, not a parallel record that could
  drift. `consumeLot` was refactored to return `{ lot, transaction }` so the
  caller gets the ledger row to link; the inventory route's own behavior is
  unchanged.
- **Lifecycle is `draft → in_progress → completed`** (`cancelled` reserved),
  guarded server-side. Reagent use may be recorded while the run is open (draft
  or in progress). One `worksheet.manage` authority (lab_admin, lab_manager,
  technician — bench work) covers assembly, reagent recording, and transitions.
- **Result entry stays per-order.** A worksheet batches and shows its orders'
  current results and QC verdicts, but results are still entered and verified
  through the existing per-order panel. Batch entry in the run view is a later
  refinement, not a new write path here.

## Consequences

The three analytical pieces now connect: specs define acceptance criteria, a run
batches the orders and draws the reagents, and result entry evaluates against
the spec — with reagent consumption auditable to the lot and the ledger row.
Because the run reuses `consumeLot`, there is exactly one place that mutates lot
quantity, and the worksheet cannot invent consumption the ledger doesn't show.

Deferred (named so the gap stays explicit): instrument registry and integration
(the instrument is free text), QC control samples (blanks/spikes/duplicates/
controls) and Westgard-style rule evaluation across a run, plate/tray layout and
worksheet templates, batch result entry from the run view, and reversing a
reagent draw (a mis-record is corrected by an inventory adjustment, not by
editing the append-only link).
