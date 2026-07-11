# ADR-0017: Analytical specifications and QC evaluation (first slice)

Status: accepted (2026-07-11)

## Context

The analytical/QC surface is the largest gap between lims-core and a commercial
LIMS: test specifications, calculated results, worksheets, QC control samples,
Westgard rules, and Certificates of Analysis. It is a multi-slice effort. This
ADR builds the first, highest-value slice on top of the existing
`analysis_service`/`analysis_request`/`result` tables: **acceptance criteria per
service, evaluated automatically at result entry** into a QC verdict.

## Decision

- **`analysis_specification` holds acceptance criteria, superseded not edited.**
  A spec is either a numeric range (`lower_limit`/`upper_limit`, either bound
  open) or a qualitative `expected_value`, enforced by a table CHECK. Setting a
  new spec deactivates the prior active row and inserts a new one, so spec
  history is retained — a result's verdict can always be traced to the criteria
  in force when it was entered. Specs are lab-wide (the service catalog has no
  `study_id`), so they audit to the `global` chain, like the services they hang
  off.
- **Evaluation happens at entry, stored on the result.** `enterResult` looks up
  the service's active spec and computes `qc_status`
  (`pass`/`out_of_spec`/`not_evaluated`), written on the appended result version.
  A numeric value is checked against inclusive bounds; a qualitative value is
  matched case-insensitively; anything not evaluable — no spec, or a non-numeric
  value against a numeric range — is `not_evaluated` rather than a failure.
  `evaluate()` is a pure function, unit-tested in isolation. `verifyResult`
  carries the verdict forward (it restates the value, so re-evaluating is
  unnecessary). The `result` table stays append-only; `qc_status` is a new
  column filled at insert, existing rows default to `not_evaluated`.
- **`spec.manage` is a supervisory authority, authorized "anywhere."** Defining
  acceptance criteria is a config act, so it is granted to `lab_admin` and
  `lab_manager`, not bench technicians. Because specs are lab-wide, the route
  authorizes on holding `spec.manage` in any study
  (`requirePermissionAnywhere`), the same lab-wide-resource resolution adopted
  for inventory in ADR-0016.

## Consequences

Results now carry an automatic, auditable in-spec/out-of-spec verdict — the
first genuinely analytical (as opposed to biobank) capability, and the anchor
the rest of the QC surface will build on. Because specs are versioned rather
than mutated, changing a limit never rewrites the meaning of a historical
result.

Deferred to later slices (named so the gap is explicit, not hidden): calculated
results and multi-analyte specs, worksheets and instrument runs, QC control
samples (blanks/spikes/duplicates/controls) with Westgard-style rule
evaluation, Certificate-of-Analysis PDF generation, and re-evaluating existing
results when a spec changes (today only newly entered results see a new spec).
The natural seam to ADR-0016: a future worksheet/run slice can link a reagent
lot's `consumed` transaction to the `analysis_request` it served.
