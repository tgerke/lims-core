import { controlMaterialSeries, qcReviewSummary } from "@lims-core/core";
import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../auth/plugin.js";

// Read-only QC review (ADR-0024): a lab-wide board of active controls and the
// Levey-Jennings series for one control material. No mutations and no new
// permission — authenticated read, like the run's control-material picker
// (ADR-0019). Controls are lab-wide, so neither route is study-scoped.
export const qcReviewRoutes: FastifyPluginAsync = async (app) => {
  app.get("/qc-review", { preHandler: requireAuth }, async () => {
    return qcReviewSummary(app.db);
  });

  app.get("/control-materials/:id/series", { preHandler: requireAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const series = await controlMaterialSeries(app.db, id);
    if (!series) return reply.code(404).send({ error: "control material not found" });
    return series;
  });
};
