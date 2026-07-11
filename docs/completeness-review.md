# Completeness review: lims-core vs. a CRO/pharma LIMS

**Date:** 2026-07-10 · **Scope reviewed:** the code in this repository at the
vertical-slice milestone (17 tables, the accession→store→order→result→verify→
sign→audit workflow).

This is an honest gap analysis, not a sales sheet. It answers two questions a
Contract Research Organization or pharma sponsor actually asks: *"Could this run
our trial biobank?"* and *"Is this a drop-in for our existing commercial LIMS
install?"* The short answers are **"the core is real and unusually well-built,
but the functional surface is a fraction of what you need in production"** and
**"no, not today."** The rest of this document is the detail behind those
answers.

A note on method, consistent with this project's [house rule](../CLAUDE.md):
capability claims below are checked against the code, and nothing here restates a
regulation from memory. Where a compliance control is claimed, it traces to an
enforced behavior and a test in [`regulatory-traceability.md`](regulatory-traceability.md).

---

## The headline

lims-core today is a **thin but genuinely end-to-end vertical slice** with a
**production-shaped compliance core**. What it does, it does the way a modern,
auditable system should: the audit trail, e-signatures, chain of custody, and
least-privilege enforcement live in the database as triggers and roles, not in
application code that a bug or a rushed hotfix could bypass. That foundation is,
frankly, cleaner than what ships in several incumbent products.

But a CRO/pharma LIMS is an enormous functional surface, and most of it is not
here yet. There is no aliquot/volume tracking, no kits or shipments, no
analytical test-specification or QC layer, no instrument integration, no
reporting or dashboards, and no bulk operations. Those are not bugs — they are
deliberately out of scope for this milestone (see [`plan.md`](plan.md) and the
"Deferred" section of the traceability matrix). The point of this review is to
size that gap concretely so it can be planned against, not to imply it is
hidden.

**Readiness verdict:** a credible foundation and a compelling demo; **not yet a
system you could run a regulated trial biobank on**, and **not a replacement for
an established commercial LIMS**. The distance to the first is a focused roadmap
(Tier 1 below); the distance to the second is a multi-year platform effort.

---

## Tier 1 — Working today (production-shaped)

These are implemented, enforced, and covered by tests.

| Capability | Where | Notes |
| --- | --- | --- |
| Specimen accession | `routes/samples.ts`, `core/accession.ts` | Study/site scoping, specimen typing, EDC subject/visit **reference only** (no PHI), per-study accession IDs. |
| Aliquot workflow + volume | `core/aliquot.ts`, `routes/samples.ts` | Parent→child aliquots with parent-suffixed IDs, `sample_lineage`, `aliquot` custody events; optional per-sample quantity, conserved and deducted on aliquoting, parent depleted at zero (CoC-04, ADR-0006). |
| Shipments with custody handoff | `core/shipment.ts`, `routes/shipments.ts` | Pack → ship → receive a batch site→central; per-phase `transfer` custody events, in-transit state, send/receive separation of duties (CoC-06, ADR-0007). |
| Collection kits | `core/kit.ts`, `routes/kits.ts` | Assemble → ship → deliver empty-container kits to a site with contents and an audited lifecycle (ADR-0011). Kit→collected-sample linkage and par-level inventory deferred. |
| Bulk accessioning + freezer map | `core/bulk.ts`, `routes/studies.ts` | Count-based batch accession (shared fields), optional sequential box-fill (CoC-01/03); read-only, study-scoped freezer-map grid with capacity (ADR-0008). CSV import and interactive placement deferred. |
| Consent-withdrawal holds + disposal | `core/hold.ts`, `routes/holds.ts` | Hold a sample or a whole subject, propagated to lineage descendants; blocks store/aliquot/ship; releasable to the prior status; terminal, supervisor-only disposal (CoC-05, ADR-0009). Result-entry block and EDC-driven propagation deferred. |
| Reporting + CSV export | `core/reports.ts`, `routes/reports.ts` | Study-scoped inventory counts (status/type/site), collection→receipt and receipt→storage turnaround metrics, and a PHI-free sample-manifest CSV (ADR-0010). Assay turnaround, trend charts, and ad-hoc query deferred. |
| 2D barcode / label | `packages/labels` (bwip-js) | DataMatrix + human-readable accession ID, served as PNG. |
| Freezer storage | `routes/storage.ts`, `core/storage.ts` | facility→freezer→shelf→rack→box hierarchy, position allocation, **one-occupant-per-position** constraint, temperature on units. |
| Chain of custody | `custody_event` + triggers | Append-only events; collection/receipt/storage/transfer/aliquot/hold/disposal types (some reserved). |
| Test ordering | `routes/orders.ts` | `analysis_service` catalog → `analysis_request`. |
| Result entry + four-eyes verify | `core/results.ts` | **Versioned, append-only** results; correction requires a reason; verifier must differ from enterer. |
| E-signature | `core/esign.ts`, `signature` guard trigger | Password step-up re-auth, stated signature meaning, bound to a record hash, immutable with one-way invalidation. |
| Hash-chained audit trail | `audit_event` + `lims_audit()` | Per-study chains, tamper-evident, `lims_verify_audit_chain()`, reviewable/filterable UI. |
| RBAC + separation of duties | `auth/rbac.ts`, seed roles | Grant-based, scoped to study/site; six roles; system admins hold no lab authority. |
| Authentication | `auth/*` | OIDC SSO + Argon2 local fallback; session tokens stored only as sha256; failed-login lockout. |
| Immutability by construction | migrations `0001`/`0002` | DML-only `lims_app` role; triggers reject UPDATE/DELETE on regulated tables; app role cannot forge audit rows. |
| CI + compliance tests | `.github/workflows/ci.yml` | lint→typecheck→test on a real Postgres; tests assert the guarantees, each citing a requirement ID. |

## Tier 2 — Designed and reserved, not built

The data model or enum values exist so a future build won't have to migrate an
append-only table, but there is no logic or UI. A buyer should read these as
"architected for, months out," not "available."

- **Derivation / pooling trees.** Aliquoting is now built (Tier 1, CoC-04) with
  optional per-sample quantity. `sample_lineage` also carries `derivation` and
  `pool` relations, but the derivation (e.g. blood → DNA) and many-parent pooling
  workflows are not built yet. Concentration and freeze-thaw counts are also still
  absent.
- **Analytical module.** Test specifications/acceptance criteria, calculated
  results, worksheets, QC samples (blanks/spikes/duplicates/controls), and
  Certificate of Analysis generation are designed in `plan.md` but absent from
  the schema.

## Tier 3 — Not started (expected in a CRO/pharma LIMS)

None of the following exist in the repository yet. This is the real distance to
"production LIMS," listed so it can be prioritized rather than discovered.

**Biobank depth**
- Freeze-thaw cycle counts, concentration tracking, and derivation/pooling trees
  (aliquot volume/quantity itself is now built — Tier 1)
- Kit → collected-sample linkage and par-level kit inventory (assemble → ship →
  deliver collection kits and sample-bearing shipments are now built — Tier 1)
- CSV/manifest bulk import and interactive freezer-map placement (count-based
  bulk accession and a read-only map with capacity are now built — Tier 1)
- Sample request, reservation, and distribution workflows
- Reagent/consumable **inventory and lot/expiry** tracking

**Analytical / QC (the commercial-LIMS parity surface)**
- Configurable test catalog with specs, units, ranges, and calculations
- Worksheets, instrument runs, QC rules and Westgard-style evaluation
- Certificate of Analysis (PDF) generation
- Stability studies and environmental monitoring
- ELN / SDMS-style raw-data capture

**Instrument & interfaces**
- Instrument registry, calibration/maintenance scheduling
- Instrument result capture (ASTM/LIS2-A2, HL7v2), SiLA2 automation
- Data import/export and an integration API for EDC/CTMS and external systems

**Operations & platform**
- Dashboards, trend/time-series analytics, and ad-hoc query (basic inventory
  counts, turnaround-time metrics, and a manifest CSV export are now built —
  Tier 1)
- Notifications/alerts; temperature-excursion monitoring
- Configurable workflow / status state-machine (no-code)
- Document/SOP management and content-addressed WORM attachments (in `plan.md`,
  not in the slice)
- Label-template designer and printer (e.g. Zebra ZPL) integration
- Deviation/CAPA, nonconformance, training/qualification records
- Data retention/archival, backup/DR, and a formal validation package (IQ/OQ/PQ)

---

## On "drop-in replacement for a commercial LIMS"

Set expectations honestly. The established commercial LIMS platforms are large
and configurable — biobanking, stability, ELN, SDMS, dashboards, a no-code
workflow designer, and broad instrument integration. lims-core implements a
single, narrow workflow. The functional breadth gap is measured in years of
work, and any migration also carries data migration, revalidation, and
change-control cost that dwarfs the software.

Where lims-core is *ahead* is worth stating too, because it is the reason to
invest: the compliance substrate (tamper-evident hash-chained audit, DB-enforced
immutability, least-privilege runtime role, re-auth e-signatures, per-study audit
scoping) is modern and cleanly separated, and the stack (TypeScript, Postgres,
React) is a far easier hiring and maintenance story than a legacy Java/Oracle
LIMS. The honest pitch is **"an open, modern nucleus you can grow into an
alternative to those platforms,"** not "a replacement you can install next
quarter."

---

## Recommended next steps for the trial-biobank use case (Tier 1 → pilot)

If the goal is to run a sponsor's or CRO's biospecimen management, the shortest path to a
usable pilot — in rough priority order:

1. ~~**Aliquot workflow + volume/quantity fields.**~~ **Done** (Tier 1, CoC-04,
   ADR-0006): parent→child aliquots with conserved volume. Follow-ons still open:
   freeze-thaw counts, concentration, and derivation/pooling trees.
2. ~~**Kits & shipments with custody handoff.**~~ **Done** (Tier 1, CoC-06,
   ADR-0007/0011): pack → ship → receive site→central with an unbroken custody
   trail, plus assemble → ship → deliver collection kits (outbound empty
   containers). Kit→collected-sample linkage still open.
3. ~~**Bulk accessioning + freezer-map UI.**~~ **Done** (Tier 1, ADR-0008):
   count-based batch accession with optional box-fill, plus a read-only,
   study-scoped freezer map with capacity. CSV import and interactive placement
   still open.
4. ~~**Consent-withdrawal holds (CoC-05).**~~ **Done** (Tier 1, CoC-05,
   ADR-0009): hold a sample or a whole subject with lineage propagation, block
   store/aliquot/ship, release to the prior status, and a terminal
   supervisor-only disposal. Result-entry block and EDC-driven propagation
   still open.
5. ~~**Reporting/exports.**~~ **Done** (Tier 1, ADR-0010): study-scoped
   inventory counts, collection→receipt / receipt→storage turnaround metrics,
   and a PHI-free sample-manifest CSV. Assay turnaround, dashboards, and ad-hoc
   query still open.
6. **Reagent/lot inventory.** Needed once real assays run.

Each should land with the same discipline the slice already shows: a schema
change plus an ADR, requirement IDs threaded into column comments, and a
compliance test that proves any new regulated behavior — so the traceability
matrix stays honest as the surface grows.
