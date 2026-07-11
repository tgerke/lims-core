import { samples } from "@lims-core/db";
import { eq, sql } from "drizzle-orm";
import type { Tx } from "./actor.js";
import { DomainError } from "./errors.js";

// Freeze-thaw counts and concentration (ADR-0013). Both are operational sample
// attributes; the update is audited by the sample trigger, so there is no
// custody event. A specimen that is gone or held cannot be handled.
const UNHANDLEABLE = new Set(["disposed", "on_hold"]);

async function loadHandleable(tx: Tx, sampleId: string, verb: string) {
  const [sample] = await tx.select().from(samples).where(eq(samples.id, sampleId)).limit(1);
  if (!sample) throw new DomainError("sample not found", 404);
  if (UNHANDLEABLE.has(sample.status)) {
    throw new DomainError(`sample is ${sample.status} and cannot be ${verb}`, 409);
  }
  return sample;
}

/** Records one freeze-thaw cycle by incrementing the count (ADR-0013). */
export async function recordFreezeThaw(tx: Tx, input: { sampleId: string; actorId: string }) {
  await loadHandleable(tx, input.sampleId, "freeze-thawed");
  const [updated] = await tx
    .update(samples)
    .set({ freezeThawCount: sql`${samples.freezeThawCount} + 1`, updatedAt: new Date() })
    .where(eq(samples.id, input.sampleId))
    .returning();
  if (!updated) throw new Error("freeze-thaw update returned no row");
  return updated;
}

/** Sets the measured concentration and its unit (ADR-0013). */
export async function setConcentration(
  tx: Tx,
  input: { sampleId: string; concentration: number; unit?: string; actorId: string },
) {
  await loadHandleable(tx, input.sampleId, "measured");
  const [updated] = await tx
    .update(samples)
    .set({
      concentration: String(input.concentration),
      concentrationUnit: input.unit ?? null,
      updatedAt: new Date(),
    })
    .where(eq(samples.id, input.sampleId))
    .returning();
  if (!updated) throw new Error("concentration update returned no row");
  return updated;
}
