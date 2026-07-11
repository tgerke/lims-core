# ADR-0013: Freeze-thaw counts and concentration

Status: accepted (2026-07-10)

## Context

Two specimen attributes matter for downstream assay validity and were named as
aliquot follow-ons: how many freeze-thaw cycles a specimen has been through
(cycles degrade many analytes) and its measured concentration (e.g. nucleic-acid
yield). Neither existed on the sample record.

The question is whether these are *custody* events or *operational attributes*.
Aliquoting and storage moves are custody events because they change who or where
the specimen is. A freeze-thaw or a concentration reading changes neither — they
are properties of the specimen, like the tracked `quantity` already is (CoC-04),
whose changes the sample `AFTER UPDATE` audit trigger already captures.

## Decision

- **They are operational sample columns, audited by the sample trigger.** New
  `freeze_thaw_count` (integer, default 0), `concentration` (numeric), and
  `concentration_unit` columns on `sample`. Changing them is an ordinary audited
  UPDATE — the audit trail records before/after — so no new `custody_event` type
  and no reserved-enum migration on an append-only table.
- **Freeze-thaw is an increment operation; concentration is a set operation.**
  `POST /samples/:id/freeze-thaw` bumps the count by one (recording that the
  specimen was thawed once more); `POST /samples/:id/concentration` sets the
  value and unit. Both refuse a specimen that is `disposed` or `on_hold` — you
  cannot handle a specimen that is gone or quarantined.
- **They reuse `sample.aliquot` as the bench-handling authority.** Recording a
  thaw cycle or a concentration is the same class of physical bench manipulation
  as aliquoting, held by the same lab roles (`lab_admin`, `lab_manager`,
  `technician`) and not by the receiving-desk `accessioner`. Reusing it keeps the
  RBAC surface small rather than minting a permission per attribute.

## Consequences

Specimen quality is now tracked where it belongs — on the specimen, in the
audited record — with the smallest possible surface: three columns, two
endpoints, no new custody type or permission. A freeze-thaw count that keeps
climbing, or a concentration below an assay's floor, is now visible on the sample
and in the audit trail.

The costs are the richer models left out: no configurable freeze-thaw *limit*
with an automatic hold when exceeded, no concentration acceptance criteria tied
to an assay spec (that belongs to the unbuilt analytical module), and
concentration is a single latest value rather than a measurement history with
method and instrument. These are quality-module follow-ons; the audited
per-specimen attributes are the durable part.
