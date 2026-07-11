import { disposeSamples, placeHold, releaseHold, withActor } from "@lims-core/core";
import { studies } from "@lims-core/db";
import { disposeRequestSchema, holdRequestSchema } from "@lims-core/schemas";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { requirePermission } from "../auth/plugin.js";
import { sendDomainError } from "./helpers.js";

// Consent-withdrawal holds and disposal (CoC-05). Study-scoped because a subject
// hold can span sites; the permission check is at study level. hold/release need
// sample.hold; disposal is the terminal step and needs sample.dispose.
export const holdRoutes: FastifyPluginAsync = async (app) => {
  const studyScope = (request: FastifyRequest) => {
    const { studyId } = request.params as { studyId: string };
    return { studyId };
  };

  app.post(
    "/studies/:studyId/holds",
    { preHandler: requirePermission("sample.hold", studyScope) },
    async (request, reply) => {
      const { studyId } = request.params as { studyId: string };
      const user = request.user;
      if (!user) return reply.code(401).send({ error: "authentication required" });
      const parsed = holdRequestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

      const [study] = await app.db.select().from(studies).where(eq(studies.id, studyId)).limit(1);
      if (!study) return reply.code(404).send({ error: "study not found" });

      try {
        const held = await withActor(app.db, { userId: user.id, label: user.username }, (tx) =>
          placeHold(tx, {
            studyId,
            reason: parsed.data.reason,
            ...(parsed.data.sampleId ? { sampleId: parsed.data.sampleId } : {}),
            ...(parsed.data.subjectKey ? { subjectKey: parsed.data.subjectKey } : {}),
            actorId: user.id,
          }),
        );
        return reply.code(201).send({ count: held.length, samples: held });
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );

  app.post(
    "/studies/:studyId/holds/release",
    { preHandler: requirePermission("sample.hold", studyScope) },
    async (request, reply) => {
      const { studyId } = request.params as { studyId: string };
      const user = request.user;
      if (!user) return reply.code(401).send({ error: "authentication required" });
      const parsed = holdRequestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

      const [study] = await app.db.select().from(studies).where(eq(studies.id, studyId)).limit(1);
      if (!study) return reply.code(404).send({ error: "study not found" });

      try {
        const released = await withActor(app.db, { userId: user.id, label: user.username }, (tx) =>
          releaseHold(tx, {
            studyId,
            reason: parsed.data.reason,
            ...(parsed.data.sampleId ? { sampleId: parsed.data.sampleId } : {}),
            ...(parsed.data.subjectKey ? { subjectKey: parsed.data.subjectKey } : {}),
            actorId: user.id,
          }),
        );
        return { count: released.length, samples: released };
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );

  app.post(
    "/studies/:studyId/disposals",
    { preHandler: requirePermission("sample.dispose", studyScope) },
    async (request, reply) => {
      const { studyId } = request.params as { studyId: string };
      const user = request.user;
      if (!user) return reply.code(401).send({ error: "authentication required" });
      const parsed = disposeRequestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

      const [study] = await app.db.select().from(studies).where(eq(studies.id, studyId)).limit(1);
      if (!study) return reply.code(404).send({ error: "study not found" });

      try {
        const disposed = await withActor(app.db, { userId: user.id, label: user.username }, (tx) =>
          disposeSamples(tx, {
            studyId,
            reason: parsed.data.reason,
            ...(parsed.data.method ? { method: parsed.data.method } : {}),
            ...(parsed.data.sampleId ? { sampleId: parsed.data.sampleId } : {}),
            ...(parsed.data.subjectKey ? { subjectKey: parsed.data.subjectKey } : {}),
            actorId: user.id,
          }),
        );
        return reply.code(201).send({ count: disposed.length, samples: disposed });
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );
};
