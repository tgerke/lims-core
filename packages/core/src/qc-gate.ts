import {
  controlMaterials,
  type Db,
  qcMeasurements,
  worksheetItems,
  worksheets,
} from "@lims-core/db";
import { desc, eq, sql } from "drizzle-orm";
import type { Tx } from "./actor.js";
import { DomainError } from "./errors.js";

// A read helper may run on the base connection (from a route) or inside a
// transaction (from verify/sign). Both satisfy the same drizzle query surface.
export type Querier = Db | Tx;

export type RunControlStatus = "in_control" | "out_of_control" | "no_qc";

/**
 * The QC control status of a run (ADR-0021): out_of_control if the *latest*
 * measurement of any control material on the run is a `reject` (1-3s). A prior
 * reject that has since been re-run to accept/warning no longer counts — only
 * the current verdict per control governs. `no_qc` when no control was measured.
 */
export async function worksheetControlStatus(
  tx: Querier,
  worksheetId: string,
): Promise<RunControlStatus> {
  // Latest verdict per control material on this run (DISTINCT ON newest first).
  const latest = await tx
    .selectDistinctOn([qcMeasurements.controlMaterialId], {
      verdict: qcMeasurements.verdict,
    })
    .from(qcMeasurements)
    .where(eq(qcMeasurements.worksheetId, worksheetId))
    .orderBy(qcMeasurements.controlMaterialId, desc(qcMeasurements.createdAt));

  if (latest.length === 0) return "no_qc";
  return latest.some((r) => r.verdict === "reject") ? "out_of_control" : "in_control";
}

/**
 * Guards result verification/signing on QC (ADR-0021): if the order sits in any
 * open or completed run whose current QC is out of control, the result may not
 * be advanced until the run is brought back in control by re-running the failing
 * control. A cancelled run does not gate.
 */
export async function assertOrderRunInControl(tx: Querier, requestId: string): Promise<void> {
  const runs = await tx
    .select({ worksheetId: worksheetItems.worksheetId })
    .from(worksheetItems)
    .innerJoin(worksheets, eq(worksheetItems.worksheetId, worksheets.id))
    .where(sql`${worksheetItems.requestId} = ${requestId} and ${worksheets.status} <> 'cancelled'`);
  if (runs.length === 0) return;

  for (const { worksheetId } of runs) {
    if ((await worksheetControlStatus(tx, worksheetId)) === "out_of_control") {
      throw new DomainError(
        "the run's QC is out of control (a control rejected); re-run the failing control before releasing this result",
        409,
      );
    }
  }
}

/**
 * Names the control materials currently rejecting on a run, for surfacing which
 * controls must be re-run. Empty when the run is in control.
 */
export async function rejectingControls(tx: Querier, worksheetId: string) {
  const latest = await tx
    .selectDistinctOn([qcMeasurements.controlMaterialId], {
      controlMaterialId: qcMeasurements.controlMaterialId,
      verdict: qcMeasurements.verdict,
      level: controlMaterials.level,
      lotNumber: controlMaterials.lotNumber,
    })
    .from(qcMeasurements)
    .innerJoin(controlMaterials, eq(qcMeasurements.controlMaterialId, controlMaterials.id))
    .where(eq(qcMeasurements.worksheetId, worksheetId))
    .orderBy(qcMeasurements.controlMaterialId, desc(qcMeasurements.createdAt));
  return latest.filter((r) => r.verdict === "reject");
}
