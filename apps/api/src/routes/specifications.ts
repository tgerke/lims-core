import { createSpecification, withActor } from "@lims-core/core";
import { analysisServices, analysisSpecifications } from "@lims-core/db";
import { createSpecificationSchema } from "@lims-core/schemas";
import { desc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { requireAuth, requirePermissionAnywhere } from "../auth/plugin.js";
import { sendDomainError } from "./helpers.js";

// Analytical acceptance criteria per service (ADR-0017). Lab-wide like the
// service catalog they hang off, so spec.manage is authorized "anywhere".
export const specificationRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/analysis-services/:serviceId/specifications",
    { preHandler: requireAuth },
    async (request) => {
      const { serviceId } = request.params as { serviceId: string };
      return app.db
        .select()
        .from(analysisSpecifications)
        .where(eq(analysisSpecifications.serviceId, serviceId))
        .orderBy(desc(analysisSpecifications.effectiveFrom));
    },
  );

  app.post(
    "/analysis-services/:serviceId/specifications",
    { preHandler: requirePermissionAnywhere("spec.manage") },
    async (request, reply) => {
      const { serviceId } = request.params as { serviceId: string };
      const user = request.user;
      if (!user) return reply.code(401).send({ error: "authentication required" });
      const parsed = createSpecificationSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

      const [service] = await app.db
        .select()
        .from(analysisServices)
        .where(eq(analysisServices.id, serviceId))
        .limit(1);
      if (!service) return reply.code(404).send({ error: "analysis service not found" });

      try {
        const spec = await withActor(app.db, { userId: user.id, label: user.username }, (tx) =>
          createSpecification(tx, {
            serviceId,
            ...(parsed.data.unit ? { unit: parsed.data.unit } : {}),
            ...(parsed.data.lowerLimit !== undefined ? { lowerLimit: parsed.data.lowerLimit } : {}),
            ...(parsed.data.upperLimit !== undefined ? { upperLimit: parsed.data.upperLimit } : {}),
            ...(parsed.data.expectedValue ? { expectedValue: parsed.data.expectedValue } : {}),
            actorId: user.id,
          }),
        );
        return reply.code(201).send(spec);
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );
};
