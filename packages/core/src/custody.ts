import { custodyEvents } from "@lims-core/db";
import type { Tx } from "./actor.js";

export type CustodyEventType =
  | "collection"
  | "receipt"
  | "storage_add"
  | "storage_remove"
  | "transfer"
  | "aliquot"
  | "hold"
  | "hold_release"
  | "disposal";

export interface CustodyEventInput {
  sampleId: string;
  studyId: string;
  eventType: CustodyEventType;
  actorId?: string;
  occurredAt?: Date;
  storageUnitId?: string;
  position?: string;
  details?: Record<string, unknown>;
}

/**
 * Appends one chain-of-custody row (CoC-01). The table is append-only by
 * trigger; corrections are new events, never edits.
 */
export async function recordCustodyEvent(tx: Tx, input: CustodyEventInput) {
  const [row] = await tx
    .insert(custodyEvents)
    .values({
      sampleId: input.sampleId,
      studyId: input.studyId,
      eventType: input.eventType,
      actorId: input.actorId ?? null,
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
      storageUnitId: input.storageUnitId ?? null,
      position: input.position ?? null,
      details: input.details ?? null,
    })
    .returning();
  if (!row) throw new Error("custody event insert returned no row");
  return row;
}
