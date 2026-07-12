# ADR-0023: Multi-observation Westgard rules

Status: accepted (2026-07-12)

## Context

The QC first slice (ADR-0019) evaluated each control measurement on its own with
the single-point Westgard rules (1-2s warning, 1-3s reject) and explicitly
deferred the multi-observation rules — 2-2s, R-4s, 4-1s, 10-x — because they
"need paired or historical control data this slice does not model." That data now
exists: `qc_measurement` has been accumulating append-only rows, each with its
z-score and a `created_at`, so the time-ordered sequence of a control material's
measurements is available to look back over. This slice adds the sequential
multi-observation rejection rules on top of the single-point ones.

## Decision

- **The sequence is keyed on `control_material_id`.** All the multi-observation
  rules evaluate the new value against prior measurements of the *same* control
  material, ordered by `created_at` (most-recent-first). Because a control
  material's target mean/SD is frozen and superseded-not-edited (ADR-0019), every
  measurement in a sequence shares one mean/SD, so their z-scores are directly
  comparable. The sequence spans runs — and studies — for that material, because
  QC performance is a property of the analytical system and the material lot, not
  of one worksheet or study.
- **Only the same-material sequential forms are implemented.** Keying on one
  control material deliberately does *not* pair two different controls within a
  run, so the across-two-levels within-run variants — a cross-level 2-2s and R-4s
  (a between-levels range rule) — are not built. Implementing them by applying
  R-4s to one material's consecutive values would be an invented paraphrase of a
  method, which the project hard rule forbids; they stay deferred until a run
  models paired control levels. Built here: **2-2s** (this + the previous, same
  side, both |z| > 2), **4-1s** (this + the prior 3, same side, all |z| > 1), and
  **10-x** (this + the prior 9, all on the same side of the mean).
- **Evaluation stays at entry and frozen, most-severe-first.** A new
  `evaluateControlSequence(mean, sd, value, priorZ)` returns the z-score, verdict,
  and the rule that fired, checking rejection rules before the 1-2s warning so a
  value that completes a 2-2s/4-1s run rejects rather than merely warns.
  `recordQcMeasurement` fetches the prior nine z-scores for the control material
  (the longest window any rule needs is 10-x) and freezes the verdict and rule on
  the appended row. Evaluating only at the newest observation means a later
  measurement never rewrites an earlier `qc_measurement` — the append-only
  guarantee (ADR-0019) is preserved, and a run that goes out of control is a new
  rejecting row, not an edit to an old one.
- **No new column semantics beyond the rule.** `qc_measurement` gains a nullable
  `rule` column (null on accept and on rows recorded before this migration),
  CHECK-constrained to the five rule names. The verdict enum is unchanged, so the
  run-level QC gate (ADR-0021), which keys on the latest `reject` per control,
  now also fires for a multi-observation rejection without any change to the gate.

## Consequences

A run's QC now reflects trends across prior runs of the same control material,
not just each value in isolation, so a slow drift that never trips 1-3s can still
reject via 4-1s or 10-x — and that rejection flows into the existing result-release
gate unchanged. Because the sequence is keyed on the frozen control material and
evaluated only at the newest point, verdicts remain reproducible and prior rows
immutable.

The rule names, windows, and thresholds are Westgard's published multirule
definitions. Per the project hard rule (never write regulatory or methodology
specifics from model memory), they are flagged for human review in the migration,
the schema comment, and `evaluateControlSequence` before clinical reliance. QC
verdicts are a quality control, not a 21 CFR Part 11 requirement, so this slice
adds no traceability requirement ID; the immutability it depends on is the
existing `qc_measurement` append-only trigger (ADR-0019).

Deferred (named so the gap stays explicit): the across-two-levels within-run
rules (cross-level 2-2s and R-4s), which need a run that models paired control
levels; control-type distinctions (blank/spike/duplicate vs. level control);
Levey-Jennings trending and a QC-review UI; and configurable rule selection per
service (the rule set is fixed here).
