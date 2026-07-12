# ADR-0020: Calculated results

Status: accepted (2026-07-11)

## Context

ADR-0017 deferred "calculated results and multi-analyte specs": some reported
analytes are not measured directly but computed from other analytes on the same
sample (a ratio, an index, a percentage). This slice adds that computation on
top of the existing `analysis_service` / `result` model, keeping calculated
results versioned and spec-evaluated exactly like measured ones.

## Decision

- **A service's formula lives in `analysis_calculation`, superseded not edited.**
  A calculation binds an output service to an `expression` and a set of input
  variables (`analysis_calculation_input`), each bound to an input analysis
  service. Setting a new formula deactivates the prior active row, so a
  calculated result always traces to the formula in force — the same versioning
  discipline as `analysis_specification` (ADR-0017). Formulas are lab-wide (the
  service catalog has no `study_id`), so they audit to the `global` chain.
- **The expression is evaluated by a hand-written parser, never `eval`.**
  `evaluateExpression` is a pure recursive-descent evaluator over `+ - * / ( )`,
  unary minus, decimal numbers, and the declared variables. It cannot reach any
  host capability — the only thing it computes is arithmetic over the supplied
  values. It throws on a syntax error, an unknown variable, or division by zero,
  and is unit-tested in isolation (including injection attempts like
  `process.exit(1)`). At definition time the formula is parse-checked against its
  declared variables, so an undeclared reference is rejected then, not at compute.
- **Computing reuses `enterResult`.** `computeCalculatedResult` gathers the
  current result of each input service on the sample, evaluates the expression,
  and appends the value through the existing result path with `source =
  'calculated'`. So a calculated result is versioned, QC-evaluated against the
  output service's spec, verifiable, and signable exactly like a measured one;
  `result.source` is a new column (existing rows default to `'measured'`).
  Recompute appends a new version (a correction), never overwrites.
- **Authority reuses existing grants — no new permission.** Defining a formula
  is a config act (`spec.manage`, lab-wide, `requirePermissionAnywhere`);
  computing is result entry (`result.enter`), scoped to the order's study.

## Consequences

The lab can now report analytes it computes rather than measures, with the
calculation auditable to the formula and the input results it consumed, and with
no new write path or trust boundary — the formula evaluator is pure and
sandboxed by construction, and the output flows through the same versioned,
spec-evaluated, signable result pipeline as everything else.

Deferred (named so the gap stays explicit): multi-analyte specifications (a spec
spanning several analytes, as opposed to a single calculated value evaluated
against its own service's spec); automatic recomputation when an input result
changes (today compute is an explicit action); formula functions beyond
arithmetic (min/max/round/log); and cross-sample or time-series calculations.
