import { inventoryItems, inventoryLots, inventoryTransactions } from "@lims-core/db";
import { eq } from "drizzle-orm";
import type { Tx } from "./actor.js";
import { DomainError } from "./errors.js";

/** Today as an ISO date (YYYY-MM-DD), matching the `date` column encoding. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export interface CreateItemInput {
  name: string;
  catalogNumber?: string;
  vendor?: string;
  category?: string;
  unit: string;
  actorId: string;
}

/** Catalogs a reagent/consumable (ADR-0016). Runs inside withActor. */
export async function createItem(tx: Tx, input: CreateItemInput) {
  const [item] = await tx
    .insert(inventoryItems)
    .values({
      name: input.name,
      catalogNumber: input.catalogNumber ?? null,
      vendor: input.vendor ?? null,
      ...(input.category ? { category: input.category } : {}),
      unit: input.unit,
      createdBy: input.actorId,
    })
    .returning();
  if (!item) throw new Error("inventory item insert returned no row");
  return item;
}

export interface ReceiveLotInput {
  itemId: string;
  lotNumber: string;
  quantity: number;
  expiryDate?: string;
  receivedDate?: string;
  storageUnitId?: string;
  notes?: string;
  actorId: string;
}

/**
 * Receives a lot of an item: creates it `available`, records a `received`
 * ledger entry, and sets quantity_remaining to the received amount.
 */
export async function receiveLot(tx: Tx, input: ReceiveLotInput) {
  if (input.quantity <= 0) throw new DomainError("received quantity must be positive");
  const [item] = await tx
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, input.itemId))
    .limit(1);
  if (!item) throw new DomainError("inventory item not found", 404);

  const [lot] = await tx
    .insert(inventoryLots)
    .values({
      itemId: input.itemId,
      lotNumber: input.lotNumber,
      expiryDate: input.expiryDate ?? null,
      receivedDate: input.receivedDate ?? today(),
      quantityReceived: String(input.quantity),
      quantityRemaining: String(input.quantity),
      storageUnitId: input.storageUnitId ?? null,
      notes: input.notes ?? null,
      receivedBy: input.actorId,
    })
    .returning();
  if (!lot) throw new Error("inventory lot insert returned no row");

  await tx.insert(inventoryTransactions).values({
    lotId: lot.id,
    delta: String(input.quantity),
    reason: "received",
    performedBy: input.actorId,
  });
  return lot;
}

async function loadLot(tx: Tx, lotId: string) {
  const [lot] = await tx.select().from(inventoryLots).where(eq(inventoryLots.id, lotId)).limit(1);
  if (!lot) throw new DomainError("inventory lot not found", 404);
  return lot;
}

export interface ConsumeLotInput {
  lotId: string;
  quantity: number;
  note?: string;
  actorId: string;
}

/**
 * Draws `quantity` from an available lot: appends a `consumed` ledger entry,
 * decrements quantity_remaining, and marks the lot `depleted` at zero. Rejects
 * an expired, quarantined, or already-closed lot, and an over-draw.
 */
export async function consumeLot(tx: Tx, input: ConsumeLotInput) {
  if (input.quantity <= 0) throw new DomainError("consumed quantity must be positive");
  const lot = await loadLot(tx, input.lotId);
  if (lot.status !== "available") {
    throw new DomainError(`lot is ${lot.status}; only an available lot can be consumed`, 409);
  }
  if (lot.expiryDate && lot.expiryDate < today()) {
    throw new DomainError(`lot expired on ${lot.expiryDate} and cannot be consumed`, 409);
  }
  const remaining = Number(lot.quantityRemaining);
  if (input.quantity > remaining) {
    throw new DomainError(`consumption draws ${input.quantity} but only ${remaining} remain`, 409);
  }
  const newRemaining = remaining - input.quantity;

  await tx.insert(inventoryTransactions).values({
    lotId: lot.id,
    delta: String(-input.quantity),
    reason: "consumed",
    note: input.note ?? null,
    performedBy: input.actorId,
  });
  const [updated] = await tx
    .update(inventoryLots)
    .set({
      quantityRemaining: String(newRemaining),
      status: newRemaining === 0 ? "depleted" : lot.status,
      updatedAt: new Date(),
    })
    .where(eq(inventoryLots.id, lot.id))
    .returning();
  return updated ?? lot;
}

export interface AdjustLotInput {
  lotId: string;
  delta: number;
  note?: string;
  actorId: string;
}

/**
 * Corrects on-hand quantity (a recount): appends an `adjusted` ledger entry
 * with the signed delta and moves quantity_remaining, refusing to go negative.
 */
export async function adjustLot(tx: Tx, input: AdjustLotInput) {
  if (input.delta === 0) throw new DomainError("adjustment delta must be non-zero");
  const lot = await loadLot(tx, input.lotId);
  if (lot.status === "discarded") {
    throw new DomainError("lot is discarded and cannot be adjusted", 409);
  }
  const newRemaining = Number(lot.quantityRemaining) + input.delta;
  if (newRemaining < 0) throw new DomainError("adjustment would drive quantity below zero", 409);

  await tx.insert(inventoryTransactions).values({
    lotId: lot.id,
    delta: String(input.delta),
    reason: "adjusted",
    note: input.note ?? null,
    performedBy: input.actorId,
  });
  const [updated] = await tx
    .update(inventoryLots)
    .set({
      quantityRemaining: String(newRemaining),
      status: newRemaining === 0 && lot.status === "available" ? "depleted" : lot.status,
      updatedAt: new Date(),
    })
    .where(eq(inventoryLots.id, lot.id))
    .returning();
  return updated ?? lot;
}

export interface DiscardLotInput {
  lotId: string;
  note?: string;
  actorId: string;
}

/** Discards a lot (contamination, expiry): terminal, writes off the remainder. */
export async function discardLot(tx: Tx, input: DiscardLotInput) {
  const lot = await loadLot(tx, input.lotId);
  if (lot.status === "discarded") throw new DomainError("lot is already discarded", 409);
  const remaining = Number(lot.quantityRemaining);

  if (remaining > 0) {
    await tx.insert(inventoryTransactions).values({
      lotId: lot.id,
      delta: String(-remaining),
      reason: "discarded",
      note: input.note ?? null,
      performedBy: input.actorId,
    });
  }
  const [updated] = await tx
    .update(inventoryLots)
    .set({ quantityRemaining: "0", status: "discarded", updatedAt: new Date() })
    .where(eq(inventoryLots.id, lot.id))
    .returning();
  return updated ?? lot;
}
