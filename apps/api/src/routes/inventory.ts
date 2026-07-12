import {
  adjustLot,
  consumeLot,
  createItem,
  discardLot,
  receiveLot,
  withActor,
} from "@lims-core/core";
import { inventoryItems, inventoryLots } from "@lims-core/db";
import {
  adjustLotSchema,
  consumeLotSchema,
  createItemSchema,
  discardLotSchema,
  receiveLotSchema,
} from "@lims-core/schemas";
import { asc, desc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { requireAuth, requirePermissionAnywhere } from "../auth/plugin.js";
import { sendDomainError } from "./helpers.js";

// Reagent/consumable inventory (ADR-0016). Lab-wide, not study-scoped: paths are
// /inventory/* rather than /studies/:studyId/*, writes authorized on holding
// inventory.manage in any study, and writes audit to the `global` chain.
export const inventoryRoutes: FastifyPluginAsync = async (app) => {
  const canManage = requirePermissionAnywhere("inventory.manage");

  app.get("/inventory/items", { preHandler: requireAuth }, async () => {
    return app.db
      .select()
      .from(inventoryItems)
      .orderBy(asc(inventoryItems.name), asc(inventoryItems.createdAt));
  });

  app.post("/inventory/items", { preHandler: canManage }, async (request, reply) => {
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });
    const parsed = createItemSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const item = await withActor(app.db, { userId: user.id, label: user.username }, (tx) =>
        createItem(tx, {
          name: parsed.data.name,
          unit: parsed.data.unit,
          ...(parsed.data.catalogNumber ? { catalogNumber: parsed.data.catalogNumber } : {}),
          ...(parsed.data.vendor ? { vendor: parsed.data.vendor } : {}),
          ...(parsed.data.category ? { category: parsed.data.category } : {}),
          actorId: user.id,
        }),
      );
      return reply.code(201).send(item);
    } catch (err) {
      return sendDomainError(reply, err);
    }
  });

  app.get("/inventory/lots", { preHandler: requireAuth }, async () => {
    return app.db
      .select({
        id: inventoryLots.id,
        itemId: inventoryLots.itemId,
        itemName: inventoryItems.name,
        itemUnit: inventoryItems.unit,
        category: inventoryItems.category,
        lotNumber: inventoryLots.lotNumber,
        expiryDate: inventoryLots.expiryDate,
        receivedDate: inventoryLots.receivedDate,
        quantityReceived: inventoryLots.quantityReceived,
        quantityRemaining: inventoryLots.quantityRemaining,
        status: inventoryLots.status,
        notes: inventoryLots.notes,
        createdAt: inventoryLots.createdAt,
      })
      .from(inventoryLots)
      .innerJoin(inventoryItems, eq(inventoryLots.itemId, inventoryItems.id))
      .orderBy(desc(inventoryLots.createdAt));
  });

  app.post("/inventory/lots", { preHandler: canManage }, async (request, reply) => {
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });
    const parsed = receiveLotSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const lot = await withActor(app.db, { userId: user.id, label: user.username }, (tx) =>
        receiveLot(tx, {
          itemId: parsed.data.itemId,
          lotNumber: parsed.data.lotNumber,
          quantity: parsed.data.quantity,
          ...(parsed.data.expiryDate ? { expiryDate: parsed.data.expiryDate } : {}),
          ...(parsed.data.receivedDate ? { receivedDate: parsed.data.receivedDate } : {}),
          ...(parsed.data.storageUnitId ? { storageUnitId: parsed.data.storageUnitId } : {}),
          ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
          actorId: user.id,
        }),
      );
      return reply.code(201).send(lot);
    } catch (err) {
      return sendDomainError(reply, err);
    }
  });

  app.post("/inventory/lots/:lotId/consume", { preHandler: canManage }, async (request, reply) => {
    const { lotId } = request.params as { lotId: string };
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });
    const parsed = consumeLotSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const result = await withActor(app.db, { userId: user.id, label: user.username }, (tx) =>
        consumeLot(tx, {
          lotId,
          quantity: parsed.data.quantity,
          ...(parsed.data.note ? { note: parsed.data.note } : {}),
          actorId: user.id,
        }),
      );
      return result.lot;
    } catch (err) {
      return sendDomainError(reply, err);
    }
  });

  app.post("/inventory/lots/:lotId/adjust", { preHandler: canManage }, async (request, reply) => {
    const { lotId } = request.params as { lotId: string };
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });
    const parsed = adjustLotSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const lot = await withActor(app.db, { userId: user.id, label: user.username }, (tx) =>
        adjustLot(tx, {
          lotId,
          delta: parsed.data.delta,
          ...(parsed.data.note ? { note: parsed.data.note } : {}),
          actorId: user.id,
        }),
      );
      return lot;
    } catch (err) {
      return sendDomainError(reply, err);
    }
  });

  app.post("/inventory/lots/:lotId/discard", { preHandler: canManage }, async (request, reply) => {
    const { lotId } = request.params as { lotId: string };
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });
    const parsed = discardLotSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    try {
      const lot = await withActor(app.db, { userId: user.id, label: user.username }, (tx) =>
        discardLot(tx, {
          lotId,
          ...(parsed.data.note ? { note: parsed.data.note } : {}),
          actorId: user.id,
        }),
      );
      return lot;
    } catch (err) {
      return sendDomainError(reply, err);
    }
  });
};
