# ADR-0009: Consent-withdrawal holds and disposal

Status: accepted (2026-07-10)

## Context

When a trial subject withdraws consent, the specimens collected from them can no
longer be used, and depending on the protocol they are quarantined and then
destroyed. A biobank needs to place the affected samples out of use, record why,
and eventually dispose of them, with the whole sequence captured in the custody
trail. The same hold mechanism also covers non-consent quarantine (a suspected
mix-up, a temperature excursion under investigation).

The seams were reserved but unbuilt: `sample.status` reserved `on_hold` and
`disposed`, and `custody_event.event_type` reserved `hold`, `hold_release`, and
`disposal` (0000_init.sql), so no append-only table needed migrating. What was
missing was the transition logic, propagation, guards, and permissions.

**CoC-05 is a project-internal requirement ID**, not a citation. It reads:
"consent-withdrawal / quarantine holds move affected samples and their lineage
out of use with an auditable reason, and disposal is a terminal, attributed
custody event." The specific regulatory obligations around consent withdrawal in
a given jurisdiction/protocol are not restated here (house rule); this records
the enforced behavior, and a human maps it to the governing text.

Three points needed deciding.

- **How wide a hold reaches.** Consent withdrawal is per *subject*, not per tube,
  and a held specimen's aliquots and derivatives must be caught with it.
- **What a hold blocks, and how release restores state.** A held sample must not
  move or be consumed; releasing it should return it to exactly where it was.
- **Who may hold versus dispose.** Disposal is destructive and irreversible.

## Decision

- **Holds target a sample or a whole subject, and always expand to lineage
  descendants.** `placeHold` takes either a `sampleId` or a `subjectKey` (all of
  that subject's samples in the study — the consent-withdrawal case) and walks
  `sample_lineage` to include every descendant, so aliquots and derivatives are
  held with their parent. `on_hold` samples are rejected by the `storeSample`,
  `aliquotSample`, and shipment guards, so a hold blocks movement, consumption,
  and distribution. In-transit and already-disposed samples in scope are skipped.
- **The prior status is remembered so release is exact.** A new
  `sample.pre_hold_status` column captures the status at hold time; `releaseHold`
  restores it (a stored sample returns to `in_storage`, a bare one to
  `registered`) and clears the column. Deriving the prior state from storage
  presence would have been close but wrong for `in_testing`; one nullable column
  keeps it exact without a separate history table (the audit trail already has
  the history).
- **Every transition is a custody event carrying the reason.** `hold`,
  `hold_release`, and `disposal` events record the reason (and, for disposal, an
  optional method) in `details`, so the custody timeline explains itself. This is
  **CoC-05**.
- **Hold and dispose are separate permissions.** `sample.hold` (place/release) is
  a routine operational authority; `sample.dispose` is the terminal, destructive
  step held by supervisors only (`lab_admin`, `lab_manager`), mirroring the
  send/receive split. Disposal frees the sample's storage position and is allowed
  from any live status — the hold→dispose consent path is the common one but not
  required (expired or depleted samples are disposed directly).

## Consequences

The reserved consent-withdrawal control is now real end to end, with propagation
that matches how consent actually applies (a subject, and everything derived from
their specimens). Because it is built from the existing audited mutations and
custody events, it added one nullable column and two permissions — no new tables
and no change to the append-only surface.

The costs are scope edges left for later: a hold does not yet block *result
entry* on an open order (the physical-custody guards — store, aliquot, ship —
are covered; an assay already in progress is not), and there is no automated
propagation from an EDC consent-withdrawal event — a coordinator places the hold.
Both are follow-ons; the `hold`/`hold_release`/`disposal` events and the
subject+lineage resolution are the durable part.
