-- Multi-observation Westgard rules (ADR-0023): the QC first slice (ADR-0019)
-- evaluated each control value on its own with the single-point rules (1-2s /
-- 1-3s). This slice adds the sequential multi-observation rejection rules that
-- look back over prior measurements of the SAME control material, ordered in
-- time: 2-2s, 4-1s, and 10-x. The sequence is keyed on control_material_id
-- (same level + lot), so every measurement in a run shares one frozen mean/SD
-- and the z-scores are directly comparable. Logic lives in
-- packages/core/src/qc-control.ts (evaluateControlSequence).
--
-- NOTE FOR HUMAN REVIEW: the rule names and definitions below are Westgard's
-- published multirule definitions. Verify each against an authoritative Westgard
-- reference before relying on them clinically (project hard rule on regulatory
-- specifics). The across-two-levels within-run variants (a 2-2s spanning two
-- control levels, and R-4s, a between-levels range rule) are deliberately NOT
-- implemented: keying the sequence on one control material does not pair two
-- different controls in a run, so those remain deferred rather than invented.

-- Which Westgard rule produced the frozen verdict. NULL for an accept (no rule
-- fired) and for measurements recorded before this migration. Append-only like
-- the row it sits on, so a recorded rule cannot be rewritten.
ALTER TABLE qc_measurement
  ADD COLUMN rule text CHECK (rule IN ('1-2s', '1-3s', '2-2s', '4-1s', '10-x'));
--> statement-breakpoint
COMMENT ON COLUMN qc_measurement.rule IS
  'The Westgard rule that produced the verdict at entry: 1-2s (warning), 1-3s / 2-2s / 4-1s / 10-x (reject), NULL on accept (ADR-0023).';
