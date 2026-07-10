import { storeSample, withActor } from "@lims-core/core";
import { samples } from "@lims-core/db";
import { storeRequestSchema } from "@lims-core/schemas";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { hasPermission } from "../auth/rbac.js";
import { sendDomainError } from "./helpers.js";

export const storageRoutes: FastifyPluginAsync = async (app) => {
  app.post("/samples/:sampleId/store", async (request, reply) => {
    const { sampleId } = request.params as { sampleId: string };
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });
    const parsed = storeRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    // Scope comes from the sample itself, so the permission check happens
    // after the row is loaded (site-scoped grants apply at the sample's site).
    const [sample] = await app.db.select().from(samples).where(eq(samples.id, sampleId)).limit(1);
    if (!sample) return reply.code(404).send({ error: "sample not found" });
    const allowed = await hasPermission(app.db, user.id, "sample.store", {
      studyId: sample.studyId,
      siteId: sample.siteId,
    });
    if (!allowed) return reply.code(403).send({ error: "missing permission: sample.store" });

    try {
      const updated = await withActor(app.db, { userId: user.id, label: user.username }, (tx) =>
        storeSample(tx, {
          sampleId,
          storageUnitId: parsed.data.storageUnitId,
          ...(parsed.data.position ? { position: parsed.data.position } : {}),
          actorId: user.id,
        }),
      );
      return updated;
    } catch (err) {
      return sendDomainError(reply, err);
    }
  });
};
