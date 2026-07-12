# ADR-0024: QC review and Levey-Jennings trending

Status: accepted (2026-07-12)

## Context

The QC slices built an evaluation pipeline — single-point Westgard rules
(ADR-0019), the run-level release gate (ADR-0021), and the sequential
multi-observation rules keyed on control material (ADR-0023) — that freezes a
verdict, z-score, and the rule that fired onto each append-only `qc_measurement`
row. Until now nothing surfaced that data: a reviewer could not see a control's
history, only a run's pass/fail. ADR-0023 named the gap explicitly and deferred
"Levey-Jennings trending and a QC-review UI." This slice fills it. It adds no new
evaluation and no new writes — it reads the frozen rows the pipeline already
produced.

## Decision

- **Read-only, no new regulated surface.** Two authenticated GET endpoints
  (`GET /qc-review`, `GET /control-materials/:id/series`) and a web page; no
  mutations, no `withActor`, no permission beyond authentication — the same
  posture as the run's control-material picker (ADR-0019). QC verdicts are a
  quality control, not a 21 CFR Part 11 requirement (ADR-0023), so this slice
  adds no traceability requirement ID and no immutability guarantee of its own;
  it depends on the existing `qc_measurement` append-only trigger.
- **Lab-wide, keyed on control material.** Control materials are not
  study-scoped (ADR-0019) and QC performance is a property of the material lot
  across runs and studies (ADR-0023), so both the board and the series are
  lab-wide and neither route sits under `/studies/:id`. The board (`qc-review`)
  lists every *active* control with its measurement count and latest
  verdict/rule/z-score, computed with the same latest-per-control `DISTINCT ON`
  the release gate uses (ADR-0021) so a control reads the same "current" state in
  both places. The series returns one control's measurements oldest-first — the
  Levey-Jennings plotting order — with the frozen z-score, verdict, and rule on
  each point. Because a control's mean/SD is frozen and superseded-not-edited
  (ADR-0019), every z-score in a series is directly comparable.
- **The chart plots z-scores, not raw values.** Levey-Jennings convention: the
  y-axis is SD from the mean, with ±1/±2/±3 SD reference bands, points colored by
  the frozen verdict (accept/warning/reject) and a rejecting point annotated with
  the rule that fired. Plotting z rather than the raw value is what lets one axis
  serve any analyte and makes the Westgard bands fixed gridlines.
- **The demo seed records QC in per-measurement transactions.** `now()` is
  transaction-scoped in Postgres, and both the Westgard look-back (ADR-0023) and
  this chart order by `created_at`; measurements sharing a transaction would tie
  on timestamp. In the running app each measurement is already its own request
  and transaction, so this only constrains seeding: `seed-demo` records the demo
  control's measurements in a loop of separate transactions after the main seed
  commits.

## Consequences

A reviewer can now see a control drift across runs before it fails — the seeded
demo shows eight in-control points, a 1-2s warning, then a rejecting 2-2s — which
is the whole point of trending over single-value QC. Because the read reports
frozen rows and never re-evaluates, the board and chart always agree with the
release gate and with what was true when each measurement was recorded.

The chart's rule labels and ±SD bands render Westgard's published reference
range; per the project hard rule, the rule definitions they depend on are already
flagged for human review at their source (`evaluateControlSequence`, ADR-0023),
and this slice invents no new methodology on top of them.

Deferred (unchanged from ADR-0023, and none of it blocks this read view): the
across-two-levels within-run rules (cross-level 2-2s, R-4s), control-type
distinctions (blank/spike/duplicate vs. level control), configurable rule
selection per service, and a per-point drill-in / annotation UI. The board also
does not yet page or filter — fine at demo scale, worth revisiting once a lab has
many active controls.
