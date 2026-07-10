import { samples, storageUnits } from "@lims-core/db";
import { and, eq, isNotNull } from "drizzle-orm";
import type { Tx } from "./actor.js";
import { recordCustodyEvent } from "./custody.js";
import { DomainError } from "./errors.js";

/** A1..H12-style grid labels: rows letter, columns 1-based. */
export function positionLabels(gridRows: number, gridCols: number): string[] {
  const labels: string[] = [];
  for (let r = 0; r < gridRows; r++) {
    const letter = String.fromCharCode(65 + r);
    for (let c = 1; c <= gridCols; c++) labels.push(`${letter}${c}`);
  }
  return labels;
}

export interface StoreInput {
  sampleId: string;
  storageUnitId: string;
  /** Omit to auto-allocate the first free position. */
  position?: string;
  actorId: string;
}

/**
 * Places a sample into a box position and records the location change as a
 * custody event (CoC-03). Position uniqueness is ultimately enforced by the
 * partial unique index on sample — a concurrent double-allocation fails at
 * commit rather than corrupting custody.
 */
export async function storeSample(tx: Tx, input: StoreInput) {
  const [unit] = await tx
    .select()
    .from(storageUnits)
    .where(eq(storageUnits.id, input.storageUnitId))
    .limit(1);
  if (!unit) throw new DomainError("storage unit not found", 404);
  if (unit.kind !== "box") throw new DomainError("samples can only be stored in a box");
  if (!unit.gridRows || !unit.gridCols) throw new DomainError("box has no position grid");

  const [sample] = await tx.select().from(samples).where(eq(samples.id, input.sampleId)).limit(1);
  if (!sample) throw new DomainError("sample not found", 404);
  if (sample.status === "disposed" || sample.status === "depleted") {
    throw new DomainError(`sample is ${sample.status} and cannot be stored`, 409);
  }
  if (unit.studyId && unit.studyId !== sample.studyId) {
    throw new DomainError("storage unit is restricted to a different study", 403);
  }

  const valid = positionLabels(unit.gridRows, unit.gridCols);
  const occupied = new Set(
    (
      await tx
        .select({ position: samples.storagePosition })
        .from(samples)
        .where(and(eq(samples.storageUnitId, unit.id), isNotNull(samples.storagePosition)))
    ).map((r) => r.position as string),
  );

  let position = input.position;
  if (position) {
    if (!valid.includes(position))
      throw new DomainError(`position ${position} is not in the box grid`);
    if (occupied.has(position)) throw new DomainError(`position ${position} is occupied`, 409);
  } else {
    position = valid.find((p) => !occupied.has(p));
    if (!position) throw new DomainError("box is full", 409);
  }

  const [updated] = await tx
    .update(samples)
    .set({
      storageUnitId: unit.id,
      storagePosition: position,
      status: "in_storage",
      updatedAt: new Date(),
    })
    .where(eq(samples.id, sample.id))
    .returning();
  if (!updated) throw new Error("sample update returned no row");

  await recordCustodyEvent(tx, {
    sampleId: sample.id,
    studyId: sample.studyId,
    eventType: "storage_add",
    actorId: input.actorId,
    storageUnitId: unit.id,
    position,
  });
  return updated;
}
