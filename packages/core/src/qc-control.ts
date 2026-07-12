import { controlMaterials, qcMeasurements, worksheets } from "@lims-core/db";
import { and, desc, eq } from "drizzle-orm";
import type { Tx } from "./actor.js";
import { DomainError } from "./errors.js";

export type QcVerdict = "accept" | "warning" | "reject";

export type WestgardRule = "1-2s" | "1-3s" | "2-2s" | "4-1s" | "10-x";

// An open run can still take QC measurements; a completed/cancelled run is closed.
const OPEN_WORKSHEET_STATUSES = ["draft", "in_progress"];

/**
 * Evaluates a single control measurement against its established mean/SD with
 * the single-point Westgard rules (ADR-0019): 1-3s (|z| > 3) rejects, 1-2s
 * (|z| > 2) warns, anything within 2 SD accepts. Returns the z-score and the
 * verdict, considering only this value. The multi-observation rules that look
 * back over prior measurements live in `evaluateControlSequence` (ADR-0023).
 *
 * NOTE FOR HUMAN REVIEW: the 2 SD / 3 SD thresholds are Westgard's published
 * single-rule definitions; verify against an authoritative reference before
 * relying on them clinically (project hard rule on regulatory specifics).
 */
export function evaluateControl(
  mean: number,
  sd: number,
  value: number,
): { zScore: number; verdict: QcVerdict } {
  const zScore = (value - mean) / sd;
  const abs = Math.abs(zScore);
  const verdict: QcVerdict = abs > 3 ? "reject" : abs > 2 ? "warning" : "accept";
  return { zScore, verdict };
}

// The side of the mean a z-score falls on; 0 (exactly at the mean) belongs to
// neither side and so breaks any same-side run.
function side(z: number): 1 | 0 | -1 {
  return z > 0 ? 1 : z < 0 ? -1 : 0;
}

export interface SequenceVerdict {
  zScore: number;
  verdict: QcVerdict;
  rule: WestgardRule | null;
}

/**
 * Evaluates a new control value against the time-ordered sequence of prior
 * measurements of the SAME control material (ADR-0023), layering the sequential
 * multi-observation Westgard rejection rules on top of the single-point rules
 * (ADR-0019). `priorZ` is the z-scores of earlier measurements of this control
 * material, most-recent-first; because the sequence is keyed on one control
 * material (one frozen mean/SD), the z-scores are directly comparable.
 *
 * Rules, most severe first — the first to fire wins:
 *   1-3s  |z| > 3                                          -> reject
 *   2-2s  this + the previous, same side, both |z| > 2     -> reject
 *   4-1s  this + the prior 3 (4 total), same side, |z| > 1 -> reject
 *   10-x  this + the prior 9 (10 total), same side of mean -> reject
 *   1-2s  |z| > 2                                          -> warning
 *   otherwise                                              -> accept
 *
 * A 1-2s excursion is only a warning on its own but is the trigger to inspect
 * the rejection rules, which are checked first so a value that also completes a
 * 2-2s/4-1s run rejects rather than merely warns.
 *
 * NOTE FOR HUMAN REVIEW: these rule names, windows, and thresholds are
 * Westgard's published multirule definitions; verify against an authoritative
 * reference before clinical reliance (project hard rule on regulatory
 * specifics). Only the same-material sequential forms are implemented here — the
 * across-two-levels within-run variants (a cross-level 2-2s and R-4s) are not,
 * because keying the sequence on one control material does not pair two
 * different controls in a run.
 */
export function evaluateControlSequence(
  mean: number,
  sd: number,
  value: number,
  priorZ: number[],
): SequenceVerdict {
  const { zScore } = evaluateControl(mean, sd, value);
  const s = side(zScore);
  // The current value plus history, most-recent-first, so a rule's window is a
  // prefix slice of `seq`.
  const seq = [zScore, ...priorZ];
  const sameSideWindow = (n: number, threshold: number) =>
    s !== 0 &&
    seq.length >= n &&
    seq.slice(0, n).every((z) => side(z) === s && Math.abs(z) > threshold);

  if (Math.abs(zScore) > 3) return { zScore, verdict: "reject", rule: "1-3s" };
  if (sameSideWindow(2, 2)) return { zScore, verdict: "reject", rule: "2-2s" };
  if (sameSideWindow(4, 1)) return { zScore, verdict: "reject", rule: "4-1s" };
  if (s !== 0 && seq.length >= 10 && seq.slice(0, 10).every((z) => side(z) === s)) {
    return { zScore, verdict: "reject", rule: "10-x" };
  }
  if (Math.abs(zScore) > 2) return { zScore, verdict: "warning", rule: "1-2s" };
  return { zScore, verdict: "accept", rule: null };
}

/** The current active control material for a service, or null if none is set. */
export async function activeControlMaterial(tx: Tx, serviceId: string) {
  const [row] = await tx
    .select()
    .from(controlMaterials)
    .where(and(eq(controlMaterials.serviceId, serviceId), eq(controlMaterials.active, true)))
    .orderBy(desc(controlMaterials.effectiveFrom))
    .limit(1);
  return row ?? null;
}

export interface CreateControlMaterialInput {
  serviceId: string;
  level: string;
  lotNumber: string;
  targetMean: number;
  targetSd: number;
  expiry?: string;
  unit?: string;
  actorId: string;
}

/**
 * Sets a service's active control material, superseding any active one (the
 * prior row is deactivated, not edited, so history is retained — a measurement's
 * verdict always traces to the target in force when it was recorded).
 */
export async function createControlMaterial(tx: Tx, input: CreateControlMaterialInput) {
  if (input.targetSd <= 0) throw new DomainError("target SD must be greater than zero");

  await tx
    .update(controlMaterials)
    .set({ active: false })
    .where(and(eq(controlMaterials.serviceId, input.serviceId), eq(controlMaterials.active, true)));

  const [row] = await tx
    .insert(controlMaterials)
    .values({
      serviceId: input.serviceId,
      level: input.level,
      lotNumber: input.lotNumber,
      targetMean: String(input.targetMean),
      targetSd: String(input.targetSd),
      expiry: input.expiry ?? null,
      unit: input.unit ?? null,
      createdBy: input.actorId,
    })
    .returning();
  if (!row) throw new Error("control material insert returned no row");
  return row;
}

export interface RecordQcMeasurementInput {
  worksheetId: string;
  controlMaterialId: string;
  value: number;
  actorId: string;
}

// The longest look-back window any rule needs (10-x). Fetch this many prior
// measurements of the control material to evaluate the sequential rules.
const WESTGARD_WINDOW = 10;

/**
 * Records a control measurement on a run (ADR-0019/0023): evaluates the value
 * against the control's target with the Westgard rules — single-point plus the
 * sequential multi-observation rules over prior measurements of the same control
 * material — and appends the measurement with its z-score, verdict, and the rule
 * that fired frozen on the row. Allowed while the run is open.
 */
export async function recordQcMeasurement(tx: Tx, input: RecordQcMeasurementInput) {
  const [worksheet] = await tx
    .select()
    .from(worksheets)
    .where(eq(worksheets.id, input.worksheetId))
    .limit(1);
  if (!worksheet) throw new DomainError("worksheet not found", 404);
  if (!OPEN_WORKSHEET_STATUSES.includes(worksheet.status)) {
    throw new DomainError(
      `worksheet is ${worksheet.status}; QC can only be recorded while open`,
      409,
    );
  }

  const [control] = await tx
    .select()
    .from(controlMaterials)
    .where(eq(controlMaterials.id, input.controlMaterialId))
    .limit(1);
  if (!control) throw new DomainError("control material not found", 404);

  // Prior measurements of THIS control material, most-recent-first, across runs
  // (ADR-0023): QC performance is a property of the material, not one run.
  const prior = await tx
    .select({ zScore: qcMeasurements.zScore })
    .from(qcMeasurements)
    .where(eq(qcMeasurements.controlMaterialId, control.id))
    .orderBy(desc(qcMeasurements.createdAt))
    .limit(WESTGARD_WINDOW - 1);

  const { zScore, verdict, rule } = evaluateControlSequence(
    Number(control.targetMean),
    Number(control.targetSd),
    input.value,
    prior.map((p) => Number(p.zScore)),
  );

  const [row] = await tx
    .insert(qcMeasurements)
    .values({
      worksheetId: worksheet.id,
      controlMaterialId: control.id,
      studyId: worksheet.studyId,
      value: String(input.value),
      zScore: String(zScore),
      verdict,
      rule,
      measuredBy: input.actorId,
    })
    .returning();
  if (!row) throw new Error("qc measurement insert returned no row");
  return row;
}
