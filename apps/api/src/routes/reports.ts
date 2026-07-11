import { durationStats, hoursBetween, toCsv } from "@lims-core/core";
import { custodyEvents, samples, sites, storageUnits, studies } from "@lims-core/db";
import { and, asc, count, eq } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { requireAuth } from "../auth/plugin.js";
import { isStudyMember } from "../auth/rbac.js";

// Read-only reporting and exports. Aggregates and a manifest export, gated by
// study membership like the other read surfaces — no mutations, no new
// permission. Everything stays scoped to the one study (ADR-0010).
export const reportRoutes: FastifyPluginAsync = async (app) => {
  const requireMember = async (
    request: FastifyRequest,
    reply: FastifyReply,
    studyId: string,
  ): Promise<boolean> => {
    const user = request.user;
    if (!user) {
      reply.code(401).send({ error: "authentication required" });
      return false;
    }
    if (!user.isSystemAdmin && !(await isStudyMember(app.db, user.id, studyId))) {
      reply.code(403).send({ error: "not a member of this study" });
      return false;
    }
    return true;
  };

  // Inventory counts: total plus breakdowns by status, specimen type, and site.
  app.get(
    "/studies/:studyId/reports/inventory",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { studyId } = request.params as { studyId: string };
      if (!(await requireMember(request, reply, studyId))) return;

      const byStatus = await app.db
        .select({ key: samples.status, count: count() })
        .from(samples)
        .where(eq(samples.studyId, studyId))
        .groupBy(samples.status)
        .orderBy(asc(samples.status));
      const byType = await app.db
        .select({ key: samples.sampleType, count: count() })
        .from(samples)
        .where(eq(samples.studyId, studyId))
        .groupBy(samples.sampleType)
        .orderBy(asc(samples.sampleType));
      const bySite = await app.db
        .select({ key: sites.oid, count: count() })
        .from(samples)
        .innerJoin(sites, eq(samples.siteId, sites.id))
        .where(eq(samples.studyId, studyId))
        .groupBy(sites.oid)
        .orderBy(asc(sites.oid));

      const total = byStatus.reduce((acc, r) => acc + Number(r.count), 0);
      return { total, byStatus, byType, bySite };
    },
  );

  // Turnaround time: collection -> receipt (from the sample row) and receipt ->
  // first storage placement (from the storage_add custody event).
  app.get(
    "/studies/:studyId/reports/turnaround",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { studyId } = request.params as { studyId: string };
      if (!(await requireMember(request, reply, studyId))) return;

      const rows = await app.db
        .select({
          id: samples.id,
          collectedAt: samples.collectedAt,
          receivedAt: samples.receivedAt,
        })
        .from(samples)
        .where(eq(samples.studyId, studyId));

      // Receipt -> storage uses the storage_add custody event (the placement).
      const storeEvents = await app.db
        .select({ sampleId: custodyEvents.sampleId, occurredAt: custodyEvents.occurredAt })
        .from(custodyEvents)
        .where(and(eq(custodyEvents.studyId, studyId), eq(custodyEvents.eventType, "storage_add")));
      const firstStorage = new Map<string, Date>();
      for (const e of storeEvents) {
        if (e.sampleId && e.occurredAt) {
          const prev = firstStorage.get(e.sampleId);
          if (!prev || e.occurredAt < prev) firstStorage.set(e.sampleId, e.occurredAt);
        }
      }

      const collectionToReceipt: number[] = [];
      const receiptToStorage: number[] = [];
      for (const r of rows) {
        const c2r = hoursBetween(r.collectedAt, r.receivedAt);
        if (c2r !== null && c2r >= 0) collectionToReceipt.push(c2r);
        const stored = firstStorage.get(r.id);
        const r2s = hoursBetween(r.receivedAt, stored ?? null);
        if (r2s !== null && r2s >= 0) receiptToStorage.push(r2s);
      }

      return {
        collectionToReceipt: durationStats(collectionToReceipt),
        receiptToStorage: durationStats(receiptToStorage),
      };
    },
  );

  // Sample manifest as CSV. EDC references only (no PHI), scoped to this study.
  app.get(
    "/studies/:studyId/reports/manifest.csv",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { studyId } = request.params as { studyId: string };
      if (!(await requireMember(request, reply, studyId))) return;
      const [study] = await app.db.select().from(studies).where(eq(studies.id, studyId)).limit(1);
      if (!study) return reply.code(404).send({ error: "study not found" });

      const rows = await app.db
        .select({
          accessionId: samples.accessionId,
          sampleType: samples.sampleType,
          status: samples.status,
          subjectKey: samples.subjectKey,
          studyEventOid: samples.studyEventOid,
          siteOid: sites.oid,
          collectedAt: samples.collectedAt,
          receivedAt: samples.receivedAt,
          storageUnit: storageUnits.name,
          storagePosition: samples.storagePosition,
          quantity: samples.quantity,
          quantityUnit: samples.quantityUnit,
        })
        .from(samples)
        .innerJoin(sites, eq(samples.siteId, sites.id))
        .leftJoin(storageUnits, eq(samples.storageUnitId, storageUnits.id))
        .where(eq(samples.studyId, studyId))
        .orderBy(asc(samples.accessionId));

      const headers = [
        "accession_id",
        "sample_type",
        "status",
        "subject_key",
        "study_event_oid",
        "site_oid",
        "collected_at",
        "received_at",
        "storage_unit",
        "storage_position",
        "quantity",
        "quantity_unit",
      ];
      const iso = (d: Date | null) => (d ? d.toISOString() : null);
      const body = toCsv(
        headers,
        rows.map((r) => [
          r.accessionId,
          r.sampleType,
          r.status,
          r.subjectKey,
          r.studyEventOid,
          r.siteOid,
          iso(r.collectedAt),
          iso(r.receivedAt),
          r.storageUnit,
          r.storagePosition,
          r.quantity,
          r.quantityUnit,
        ]),
      );

      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="${study.oid}-manifest.csv"`)
        .send(body);
    },
  );
};
