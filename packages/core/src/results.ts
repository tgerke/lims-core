import { analysisRequests, results } from "@lims-core/db";
import { desc, eq } from "drizzle-orm";
import type { Tx } from "./actor.js";
import { DomainError } from "./errors.js";
import { activeSpec, evaluate } from "./specification.js";

export async function currentResult(tx: Tx, requestId: string) {
  const [row] = await tx
    .select()
    .from(results)
    .where(eq(results.requestId, requestId))
    .orderBy(desc(results.version))
    .limit(1);
  return row ?? null;
}

async function loadRequest(tx: Tx, requestId: string) {
  const [request] = await tx
    .select()
    .from(analysisRequests)
    .where(eq(analysisRequests.id, requestId))
    .limit(1);
  if (!request) throw new DomainError("analysis request not found", 404);
  return request;
}

export interface EnterResultInput {
  requestId: string;
  value: string;
  unit?: string;
  reasonForChange?: string;
  // 'measured' (default) or 'calculated' when computed from a formula (ADR-0020).
  source?: "measured" | "calculated";
  enteredBy: string;
}

/**
 * Appends a result version (P11-02): the first entry is version 1; any
 * correction appends version n+1 and must state a reason for change
 * (§11.10(e) — prior values stay visible, nothing is overwritten).
 */
export async function enterResult(tx: Tx, input: EnterResultInput) {
  const request = await loadRequest(tx, input.requestId);
  if (request.status === "signed" || request.status === "cancelled") {
    throw new DomainError(`request is ${request.status}; result entry is closed`, 409);
  }
  const current = await currentResult(tx, input.requestId);
  if (current && !input.reasonForChange) {
    throw new DomainError("a correction requires a reason for change");
  }
  // QC verdict against the service's active spec at entry time (ADR-0017).
  const spec = await activeSpec(tx, request.serviceId);
  const qcStatus = evaluate(spec, input.value);
  const [row] = await tx
    .insert(results)
    .values({
      requestId: request.id,
      studyId: request.studyId,
      version: (current?.version ?? 0) + 1,
      value: input.value,
      unit: input.unit ?? null,
      status: "entered",
      qcStatus,
      source: input.source ?? "measured",
      reasonForChange: current ? (input.reasonForChange ?? null) : null,
      enteredBy: input.enteredBy,
    })
    .returning();
  if (!row) throw new Error("result insert returned no row");
  await tx
    .update(analysisRequests)
    .set({ status: "resulted", updatedAt: new Date() })
    .where(eq(analysisRequests.id, request.id));
  return row;
}

export interface VerifyResultInput {
  requestId: string;
  verifiedBy: string;
}

/**
 * Second-person verification: appends a 'verified' version restating the
 * current value. The verifier must not be the person who entered it
 * (four-eyes; the point of the verified state).
 */
export async function verifyResult(tx: Tx, input: VerifyResultInput) {
  const request = await loadRequest(tx, input.requestId);
  if (request.status !== "resulted") {
    throw new DomainError(
      `request is ${request.status}; only a resulted request can be verified`,
      409,
    );
  }
  const current = await currentResult(tx, input.requestId);
  if (current?.status !== "entered") {
    throw new DomainError("no entered result to verify", 409);
  }
  if (current.enteredBy === input.verifiedBy) {
    throw new DomainError(
      "results must be verified by someone other than the person who entered them",
      403,
    );
  }
  const [row] = await tx
    .insert(results)
    .values({
      requestId: request.id,
      studyId: request.studyId,
      version: current.version + 1,
      value: current.value,
      unit: current.unit,
      status: "verified",
      qcStatus: current.qcStatus,
      source: current.source,
      reasonForChange: "verification",
      enteredBy: input.verifiedBy,
    })
    .returning();
  if (!row) throw new Error("result insert returned no row");
  await tx
    .update(analysisRequests)
    .set({ status: "verified", updatedAt: new Date() })
    .where(eq(analysisRequests.id, request.id));
  return row;
}
