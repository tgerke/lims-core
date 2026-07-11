# ADR-0016: Reagent/lot inventory

Status: accepted (2026-07-11)

## Context

Once real assays run, the lab needs to track the reagents and consumables they
consume: what was used, from which lot, when, and by whom. A lot has a vendor
lot number, an expiry date, and a finite quantity that depletes as it is used.
This is the last of the biobank-pilot follow-ons (completeness review step 6)
and the first piece of the "supplies" surface.

Two design questions shaped the build.

**Scope.** Every regulated table so far is study-scoped, and the audit chain is
partitioned per study (ADR-0002). But reagents are not study property — a lab
buys a lot of Taq polymerase once and draws from it across every study it runs.
Forcing a `study_id` onto inventory would mismodel the domain and multiply the
same lot across studies.

**Authorization.** RBAC grants are scoped to a study/site (`hasPermission`
requires a `studyId`). A lab-wide resource has no study to check a grant
against, and there is no org-level or global grant concept today.

## Decision

- **Lab-wide, audited to the `global` chain.** `inventory_item`,
  `inventory_lot`, and `inventory_transaction` carry no `study_id`. `lims_audit()`
  already derives `chain_scope = 'global'` for rows without one, so these writes
  audit tamper-evidently on the global chain with no trigger change. This is a
  deliberate use of that fallback, not an oversight.
- **An append-only ledger is the source of truth.** `inventory_transaction`
  records every quantity movement (`received`/`consumed`/`adjusted`/`discarded`)
  as a permanent, attributable row, guarded by the same `lims_reject_mutation()`
  trigger the `result` and `custody_event` tables use (P11-01/P11-02).
  `inventory_lot.quantity_remaining` is a denormalized running total; the ledger
  reconciles to it (a compliance test asserts the sum). Consumption refuses an
  expired, quarantined, discarded, or already-depleted lot and any over-draw;
  the lot flips to `depleted` at zero, mirroring the parent-depletion rule in
  aliquoting (ADR-0006).
- **Authorize "anywhere" as an interim resolution.** One `inventory.manage`
  authority (held by `lab_admin`, `lab_manager`, `technician`) governs the
  lifecycle. Because there is no study to scope it to, the route guard
  (`requirePermissionAnywhere` → `hasPermissionAnywhere`) allows the action when
  the user holds `inventory.manage` in **any** study they belong to. Read
  visibility is any authenticated user. This is knowingly coarse — a lab
  technician on study A can manage a lot study B will draw from — and is
  acceptable for a shared supply store. A true org/lab-scoped grant is deferred
  to a future RBAC ADR; this decision is the thing to revisit then.
- **Routes live off `/inventory/*`, not `/studies/:studyId/*`,** reflecting the
  lab-wide scope — the first domain area that departs from the study-scoped
  route shape.

## Consequences

Reagent consumption is now traceable and attributable with the same append-only
discipline as the rest of the system, on the audit chain that already existed
for scope-less rows. The catalog/lot/ledger split means a recount or a discard
is a first-class event, not a silent field edit.

The costs are the deferrals: the "anywhere" authorization is coarser than a
real lab would want (no per-lab or per-department scoping), there is no
par-level reorder or low-stock alerting, expiry is evaluated on read rather than
swept by a job, and a lot is not yet tied to the assay run that consumed it. The
last is the natural seam to the analytical module (ADR-0017): a future worksheet
slice can link a `consumed` transaction to an `analysis_request`.
