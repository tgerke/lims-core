# ADR-0019: QC control samples and single-point Westgard evaluation (first slice)

Status: accepted (2026-07-11)

## Context

ADR-0017 (specifications) and ADR-0018 (worksheets) both left the same forward
reference: QC control samples (blanks/spikes/duplicates/controls) with
Westgard-style rule evaluation. A control material is a QC sample with a known
target run alongside patient samples on a run; its measured value is checked
against the target to decide whether the run is in control. This ADR builds the
first slice on top of the worksheet (ADR-0018): a control material catalog and
control measurements evaluated at entry with the single-point Westgard rules.

## Decision

- **`control_material` holds the target, superseded not edited.** A control
  material is a `level` + `lot_number` for an analysis service with an
  established `target_mean` and `target_sd` (`target_sd > 0`, the z-score
  denominator). Setting a new one deactivates the prior active row, so a
  measurement's verdict always traces to the target in force — the same
  versioning discipline as `analysis_specification` (ADR-0017). Control
  materials are lab-wide (the service catalog has no `study_id`), so they audit
  to the `global` chain, like the services and specs they sit beside.
- **Evaluation is single-point Westgard, at entry, frozen on the row.**
  `evaluateControl(mean, sd, value)` is a pure function returning the z-score
  and a verdict: **1-3s (|z| > 3) → reject, 1-2s (|z| > 2) → warning, else
  accept**. `recordQcMeasurement` computes it against the control's target and
  appends a `qc_measurement` tied to the worksheet, with z-score and verdict
  frozen. `qc_measurement` is append-only (rejects UPDATE/DELETE like `result`
  and `custody_event`); a mis-entry is corrected by recording another
  measurement, never by editing.
- **Authority reuses existing grants — no new permission.** Defining a control
  material is a config act, so it reuses `spec.manage` (lab_admin, lab_manager)
  authorized lab-wide (`requirePermissionAnywhere`, as ADR-0016/0017 do for
  lab-wide resources). Recording a measurement is bench work on a run, so it
  reuses `worksheet.manage` (ADR-0018) scoped to the run's study.

## Consequences

A run now carries an in-control/out-of-control verdict for its QC samples
alongside the per-order spec verdicts, the first QC-material capability. Because
control materials are versioned rather than mutated, changing a target never
rewrites the meaning of a historical measurement, and because measurements are
append-only, a recorded verdict cannot be quietly revised.

The 2 SD / 3 SD thresholds are Westgard's published single-rule definitions.
Per the project hard rule (never write regulatory/methodology specifics from
model memory), they are flagged in the migration, the schema, and
`evaluateControl` for a human to verify against an authoritative Westgard
reference before clinical reliance.

Deferred (named so the gap stays explicit): the multi-observation Westgard rules
(2-2s and R-4s within a run across two control levels; 4-1s and 10-x across
runs) — they need paired or historical control data this slice does not model;
control-type distinctions (blank/spike/duplicate vs. level control); a
run-level in-control gate that blocks result verification when a control
rejects; Levey-Jennings trending; and a UI to manage the control material
catalog (created via API here, like specs in ADR-0017).
