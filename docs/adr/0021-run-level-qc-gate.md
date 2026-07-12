# ADR-0021: Run-level QC gate

Status: accepted (2026-07-11)

## Context

ADR-0019 records QC control measurements on a run and computes a single-point
Westgard verdict, but nothing yet *acts* on a reject — a technician could record
an out-of-control control and still release the patient results on that run.
Blocking that is the clinical point of running controls. This slice adds the
run-level gate ADR-0019 named as deferred.

## Decision

- **A run is out of control when the latest measurement of any of its controls
  is a reject.** `worksheetControlStatus` takes the most recent measurement per
  control material on the run (DISTINCT ON, newest first) and returns
  `out_of_control` if any is `reject` (1-3s), else `in_control`, or `no_qc` when
  none was measured. Only the *current* verdict per control governs: a control
  that rejected and was then re-run within limits no longer gates. A `warning`
  (1-2s) does not gate — it is advisory, per Westgard.
- **The gate is enforced in the domain layer, on release.** `verifyResult` and
  `signResult` call `assertOrderRunInControl`, which finds the (non-cancelled)
  runs the order sits in and throws `409` if any is out of control. Enforcing it
  in the core functions — not the routes — means every path that releases a
  result is gated, and the append-only result/signature tables never receive a
  release the QC should have stopped. Entering or correcting a result is *not*
  gated; only advancing it to verified/signed.
- **Resolution is re-running the control, not an override.** Because the latest
  verdict governs, a lab brings a run back in control by recording a passing
  measurement of the failing control — the normal corrective action. A
  supervisory override path is deliberately not built in this slice.

## Consequences

QC now has teeth: an out-of-control run holds its results at the bench until the
control is re-run within limits, and the hold is enforced wherever results are
released, not just in the UI. The worksheet detail surfaces the run's
`controlStatus` so the block is explained rather than mysterious.

Deferred (named so the gap stays explicit): a supervisory override to release
over a failing control with a logged reason (some labs need this for documented
dispositions); gating on stale QC (a run whose controls were never measured, or
measured too long ago, still releases — `no_qc` does not gate); per-analyte
gating (today any rejecting control on the run gates every order on it, not only
orders for that control's service); and blocking new result entry, not just
release.
