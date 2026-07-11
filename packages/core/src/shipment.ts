import { samples, shipmentCounters, shipmentItems, shipments } from "@lims-core/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Tx } from "./actor.js";
import { recordCustodyEvent } from "./custody.js";
import { DomainError } from "./errors.js";

/** `STUDY-001-SHP-00042`: sanitized study OID + zero-padded per-study number. */
export function formatShipmentNumber(studyOid: string, sequence: number): string {
  const prefix = studyOid
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${prefix}-SHP-${String(sequence).padStart(5, "0")}`;
}

// A sample can be packed only when it is available to move; in transit,
// depleted, disposed, or held samples cannot be added.
const SHIPPABLE_STATUSES = new Set(["registered", "in_storage", "in_testing"]);

export interface CreateShipmentInput {
  studyId: string;
  studyOid: string;
  destination: string;
  originSiteId?: string;
  carrier?: string;
  trackingNumber?: string;
  sampleIds: string[];
  actorId: string;
}

/**
 * Packs a shipment (CoC-06): allocates the next per-study shipment number,
 * creates the shipment in `packed` state, and records its members. Rejects
 * samples that are not in the study, not shippable, or already in an open
 * shipment. No custody events yet — custody moves at ship/receive.
 */
export async function createShipment(tx: Tx, input: CreateShipmentInput) {
  const ids = [...new Set(input.sampleIds)];
  if (ids.length === 0) throw new DomainError("a shipment needs at least one sample");

  const rows = await tx.select().from(samples).where(inArray(samples.id, ids));
  if (rows.length !== ids.length) throw new DomainError("one or more samples not found", 404);
  for (const s of rows) {
    if (s.studyId !== input.studyId) {
      throw new DomainError(`sample ${s.accessionId} is not in this study`, 400);
    }
    if (!SHIPPABLE_STATUSES.has(s.status)) {
      throw new DomainError(`sample ${s.accessionId} is ${s.status} and cannot be shipped`, 409);
    }
  }

  const open = await tx
    .select({ sampleId: shipmentItems.sampleId })
    .from(shipmentItems)
    .innerJoin(shipments, eq(shipmentItems.shipmentId, shipments.id))
    .where(
      and(
        inArray(shipmentItems.sampleId, ids),
        inArray(shipments.status, ["packed", "in_transit"]),
      ),
    );
  if (open.length > 0) {
    throw new DomainError("one or more samples are already in an open shipment", 409);
  }

  const [counter] = await tx
    .insert(shipmentCounters)
    .values({ studyId: input.studyId, lastValue: 1 })
    .onConflictDoUpdate({
      target: shipmentCounters.studyId,
      set: { lastValue: sql`${shipmentCounters.lastValue} + 1` },
    })
    .returning({ lastValue: shipmentCounters.lastValue });
  if (!counter) throw new Error("shipment counter returned no row");

  const [shipment] = await tx
    .insert(shipments)
    .values({
      studyId: input.studyId,
      shipmentNumber: formatShipmentNumber(input.studyOid, counter.lastValue),
      originSiteId: input.originSiteId ?? null,
      destination: input.destination,
      carrier: input.carrier ?? null,
      trackingNumber: input.trackingNumber ?? null,
      createdBy: input.actorId,
    })
    .returning();
  if (!shipment) throw new Error("shipment insert returned no row");

  await tx
    .insert(shipmentItems)
    .values(ids.map((sampleId) => ({ shipmentId: shipment.id, sampleId, studyId: input.studyId })));

  return { shipment, sampleIds: ids };
}

async function loadShipment(tx: Tx, shipmentId: string) {
  const [shipment] = await tx.select().from(shipments).where(eq(shipments.id, shipmentId)).limit(1);
  if (!shipment) throw new DomainError("shipment not found", 404);
  return shipment;
}

function itemSampleIds(tx: Tx, shipmentId: string) {
  return tx
    .select({ sampleId: shipmentItems.sampleId })
    .from(shipmentItems)
    .where(eq(shipmentItems.shipmentId, shipmentId));
}

/**
 * Dispatches a packed shipment (CoC-06): marks it in_transit, and for each
 * sample records a `transfer` custody event (departure) and moves it out of
 * storage into the in_transit state.
 */
export async function shipShipment(tx: Tx, input: { shipmentId: string; actorId: string }) {
  const shipment = await loadShipment(tx, input.shipmentId);
  if (shipment.status !== "packed") {
    throw new DomainError(`shipment is ${shipment.status}; only a packed shipment can ship`, 409);
  }
  const items = await itemSampleIds(tx, shipment.id);
  if (items.length === 0) throw new DomainError("shipment has no samples", 409);

  const now = new Date();
  const [updated] = await tx
    .update(shipments)
    .set({ status: "in_transit", shippedAt: now, updatedAt: now })
    .where(eq(shipments.id, shipment.id))
    .returning();

  for (const { sampleId } of items) {
    await tx
      .update(samples)
      .set({ status: "in_transit", storageUnitId: null, storagePosition: null, updatedAt: now })
      .where(eq(samples.id, sampleId));
    await recordCustodyEvent(tx, {
      sampleId,
      studyId: shipment.studyId,
      eventType: "transfer",
      actorId: input.actorId,
      occurredAt: now,
      details: {
        phase: "shipped",
        shipmentId: shipment.id,
        shipmentNumber: shipment.shipmentNumber,
        destination: shipment.destination,
        ...(shipment.carrier ? { carrier: shipment.carrier } : {}),
      },
    });
  }
  return updated ?? shipment;
}

/**
 * Receives an in-transit shipment (CoC-06): marks it received, and for each
 * sample records a `transfer` custody event (arrival) and returns it to the
 * registered state, ready to be stored at the destination.
 */
export async function receiveShipment(tx: Tx, input: { shipmentId: string; actorId: string }) {
  const shipment = await loadShipment(tx, input.shipmentId);
  if (shipment.status !== "in_transit") {
    throw new DomainError(
      `shipment is ${shipment.status}; only an in-transit shipment can be received`,
      409,
    );
  }
  const items = await itemSampleIds(tx, shipment.id);

  const now = new Date();
  const [updated] = await tx
    .update(shipments)
    .set({ status: "received", receivedAt: now, updatedAt: now })
    .where(eq(shipments.id, shipment.id))
    .returning();

  for (const { sampleId } of items) {
    await tx
      .update(samples)
      .set({ status: "registered", updatedAt: now })
      .where(eq(samples.id, sampleId));
    await recordCustodyEvent(tx, {
      sampleId,
      studyId: shipment.studyId,
      eventType: "transfer",
      actorId: input.actorId,
      occurredAt: now,
      details: {
        phase: "received",
        shipmentId: shipment.id,
        shipmentNumber: shipment.shipmentNumber,
        destination: shipment.destination,
      },
    });
  }
  return updated ?? shipment;
}
