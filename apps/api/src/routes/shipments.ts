import { createShipment, receiveShipment, shipShipment, withActor } from "@lims-core/core";
import { samples, shipmentItems, shipments, sites, studies, users } from "@lims-core/db";
import { createShipmentSchema } from "@lims-core/schemas";
import { count, desc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { requireAuth, requirePermission } from "../auth/plugin.js";
import { hasPermission, isStudyMember } from "../auth/rbac.js";
import { sendDomainError } from "./helpers.js";

export const shipmentRoutes: FastifyPluginAsync = async (app) => {
  app.get("/studies/:studyId/shipments", { preHandler: requireAuth }, async (request, reply) => {
    const { studyId } = request.params as { studyId: string };
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });
    if (!user.isSystemAdmin && !(await isStudyMember(app.db, user.id, studyId))) {
      return reply.code(403).send({ error: "not a member of this study" });
    }
    return app.db
      .select({
        id: shipments.id,
        shipmentNumber: shipments.shipmentNumber,
        status: shipments.status,
        destination: shipments.destination,
        originSite: sites.oid,
        carrier: shipments.carrier,
        trackingNumber: shipments.trackingNumber,
        shippedAt: shipments.shippedAt,
        receivedAt: shipments.receivedAt,
        createdAt: shipments.createdAt,
        itemCount: count(shipmentItems.sampleId),
      })
      .from(shipments)
      .leftJoin(sites, eq(shipments.originSiteId, sites.id))
      .leftJoin(shipmentItems, eq(shipmentItems.shipmentId, shipments.id))
      .where(eq(shipments.studyId, studyId))
      .groupBy(shipments.id, sites.oid)
      .orderBy(desc(shipments.createdAt));
  });

  app.post(
    "/studies/:studyId/shipments",
    {
      preHandler: requirePermission("shipment.send", (request) => {
        const { studyId } = request.params as { studyId: string };
        const body = (request.body ?? {}) as { originSiteId?: string };
        return { studyId, ...(body.originSiteId ? { siteId: body.originSiteId } : {}) };
      }),
    },
    async (request, reply) => {
      const { studyId } = request.params as { studyId: string };
      const user = request.user;
      if (!user) return reply.code(401).send({ error: "authentication required" });
      const parsed = createShipmentSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

      const [study] = await app.db.select().from(studies).where(eq(studies.id, studyId)).limit(1);
      if (!study) return reply.code(404).send({ error: "study not found" });
      if (parsed.data.originSiteId) {
        const [site] = await app.db
          .select()
          .from(sites)
          .where(eq(sites.id, parsed.data.originSiteId))
          .limit(1);
        if (!site || site.studyId !== studyId) {
          return reply.code(400).send({ error: "origin site does not belong to this study" });
        }
      }

      try {
        const result = await withActor(app.db, { userId: user.id, label: user.username }, (tx) =>
          createShipment(tx, {
            studyId,
            studyOid: study.oid,
            destination: parsed.data.destination,
            ...(parsed.data.originSiteId ? { originSiteId: parsed.data.originSiteId } : {}),
            ...(parsed.data.carrier ? { carrier: parsed.data.carrier } : {}),
            ...(parsed.data.trackingNumber ? { trackingNumber: parsed.data.trackingNumber } : {}),
            sampleIds: parsed.data.sampleIds,
            actorId: user.id,
          }),
        );
        return reply.code(201).send(result.shipment);
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );

  app.get("/shipments/:shipmentId", { preHandler: requireAuth }, async (request, reply) => {
    const { shipmentId } = request.params as { shipmentId: string };
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });
    const [shipment] = await app.db
      .select()
      .from(shipments)
      .where(eq(shipments.id, shipmentId))
      .limit(1);
    if (!shipment) return reply.code(404).send({ error: "shipment not found" });
    if (!user.isSystemAdmin && !(await isStudyMember(app.db, user.id, shipment.studyId))) {
      return reply.code(403).send({ error: "not a member of this study" });
    }
    const [originSite] = shipment.originSiteId
      ? await app.db.select().from(sites).where(eq(sites.id, shipment.originSiteId)).limit(1)
      : [];
    const [creator] = await app.db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, shipment.createdBy))
      .limit(1);
    const items = await app.db
      .select({
        id: samples.id,
        accessionId: samples.accessionId,
        sampleType: samples.sampleType,
        status: samples.status,
      })
      .from(shipmentItems)
      .innerJoin(samples, eq(shipmentItems.sampleId, samples.id))
      .where(eq(shipmentItems.shipmentId, shipmentId))
      .orderBy(samples.accessionId);
    return {
      ...shipment,
      originSite: originSite ?? null,
      createdBy: creator?.username ?? null,
      items,
    };
  });

  app.post("/shipments/:shipmentId/ship", { preHandler: requireAuth }, async (request, reply) => {
    const { shipmentId } = request.params as { shipmentId: string };
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });
    const [shipment] = await app.db
      .select()
      .from(shipments)
      .where(eq(shipments.id, shipmentId))
      .limit(1);
    if (!shipment) return reply.code(404).send({ error: "shipment not found" });
    const allowed = await hasPermission(app.db, user.id, "shipment.send", {
      studyId: shipment.studyId,
      ...(shipment.originSiteId ? { siteId: shipment.originSiteId } : {}),
    });
    if (!allowed) return reply.code(403).send({ error: "missing permission: shipment.send" });

    try {
      const updated = await withActor(app.db, { userId: user.id, label: user.username }, (tx) =>
        shipShipment(tx, { shipmentId, actorId: user.id }),
      );
      return updated;
    } catch (err) {
      return sendDomainError(reply, err);
    }
  });

  app.post(
    "/shipments/:shipmentId/receive",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { shipmentId } = request.params as { shipmentId: string };
      const user = request.user;
      if (!user) return reply.code(401).send({ error: "authentication required" });
      const [shipment] = await app.db
        .select()
        .from(shipments)
        .where(eq(shipments.id, shipmentId))
        .limit(1);
      if (!shipment) return reply.code(404).send({ error: "shipment not found" });
      const allowed = await hasPermission(app.db, user.id, "shipment.receive", {
        studyId: shipment.studyId,
      });
      if (!allowed) return reply.code(403).send({ error: "missing permission: shipment.receive" });

      try {
        const updated = await withActor(app.db, { userId: user.id, label: user.username }, (tx) =>
          receiveShipment(tx, { shipmentId, actorId: user.id }),
        );
        return updated;
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );
};
