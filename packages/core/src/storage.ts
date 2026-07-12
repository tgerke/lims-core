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

/**
 * Ordered free positions in a box (A1..HN minus occupied), for batch placement
 * and capacity checks. Validates the unit is a box with a grid.
 */
export async function freeBoxPositions(tx: Tx, storageUnitId: string): Promise<string[]> {
  const [unit] = await tx
    .select()
    .from(storageUnits)
    .where(eq(storageUnits.id, storageUnitId))
    .limit(1);
  if (!unit) throw new DomainError("storage unit not found", 404);
  if (unit.kind !== "box") throw new DomainError("samples can only be stored in a box");
  if (!unit.gridRows || !unit.gridCols) throw new DomainError("box has no position grid");

  const valid = positionLabels(unit.gridRows, unit.gridCols);
  const occupied = new Set(
    (
      await tx
        .select({ position: samples.storagePosition })
        .from(samples)
        .where(and(eq(samples.storageUnitId, unit.id), isNotNull(samples.storagePosition)))
    ).map((r) => r.position as string),
  );
  return valid.filter((p) => !occupied.has(p));
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
  if (sample.status === "disposed" || sample.status === "depleted" || sample.status === "on_hold") {
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

  // One application-clock timestamp for the sample update and the custody event,
  // so storage_add.occurredAt shares the clock with sample.receivedAt (set the
  // same way in accessionSample). Turnaround reporting subtracts the two; letting
  // the event default to the DB clock instead mixes clocks and yields spurious
  // negative receipt->storage durations under app/DB clock skew.
  const now = new Date();
  const [updated] = await tx
    .update(samples)
    .set({
      storageUnitId: unit.id,
      storagePosition: position,
      status: "in_storage",
      updatedAt: now,
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
    occurredAt: now,
  });
  return updated;
}

export interface MoveInput {
  sampleId: string;
  storageUnitId: string;
  position: string;
  actorId: string;
}

/**
 * Places or relocates a sample to a specific box position for the interactive
 * freezer map (CoC-03). Unlike storeSample (which appends a storage_add), a
 * relocation records a storage_remove at the old cell first, so the custody
 * trail shows the sample leaving one position and arriving at another.
 */
export async function moveSample(tx: Tx, input: MoveInput) {
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
  if (sample.status === "disposed" || sample.status === "depleted" || sample.status === "on_hold") {
    throw new DomainError(`sample is ${sample.status} and cannot be moved`, 409);
  }
  if (unit.studyId && unit.studyId !== sample.studyId) {
    throw new DomainError("storage unit is restricted to a different study", 403);
  }

  const valid = positionLabels(unit.gridRows, unit.gridCols);
  if (!valid.includes(input.position)) {
    throw new DomainError(`position ${input.position} is not in the box grid`);
  }
  const alreadyHere = sample.storageUnitId === unit.id && sample.storagePosition === input.position;
  if (!alreadyHere) {
    const [occupant] = await tx
      .select({ id: samples.id })
      .from(samples)
      .where(and(eq(samples.storageUnitId, unit.id), eq(samples.storagePosition, input.position)))
      .limit(1);
    if (occupant) throw new DomainError(`position ${input.position} is occupied`, 409);
  }

  const wasStored = sample.storageUnitId !== null && sample.storagePosition !== null;
  if (wasStored && !alreadyHere) {
    await recordCustodyEvent(tx, {
      sampleId: sample.id,
      studyId: sample.studyId,
      eventType: "storage_remove",
      actorId: input.actorId,
      storageUnitId: sample.storageUnitId as string,
      position: sample.storagePosition as string,
    });
  }

  const [updated] = await tx
    .update(samples)
    .set({
      storageUnitId: unit.id,
      storagePosition: input.position,
      status: "in_storage",
      updatedAt: new Date(),
    })
    .where(eq(samples.id, sample.id))
    .returning();
  if (!updated) throw new Error("sample move returned no row");

  await recordCustodyEvent(tx, {
    sampleId: sample.id,
    studyId: sample.studyId,
    eventType: "storage_add",
    actorId: input.actorId,
    storageUnitId: unit.id,
    position: input.position,
  });
  return updated;
}
