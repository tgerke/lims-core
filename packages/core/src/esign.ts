import { createHash } from "node:crypto";
import { analysisRequests, signatures } from "@lims-core/db";
import { eq } from "drizzle-orm";
import type { Tx } from "./actor.js";
import { DomainError } from "./errors.js";
import { currentResult } from "./results.js";

/**
 * Canonical content hash a signature binds to (P11-09, §11.70). Computed from
 * the signed result version's identifying fields, so any later change (which
 * can only be a new version — the table is append-only) is detectable: the
 * signature stays bound to exactly what was signed.
 */
export function resultRecordHash(result: {
  requestId: string;
  version: number;
  value: string;
  unit: string | null;
  status: string;
}): string {
  return createHash("sha256")
    .update(
      `${result.requestId}|${result.version}|${result.value}|${result.unit ?? ""}|${result.status}`,
    )
    .digest("hex");
}

export interface SignResultInput {
  requestId: string;
  signerId: string;
  meaning: string;
}

/**
 * Applies an e-signature to the verified result. Callers MUST have already
 * re-authenticated the signer via password step-up (ADR-0003, §11.200(a)) —
 * this function only records the signature.
 */
export async function signResult(tx: Tx, input: SignResultInput) {
  const [request] = await tx
    .select()
    .from(analysisRequests)
    .where(eq(analysisRequests.id, input.requestId))
    .limit(1);
  if (!request) throw new DomainError("analysis request not found", 404);
  if (request.status !== "verified") {
    throw new DomainError(
      `request is ${request.status}; only a verified result can be signed`,
      409,
    );
  }
  const current = await currentResult(tx, input.requestId);
  if (current?.status !== "verified") {
    throw new DomainError("no verified result to sign", 409);
  }
  const [signature] = await tx
    .insert(signatures)
    .values({
      requestId: request.id,
      resultId: current.id,
      studyId: request.studyId,
      signerId: input.signerId,
      meaning: input.meaning,
      recordHash: resultRecordHash(current),
    })
    .returning();
  if (!signature) throw new Error("signature insert returned no row");
  await tx
    .update(analysisRequests)
    .set({ status: "signed", updatedAt: new Date() })
    .where(eq(analysisRequests.id, request.id));
  return signature;
}
