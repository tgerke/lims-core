import { controlMaterials, qcMeasurements, worksheets } from "@lims-core/db";
import { and, desc, eq } from "drizzle-orm";
import type { Tx } from "./actor.js";
import { DomainError } from "./errors.js";

export type QcVerdict = "accept" | "warning" | "reject";

// An open run can still take QC measurements; a completed/cancelled run is closed.
const OPEN_WORKSHEET_STATUSES = ["draft", "in_progress"];

/**
 * Evaluates a control measurement against its established mean/SD with
 * single-point Westgard rules (ADR-0019): 1-3s (|z| > 3) rejects the run, 1-2s
 * (|z| > 2) is a warning, anything within 2 SD accepts. Returns the z-score and
 * the verdict. Multi-observation rules (2-2s, R-4s, 4-1s, 10-x) are deferred —
 * they need paired or historical control data this function does not see.
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

/**
 * Records a control measurement on a run (ADR-0019): evaluates the value against
 * the control's target with the single-point Westgard rules and appends the
 * measurement with its z-score and verdict frozen. Allowed while the run is open.
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

  const { zScore, verdict } = evaluateControl(
    Number(control.targetMean),
    Number(control.targetSd),
    input.value,
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
      measuredBy: input.actorId,
    })
    .returning();
  if (!row) throw new Error("qc measurement insert returned no row");
  return row;
}
