import { analysisServices, controlMaterials, qcMeasurements, worksheets } from "@lims-core/db";
import { asc, count, desc, eq } from "drizzle-orm";
import type { QcVerdict, WestgardRule } from "./qc-control.js";
import type { Querier } from "./qc-gate.js";

// Read-only QC review (ADR-0024): surfaces the frozen control measurements that
// the Westgard evaluation (ADR-0019/0023) already recorded — a lab-wide board of
// active controls and their current state, and the time-ordered series behind a
// Levey-Jennings chart for one control material. No writes, no new verdicts: the
// z-score, verdict, and rule read straight off the append-only qc_measurement rows.

export interface QcControlSummary {
  controlMaterialId: string;
  serviceId: string;
  serviceCode: string;
  serviceName: string;
  level: string;
  lotNumber: string;
  unit: string | null;
  targetMean: string;
  targetSd: string;
  n: number;
  latestVerdict: QcVerdict | null;
  latestRule: WestgardRule | null;
  latestZ: string | null;
  latestAt: string | null;
}

/**
 * The QC review board: every active control material with its current state —
 * measurement count and the latest verdict/rule/z-score. `latest*` are null for a
 * control that has no measurements yet. Lab-wide (controls are not study-scoped,
 * ADR-0019) and ordered by service then level, matching the run's QC picker.
 */
export async function qcReviewSummary(tx: Querier): Promise<QcControlSummary[]> {
  const controls = await tx
    .select({
      controlMaterialId: controlMaterials.id,
      serviceId: controlMaterials.serviceId,
      serviceCode: analysisServices.code,
      serviceName: analysisServices.name,
      level: controlMaterials.level,
      lotNumber: controlMaterials.lotNumber,
      unit: controlMaterials.unit,
      targetMean: controlMaterials.targetMean,
      targetSd: controlMaterials.targetSd,
    })
    .from(controlMaterials)
    .innerJoin(analysisServices, eq(controlMaterials.serviceId, analysisServices.id))
    .where(eq(controlMaterials.active, true))
    .orderBy(analysisServices.code, controlMaterials.level);

  // Latest measurement per control material (DISTINCT ON, newest first) and the
  // per-control count, both keyed on control_material_id for a JS merge.
  const latest = await tx
    .selectDistinctOn([qcMeasurements.controlMaterialId], {
      controlMaterialId: qcMeasurements.controlMaterialId,
      verdict: qcMeasurements.verdict,
      rule: qcMeasurements.rule,
      zScore: qcMeasurements.zScore,
      createdAt: qcMeasurements.createdAt,
    })
    .from(qcMeasurements)
    .orderBy(qcMeasurements.controlMaterialId, desc(qcMeasurements.createdAt));

  const counts = await tx
    .select({ controlMaterialId: qcMeasurements.controlMaterialId, n: count() })
    .from(qcMeasurements)
    .groupBy(qcMeasurements.controlMaterialId);

  const latestBy = new Map(latest.map((r) => [r.controlMaterialId, r]));
  const countBy = new Map(counts.map((r) => [r.controlMaterialId, r.n]));

  return controls.map((c) => {
    const l = latestBy.get(c.controlMaterialId);
    return {
      ...c,
      n: countBy.get(c.controlMaterialId) ?? 0,
      latestVerdict: (l?.verdict as QcVerdict) ?? null,
      latestRule: (l?.rule as WestgardRule | null) ?? null,
      latestZ: l?.zScore ?? null,
      latestAt: l?.createdAt.toISOString() ?? null,
    };
  });
}

export interface ControlSeriesPoint {
  id: string;
  value: string;
  zScore: string;
  verdict: QcVerdict;
  rule: WestgardRule | null;
  worksheetNumber: string;
  createdAt: string;
}

export interface ControlSeries {
  control: {
    id: string;
    serviceCode: string;
    serviceName: string;
    level: string;
    lotNumber: string;
    unit: string | null;
    targetMean: string;
    targetSd: string;
  };
  points: ControlSeriesPoint[];
}

/**
 * The Levey-Jennings series for one control material: its frozen target plus the
 * measurements in chronological order (oldest first, the plotting order). The
 * z-scores are directly comparable because they share the one frozen mean/SD
 * (ADR-0023). Null when the control material does not exist.
 */
export async function controlMaterialSeries(
  tx: Querier,
  controlMaterialId: string,
): Promise<ControlSeries | null> {
  const [control] = await tx
    .select({
      id: controlMaterials.id,
      serviceCode: analysisServices.code,
      serviceName: analysisServices.name,
      level: controlMaterials.level,
      lotNumber: controlMaterials.lotNumber,
      unit: controlMaterials.unit,
      targetMean: controlMaterials.targetMean,
      targetSd: controlMaterials.targetSd,
    })
    .from(controlMaterials)
    .innerJoin(analysisServices, eq(controlMaterials.serviceId, analysisServices.id))
    .where(eq(controlMaterials.id, controlMaterialId))
    .limit(1);
  if (!control) return null;

  const rows = await tx
    .select({
      id: qcMeasurements.id,
      value: qcMeasurements.value,
      zScore: qcMeasurements.zScore,
      verdict: qcMeasurements.verdict,
      rule: qcMeasurements.rule,
      worksheetNumber: worksheets.worksheetNumber,
      createdAt: qcMeasurements.createdAt,
    })
    .from(qcMeasurements)
    .innerJoin(worksheets, eq(qcMeasurements.worksheetId, worksheets.id))
    .where(eq(qcMeasurements.controlMaterialId, controlMaterialId))
    .orderBy(asc(qcMeasurements.createdAt));

  return {
    control,
    points: rows.map((r) => ({
      id: r.id,
      value: r.value,
      zScore: r.zScore,
      verdict: r.verdict as QcVerdict,
      rule: r.rule as WestgardRule | null,
      worksheetNumber: r.worksheetNumber,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
