import { createKit, deliverKit, shipKit, withActor } from "@lims-core/core";
import { kitItems, kits, sites, studies } from "@lims-core/db";
import { createKitSchema } from "@lims-core/schemas";
import { asc, desc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { requireAuth, requirePermission } from "../auth/plugin.js";
import { hasPermission, isStudyMember } from "../auth/rbac.js";
import { sendDomainError } from "./helpers.js";

// Collection kits: empty containers assembled centrally and sent out to sites
// (ADR-0011). One kit.manage authority covers the assemble -> ship -> deliver
// lifecycle; kits carry no samples, so there are no custody events.
export const kitRoutes: FastifyPluginAsync = async (app) => {
  app.get("/studies/:studyId/kits", { preHandler: requireAuth }, async (request, reply) => {
    const { studyId } = request.params as { studyId: string };
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });
    if (!user.isSystemAdmin && !(await isStudyMember(app.db, user.id, studyId))) {
      return reply.code(403).send({ error: "not a member of this study" });
    }
    const rows = await app.db
      .select({
        id: kits.id,
        kitNumber: kits.kitNumber,
        status: kits.status,
        destinationSite: sites.oid,
        carrier: kits.carrier,
        trackingNumber: kits.trackingNumber,
        shippedAt: kits.shippedAt,
        deliveredAt: kits.deliveredAt,
        createdAt: kits.createdAt,
      })
      .from(kits)
      .innerJoin(sites, eq(kits.destinationSiteId, sites.id))
      .where(eq(kits.studyId, studyId))
      .orderBy(desc(kits.createdAt));

    // Attach item lists in one follow-up query.
    const kitIds = rows.map((r) => r.id);
    const items =
      kitIds.length === 0
        ? []
        : await app.db
            .select({
              kitId: kitItems.kitId,
              containerType: kitItems.containerType,
              quantity: kitItems.quantity,
            })
            .from(kitItems)
            .orderBy(asc(kitItems.containerType));
    const byKit = new Map<string, { containerType: string; quantity: number }[]>();
    for (const i of items) {
      const list = byKit.get(i.kitId) ?? [];
      list.push({ containerType: i.containerType, quantity: i.quantity });
      byKit.set(i.kitId, list);
    }
    return rows.map((r) => ({ ...r, items: byKit.get(r.id) ?? [] }));
  });

  app.post(
    "/studies/:studyId/kits",
    {
      preHandler: requirePermission("kit.manage", (request) => {
        const { studyId } = request.params as { studyId: string };
        const body = (request.body ?? {}) as { destinationSiteId?: string };
        return { studyId, ...(body.destinationSiteId ? { siteId: body.destinationSiteId } : {}) };
      }),
    },
    async (request, reply) => {
      const { studyId } = request.params as { studyId: string };
      const user = request.user;
      if (!user) return reply.code(401).send({ error: "authentication required" });
      const parsed = createKitSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

      const [study] = await app.db.select().from(studies).where(eq(studies.id, studyId)).limit(1);
      if (!study) return reply.code(404).send({ error: "study not found" });

      try {
        const kit = await withActor(app.db, { userId: user.id, label: user.username }, (tx) =>
          createKit(tx, {
            studyId,
            studyOid: study.oid,
            destinationSiteId: parsed.data.destinationSiteId,
            items: parsed.data.items,
            ...(parsed.data.carrier ? { carrier: parsed.data.carrier } : {}),
            ...(parsed.data.trackingNumber ? { trackingNumber: parsed.data.trackingNumber } : {}),
            ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
            actorId: user.id,
          }),
        );
        return reply.code(201).send(kit);
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );

  const transition = (action: "ship" | "deliver", run: typeof shipKit | typeof deliverKit) => {
    app.post(`/kits/:kitId/${action}`, { preHandler: requireAuth }, async (request, reply) => {
      const { kitId } = request.params as { kitId: string };
      const user = request.user;
      if (!user) return reply.code(401).send({ error: "authentication required" });
      const [kit] = await app.db.select().from(kits).where(eq(kits.id, kitId)).limit(1);
      if (!kit) return reply.code(404).send({ error: "kit not found" });
      const allowed = await hasPermission(app.db, user.id, "kit.manage", { studyId: kit.studyId });
      if (!allowed) return reply.code(403).send({ error: "missing permission: kit.manage" });

      try {
        const updated = await withActor(app.db, { userId: user.id, label: user.username }, (tx) =>
          run(tx, { kitId, actorId: user.id }),
        );
        return updated;
      } catch (err) {
        return sendDomainError(reply, err);
      }
    });
  };
  transition("ship", shipKit);
  transition("deliver", deliverKit);
};
