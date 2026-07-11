import { analysisSpecifications } from "@lims-core/db";
import { and, desc, eq } from "drizzle-orm";
import type { Tx } from "./actor.js";
import { DomainError } from "./errors.js";

export type QcStatus = "pass" | "out_of_spec" | "not_evaluated";

// The fields evaluate() needs; numeric limits arrive as strings from the db.
export interface SpecCriteria {
  lowerLimit: string | null;
  upperLimit: string | null;
  expectedValue: string | null;
}

/**
 * Evaluates a result value against a specification (ADR-0017). A numeric range
 * checks the parsed value against inclusive bounds (either may be open); a
 * qualitative spec matches the expected text case-insensitively. Anything not
 * evaluable — no spec, or a non-numeric value against a numeric range — is
 * `not_evaluated` rather than a failure.
 */
export function evaluate(spec: SpecCriteria | null, value: string): QcStatus {
  if (!spec) return "not_evaluated";

  const hasRange = spec.lowerLimit !== null || spec.upperLimit !== null;
  if (hasRange) {
    const v = Number(value);
    if (value.trim() === "" || Number.isNaN(v)) return "not_evaluated";
    const lower = spec.lowerLimit === null ? null : Number(spec.lowerLimit);
    const upper = spec.upperLimit === null ? null : Number(spec.upperLimit);
    if (lower !== null && v < lower) return "out_of_spec";
    if (upper !== null && v > upper) return "out_of_spec";
    return "pass";
  }

  if (spec.expectedValue !== null) {
    return value.trim().toLowerCase() === spec.expectedValue.trim().toLowerCase()
      ? "pass"
      : "out_of_spec";
  }
  return "not_evaluated";
}

/** The current active specification for a service, or null if none is set. */
export async function activeSpec(tx: Tx, serviceId: string) {
  const [spec] = await tx
    .select()
    .from(analysisSpecifications)
    .where(
      and(eq(analysisSpecifications.serviceId, serviceId), eq(analysisSpecifications.active, true)),
    )
    .orderBy(desc(analysisSpecifications.effectiveFrom))
    .limit(1);
  return spec ?? null;
}

export interface CreateSpecInput {
  serviceId: string;
  unit?: string;
  lowerLimit?: number;
  upperLimit?: number;
  expectedValue?: string;
  actorId: string;
}

/**
 * Sets a service's acceptance criteria, superseding any active spec (the prior
 * row is deactivated, not edited, so history is retained). Requires either a
 * numeric bound or a qualitative expected value, never both.
 */
export async function createSpecification(tx: Tx, input: CreateSpecInput) {
  const hasRange = input.lowerLimit !== undefined || input.upperLimit !== undefined;
  const hasExpected = input.expectedValue !== undefined;
  if (hasRange === hasExpected) {
    throw new DomainError("a specification needs either numeric limits or an expected value");
  }
  if (
    input.lowerLimit !== undefined &&
    input.upperLimit !== undefined &&
    input.lowerLimit > input.upperLimit
  ) {
    throw new DomainError("lower limit cannot exceed upper limit");
  }

  await tx
    .update(analysisSpecifications)
    .set({ active: false })
    .where(
      and(
        eq(analysisSpecifications.serviceId, input.serviceId),
        eq(analysisSpecifications.active, true),
      ),
    );

  const [spec] = await tx
    .insert(analysisSpecifications)
    .values({
      serviceId: input.serviceId,
      unit: input.unit ?? null,
      lowerLimit: input.lowerLimit === undefined ? null : String(input.lowerLimit),
      upperLimit: input.upperLimit === undefined ? null : String(input.upperLimit),
      expectedValue: input.expectedValue ?? null,
      createdBy: input.actorId,
    })
    .returning();
  if (!spec) throw new Error("specification insert returned no row");
  return spec;
}
