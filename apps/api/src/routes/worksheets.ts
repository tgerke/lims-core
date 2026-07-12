import {
  completeWorksheet,
  createWorksheet,
  recordReagentUse,
  startWorksheet,
  withActor,
} from "@lims-core/core";
import {
  analysisRequests,
  analysisServices,
  inventoryItems,
  inventoryLots,
  results,
  samples,
  studies,
  worksheetItems,
  worksheetReagents,
  worksheets,
} from "@lims-core/db";
import { createWorksheetSchema, recordReagentSchema } from "@lims-core/schemas";
import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { requireAuth, requirePermission } from "../auth/plugin.js";
import { hasPermission, isStudyMember } from "../auth/rbac.js";
import { sendDomainError } from "./helpers.js";

const BATCHABLE = ["ordered", "resulted", "verified"];
const OPEN = ["draft", "in_progress"];

// Worksheets/runs (ADR-0018): batch analysis orders for an instrument run and
// record the reagent lots the run consumes (the seam to inventory, ADR-0016).
export const worksheetRoutes: FastifyPluginAsync = async (app) => {
  async function requireMember(studyId: string, userId: string, isAdmin: boolean) {
    return isAdmin || (await isStudyMember(app.db, userId, studyId));
  }

  // Orders eligible to batch into a run: open orders in the study not already in
  // an open worksheet. Drives the "new worksheet" picker.
  app.get(
    "/studies/:studyId/orderable-orders",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { studyId } = request.params as { studyId: string };
      const user = request.user;
      if (!user) return reply.code(401).send({ error: "authentication required" });
      if (!(await requireMember(studyId, user.id, user.isSystemAdmin))) {
        return reply.code(403).send({ error: "not a member of this study" });
      }
      const batched = app.db
        .select({ id: worksheetItems.requestId })
        .from(worksheetItems)
        .innerJoin(worksheets, eq(worksheetItems.worksheetId, worksheets.id))
        .where(inArray(worksheets.status, OPEN));
      return app.db
        .select({
          id: analysisRequests.id,
          status: analysisRequests.status,
          serviceCode: analysisServices.code,
          serviceName: analysisServices.name,
          accessionId: samples.accessionId,
          sampleType: samples.sampleType,
        })
        .from(analysisRequests)
        .innerJoin(analysisServices, eq(analysisRequests.serviceId, analysisServices.id))
        .innerJoin(samples, eq(analysisRequests.sampleId, samples.id))
        .where(
          and(
            eq(analysisRequests.studyId, studyId),
            inArray(analysisRequests.status, BATCHABLE),
            notInArray(analysisRequests.id, batched),
          ),
        )
        .orderBy(desc(analysisRequests.createdAt));
    },
  );

  app.get("/studies/:studyId/worksheets", { preHandler: requireAuth }, async (request, reply) => {
    const { studyId } = request.params as { studyId: string };
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });
    if (!(await requireMember(studyId, user.id, user.isSystemAdmin))) {
      return reply.code(403).send({ error: "not a member of this study" });
    }
    return app.db
      .select({
        id: worksheets.id,
        worksheetNumber: worksheets.worksheetNumber,
        status: worksheets.status,
        instrument: worksheets.instrument,
        startedAt: worksheets.startedAt,
        completedAt: worksheets.completedAt,
        createdAt: worksheets.createdAt,
        itemCount: sql<number>`(SELECT count(*)::int FROM worksheet_item wi WHERE wi.worksheet_id = ${worksheets.id})`,
        reagentCount: sql<number>`(SELECT count(*)::int FROM worksheet_reagent wr WHERE wr.worksheet_id = ${worksheets.id})`,
      })
      .from(worksheets)
      .where(eq(worksheets.studyId, studyId))
      .orderBy(desc(worksheets.createdAt));
  });

  app.post(
    "/studies/:studyId/worksheets",
    {
      preHandler: requirePermission("worksheet.manage", (request) => ({
        studyId: (request.params as { studyId: string }).studyId,
      })),
    },
    async (request, reply) => {
      const { studyId } = request.params as { studyId: string };
      const user = request.user;
      if (!user) return reply.code(401).send({ error: "authentication required" });
      const parsed = createWorksheetSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

      const [study] = await app.db.select().from(studies).where(eq(studies.id, studyId)).limit(1);
      if (!study) return reply.code(404).send({ error: "study not found" });

      try {
        const { worksheet } = await withActor(
          app.db,
          { userId: user.id, label: user.username },
          (tx) =>
            createWorksheet(tx, {
              studyId,
              studyOid: study.oid,
              requestIds: parsed.data.requestIds,
              ...(parsed.data.instrument ? { instrument: parsed.data.instrument } : {}),
              ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
              actorId: user.id,
            }),
        );
        return reply.code(201).send(worksheet);
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );

  app.get("/worksheets/:worksheetId", { preHandler: requireAuth }, async (request, reply) => {
    const { worksheetId } = request.params as { worksheetId: string };
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });
    const [worksheet] = await app.db
      .select()
      .from(worksheets)
      .where(eq(worksheets.id, worksheetId))
      .limit(1);
    if (!worksheet) return reply.code(404).send({ error: "worksheet not found" });
    if (!(await requireMember(worksheet.studyId, user.id, user.isSystemAdmin))) {
      return reply.code(403).send({ error: "not a member of this study" });
    }

    const items = await app.db
      .select({
        requestId: analysisRequests.id,
        status: analysisRequests.status,
        serviceCode: analysisServices.code,
        serviceName: analysisServices.name,
        accessionId: samples.accessionId,
        sampleType: samples.sampleType,
      })
      .from(worksheetItems)
      .innerJoin(analysisRequests, eq(worksheetItems.requestId, analysisRequests.id))
      .innerJoin(analysisServices, eq(analysisRequests.serviceId, analysisServices.id))
      .innerJoin(samples, eq(analysisRequests.sampleId, samples.id))
      .where(eq(worksheetItems.worksheetId, worksheetId));

    const withResults = await Promise.all(
      items.map(async (it) => {
        const [current] = await app.db
          .select({ value: results.value, unit: results.unit, qcStatus: results.qcStatus })
          .from(results)
          .where(eq(results.requestId, it.requestId))
          .orderBy(desc(results.version))
          .limit(1);
        return { ...it, result: current ?? null };
      }),
    );

    const reagents = await app.db
      .select({
        id: worksheetReagents.id,
        quantity: worksheetReagents.quantity,
        lotNumber: inventoryLots.lotNumber,
        itemName: inventoryItems.name,
        itemUnit: inventoryItems.unit,
        createdAt: worksheetReagents.createdAt,
      })
      .from(worksheetReagents)
      .innerJoin(inventoryLots, eq(worksheetReagents.lotId, inventoryLots.id))
      .innerJoin(inventoryItems, eq(inventoryLots.itemId, inventoryItems.id))
      .where(eq(worksheetReagents.worksheetId, worksheetId))
      .orderBy(desc(worksheetReagents.createdAt));

    return { ...worksheet, items: withResults, reagents };
  });

  async function guardManage(worksheetId: string, userId: string) {
    const [worksheet] = await app.db
      .select()
      .from(worksheets)
      .where(eq(worksheets.id, worksheetId))
      .limit(1);
    if (!worksheet) return { error: 404 as const };
    const allowed = await hasPermission(app.db, userId, "worksheet.manage", {
      studyId: worksheet.studyId,
    });
    if (!allowed) return { error: 403 as const };
    return { worksheet };
  }

  app.post("/worksheets/:worksheetId/reagents", async (request, reply) => {
    const { worksheetId } = request.params as { worksheetId: string };
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });
    const parsed = recordReagentSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const guard = await guardManage(worksheetId, user.id);
    if (guard.error === 404) return reply.code(404).send({ error: "worksheet not found" });
    if (guard.error === 403) {
      return reply.code(403).send({ error: "missing permission: worksheet.manage" });
    }
    try {
      const result = await withActor(app.db, { userId: user.id, label: user.username }, (tx) =>
        recordReagentUse(tx, {
          worksheetId,
          lotId: parsed.data.lotId,
          quantity: parsed.data.quantity,
          ...(parsed.data.note ? { note: parsed.data.note } : {}),
          actorId: user.id,
        }),
      );
      return reply.code(201).send(result.link);
    } catch (err) {
      return sendDomainError(reply, err);
    }
  });

  const transition = (
    action: "start" | "complete",
    run: typeof startWorksheet | typeof completeWorksheet,
  ) => {
    app.post(`/worksheets/:worksheetId/${action}`, async (request, reply) => {
      const { worksheetId } = request.params as { worksheetId: string };
      const user = request.user;
      if (!user) return reply.code(401).send({ error: "authentication required" });
      const guard = await guardManage(worksheetId, user.id);
      if (guard.error === 404) return reply.code(404).send({ error: "worksheet not found" });
      if (guard.error === 403) {
        return reply.code(403).send({ error: "missing permission: worksheet.manage" });
      }
      try {
        const updated = await withActor(app.db, { userId: user.id, label: user.username }, (tx) =>
          run(tx, { worksheetId, actorId: user.id }),
        );
        return updated;
      } catch (err) {
        return sendDomainError(reply, err);
      }
    });
  };
  transition("start", startWorksheet);
  transition("complete", completeWorksheet);
};
