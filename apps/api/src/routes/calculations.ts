import { computeCalculatedResult, createCalculation, withActor } from "@lims-core/core";
import {
  analysisCalculationInputs,
  analysisCalculations,
  analysisRequests,
  analysisServices,
} from "@lims-core/db";
import { createCalculationSchema } from "@lims-core/schemas";
import { and, desc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { requireAuth, requirePermissionAnywhere } from "../auth/plugin.js";
import { hasPermission } from "../auth/rbac.js";
import { sendDomainError } from "./helpers.js";

// Calculated results (ADR-0020): define a service's formula (a config act,
// spec.manage, lab-wide) and compute a calculated result for an order (result
// entry, result.enter). No new permission.
export const calculationRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/analysis-services/:serviceId/calculation",
    { preHandler: requireAuth },
    async (request) => {
      const { serviceId } = request.params as { serviceId: string };
      const [calc] = await app.db
        .select()
        .from(analysisCalculations)
        .where(
          and(eq(analysisCalculations.serviceId, serviceId), eq(analysisCalculations.active, true)),
        )
        .orderBy(desc(analysisCalculations.effectiveFrom))
        .limit(1);
      if (!calc) return { calculation: null, inputs: [] };
      const inputs = await app.db
        .select({
          variable: analysisCalculationInputs.variable,
          serviceId: analysisCalculationInputs.inputServiceId,
          serviceCode: analysisServices.code,
        })
        .from(analysisCalculationInputs)
        .innerJoin(
          analysisServices,
          eq(analysisCalculationInputs.inputServiceId, analysisServices.id),
        )
        .where(eq(analysisCalculationInputs.calculationId, calc.id));
      return { calculation: calc, inputs };
    },
  );

  app.post(
    "/analysis-services/:serviceId/calculation",
    { preHandler: requirePermissionAnywhere("spec.manage") },
    async (request, reply) => {
      const { serviceId } = request.params as { serviceId: string };
      const user = request.user;
      if (!user) return reply.code(401).send({ error: "authentication required" });
      const parsed = createCalculationSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

      const [service] = await app.db
        .select()
        .from(analysisServices)
        .where(eq(analysisServices.id, serviceId))
        .limit(1);
      if (!service) return reply.code(404).send({ error: "analysis service not found" });

      try {
        const calc = await withActor(app.db, { userId: user.id, label: user.username }, (tx) =>
          createCalculation(tx, {
            serviceId,
            expression: parsed.data.expression,
            inputs: parsed.data.inputs.map((i) => ({
              variable: i.variable,
              inputServiceId: i.serviceId,
            })),
            actorId: user.id,
          }),
        );
        return reply.code(201).send(calc);
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );

  app.post("/orders/:orderId/calculate", async (request, reply) => {
    const { orderId } = request.params as { orderId: string };
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });
    const [order] = await app.db
      .select()
      .from(analysisRequests)
      .where(eq(analysisRequests.id, orderId))
      .limit(1);
    if (!order) return reply.code(404).send({ error: "analysis request not found" });
    if (!(await hasPermission(app.db, user.id, "result.enter", { studyId: order.studyId }))) {
      return reply.code(403).send({ error: "missing permission: result.enter" });
    }
    try {
      const row = await withActor(app.db, { userId: user.id, label: user.username }, (tx) =>
        computeCalculatedResult(tx, { requestId: orderId, actorId: user.id }),
      );
      return reply.code(201).send(row);
    } catch (err) {
      return sendDomainError(reply, err);
    }
  });
};
