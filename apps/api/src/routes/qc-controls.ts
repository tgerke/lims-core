import { createControlMaterial, recordQcMeasurement, withActor } from "@lims-core/core";
import { analysisServices, controlMaterials, worksheets } from "@lims-core/db";
import { createControlMaterialSchema, recordQcMeasurementSchema } from "@lims-core/schemas";
import { desc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { requireAuth, requirePermissionAnywhere } from "../auth/plugin.js";
import { hasPermission } from "../auth/rbac.js";
import { sendDomainError } from "./helpers.js";

// QC control samples (ADR-0019): the control material catalog (a config act,
// spec.manage, lab-wide) and control measurements recorded on a run (bench work,
// worksheet.manage). Single-point Westgard evaluation happens at measurement.
export const qcControlRoutes: FastifyPluginAsync = async (app) => {
  // Active control materials across the lab, for the run's QC picker.
  app.get("/control-materials", { preHandler: requireAuth }, async () => {
    return app.db
      .select({
        id: controlMaterials.id,
        serviceId: controlMaterials.serviceId,
        serviceCode: analysisServices.code,
        serviceName: analysisServices.name,
        level: controlMaterials.level,
        lotNumber: controlMaterials.lotNumber,
        targetMean: controlMaterials.targetMean,
        targetSd: controlMaterials.targetSd,
        unit: controlMaterials.unit,
      })
      .from(controlMaterials)
      .innerJoin(analysisServices, eq(controlMaterials.serviceId, analysisServices.id))
      .where(eq(controlMaterials.active, true))
      .orderBy(analysisServices.code, controlMaterials.level);
  });

  app.get(
    "/analysis-services/:serviceId/control-materials",
    { preHandler: requireAuth },
    async (request) => {
      const { serviceId } = request.params as { serviceId: string };
      return app.db
        .select()
        .from(controlMaterials)
        .where(eq(controlMaterials.serviceId, serviceId))
        .orderBy(desc(controlMaterials.effectiveFrom));
    },
  );

  app.post(
    "/analysis-services/:serviceId/control-materials",
    { preHandler: requirePermissionAnywhere("spec.manage") },
    async (request, reply) => {
      const { serviceId } = request.params as { serviceId: string };
      const user = request.user;
      if (!user) return reply.code(401).send({ error: "authentication required" });
      const parsed = createControlMaterialSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

      const [service] = await app.db
        .select()
        .from(analysisServices)
        .where(eq(analysisServices.id, serviceId))
        .limit(1);
      if (!service) return reply.code(404).send({ error: "analysis service not found" });

      try {
        const control = await withActor(app.db, { userId: user.id, label: user.username }, (tx) =>
          createControlMaterial(tx, {
            serviceId,
            level: parsed.data.level,
            lotNumber: parsed.data.lotNumber,
            targetMean: parsed.data.targetMean,
            targetSd: parsed.data.targetSd,
            ...(parsed.data.expiry ? { expiry: parsed.data.expiry } : {}),
            ...(parsed.data.unit ? { unit: parsed.data.unit } : {}),
            actorId: user.id,
          }),
        );
        return reply.code(201).send(control);
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );

  app.post("/worksheets/:worksheetId/qc-measurements", async (request, reply) => {
    const { worksheetId } = request.params as { worksheetId: string };
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });
    const parsed = recordQcMeasurementSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const [worksheet] = await app.db
      .select()
      .from(worksheets)
      .where(eq(worksheets.id, worksheetId))
      .limit(1);
    if (!worksheet) return reply.code(404).send({ error: "worksheet not found" });
    const allowed = await hasPermission(app.db, user.id, "worksheet.manage", {
      studyId: worksheet.studyId,
    });
    if (!allowed) return reply.code(403).send({ error: "missing permission: worksheet.manage" });

    try {
      const measurement = await withActor(app.db, { userId: user.id, label: user.username }, (tx) =>
        recordQcMeasurement(tx, {
          worksheetId,
          controlMaterialId: parsed.data.controlMaterialId,
          value: parsed.data.value,
          actorId: user.id,
        }),
      );
      return reply.code(201).send(measurement);
    } catch (err) {
      return sendDomainError(reply, err);
    }
  });
};
