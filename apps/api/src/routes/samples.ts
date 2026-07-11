import { accessionSample, aliquotSample, withActor } from "@lims-core/core";
import {
  custodyEvents,
  sampleLineage,
  samples,
  sites,
  storageUnits,
  studies,
  users,
} from "@lims-core/db";
import { generateDataMatrixPng } from "@lims-core/labels/datamatrix";
import { accessionRequestSchema, aliquotRequestSchema } from "@lims-core/schemas";
import { asc, desc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { requireAuth, requirePermission } from "../auth/plugin.js";
import { hasPermission, isStudyMember } from "../auth/rbac.js";
import { sendDomainError } from "./helpers.js";

export const sampleRoutes: FastifyPluginAsync = async (app) => {
  app.get("/studies/:studyId/samples", { preHandler: requireAuth }, async (request, reply) => {
    const { studyId } = request.params as { studyId: string };
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });
    if (!user.isSystemAdmin && !(await isStudyMember(app.db, user.id, studyId))) {
      return reply.code(403).send({ error: "not a member of this study" });
    }
    return app.db
      .select({
        id: samples.id,
        accessionId: samples.accessionId,
        sampleType: samples.sampleType,
        status: samples.status,
        quantity: samples.quantity,
        quantityUnit: samples.quantityUnit,
        subjectKey: samples.subjectKey,
        collectedAt: samples.collectedAt,
        receivedAt: samples.receivedAt,
        siteOid: sites.oid,
        storageUnit: storageUnits.name,
        storagePosition: samples.storagePosition,
        createdAt: samples.createdAt,
      })
      .from(samples)
      .innerJoin(sites, eq(samples.siteId, sites.id))
      .leftJoin(storageUnits, eq(samples.storageUnitId, storageUnits.id))
      .where(eq(samples.studyId, studyId))
      .orderBy(desc(samples.createdAt));
  });

  app.post(
    "/studies/:studyId/samples",
    {
      preHandler: requirePermission("sample.accession", (request) => {
        const { studyId } = request.params as { studyId: string };
        const body = (request.body ?? {}) as { siteId?: string };
        return { studyId, ...(body.siteId ? { siteId: body.siteId } : {}) };
      }),
    },
    async (request, reply) => {
      const { studyId } = request.params as { studyId: string };
      const user = request.user;
      if (!user) return reply.code(401).send({ error: "authentication required" });
      const parsed = accessionRequestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

      const [study] = await app.db.select().from(studies).where(eq(studies.id, studyId)).limit(1);
      if (!study) return reply.code(404).send({ error: "study not found" });
      const [site] = await app.db
        .select()
        .from(sites)
        .where(eq(sites.id, parsed.data.siteId))
        .limit(1);
      if (!site || site.studyId !== studyId) {
        return reply.code(400).send({ error: "site does not belong to this study" });
      }

      try {
        const sample = await withActor(app.db, { userId: user.id, label: user.username }, (tx) =>
          accessionSample(tx, {
            studyId,
            studyOid: study.oid,
            siteId: site.id,
            sampleType: parsed.data.sampleType,
            ...(parsed.data.subjectKey ? { subjectKey: parsed.data.subjectKey } : {}),
            ...(parsed.data.studyEventOid ? { studyEventOid: parsed.data.studyEventOid } : {}),
            ...(parsed.data.collectedAt ? { collectedAt: new Date(parsed.data.collectedAt) } : {}),
            actorId: user.id,
          }),
        );
        return reply.code(201).send(sample);
      } catch (err) {
        return sendDomainError(reply, err);
      }
    },
  );

  app.get("/samples/:sampleId", { preHandler: requireAuth }, async (request, reply) => {
    const { sampleId } = request.params as { sampleId: string };
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });
    const [sample] = await app.db.select().from(samples).where(eq(samples.id, sampleId)).limit(1);
    if (!sample) return reply.code(404).send({ error: "sample not found" });
    if (!user.isSystemAdmin && !(await isStudyMember(app.db, user.id, sample.studyId))) {
      return reply.code(403).send({ error: "not a member of this study" });
    }
    const [site] = await app.db.select().from(sites).where(eq(sites.id, sample.siteId)).limit(1);
    const storage = sample.storageUnitId
      ? await app.db
          .select()
          .from(storageUnits)
          .where(eq(storageUnits.id, sample.storageUnitId))
          .limit(1)
      : [];
    const custody = await app.db
      .select({
        id: custodyEvents.id,
        eventType: custodyEvents.eventType,
        occurredAt: custodyEvents.occurredAt,
        actor: users.username,
        storageUnit: storageUnits.name,
        position: custodyEvents.position,
        details: custodyEvents.details,
      })
      .from(custodyEvents)
      .leftJoin(users, eq(custodyEvents.actorId, users.id))
      .leftJoin(storageUnits, eq(custodyEvents.storageUnitId, storageUnits.id))
      .where(eq(custodyEvents.sampleId, sampleId))
      .orderBy(asc(custodyEvents.occurredAt), asc(custodyEvents.createdAt));

    const lineageCols = {
      id: samples.id,
      accessionId: samples.accessionId,
      relation: sampleLineage.relation,
    };
    const parents = await app.db
      .select(lineageCols)
      .from(sampleLineage)
      .innerJoin(samples, eq(sampleLineage.parentId, samples.id))
      .where(eq(sampleLineage.childId, sampleId));
    const children = await app.db
      .select(lineageCols)
      .from(sampleLineage)
      .innerJoin(samples, eq(sampleLineage.childId, samples.id))
      .where(eq(sampleLineage.parentId, sampleId))
      .orderBy(asc(samples.accessionId));

    return {
      ...sample,
      site: site ?? null,
      storageUnit: storage[0] ?? null,
      custody,
      lineage: { parent: parents[0] ?? null, children },
    };
  });

  app.post("/samples/:sampleId/aliquot", { preHandler: requireAuth }, async (request, reply) => {
    const { sampleId } = request.params as { sampleId: string };
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });
    const parsed = aliquotRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    // Scope comes from the sample, so the permission check runs after the load
    // (site-scoped grants apply at the sample's site), matching /store.
    const [sample] = await app.db.select().from(samples).where(eq(samples.id, sampleId)).limit(1);
    if (!sample) return reply.code(404).send({ error: "sample not found" });
    const allowed = await hasPermission(app.db, user.id, "sample.aliquot", {
      studyId: sample.studyId,
      siteId: sample.siteId,
    });
    if (!allowed) return reply.code(403).send({ error: "missing permission: sample.aliquot" });

    try {
      const result = await withActor(app.db, { userId: user.id, label: user.username }, (tx) =>
        aliquotSample(tx, {
          parentId: sampleId,
          count: parsed.data.count,
          ...(parsed.data.volume !== undefined ? { volume: parsed.data.volume } : {}),
          actorId: user.id,
        }),
      );
      return reply.code(201).send(result);
    } catch (err) {
      return sendDomainError(reply, err);
    }
  });

  // Label PNG: DataMatrix of the accession id (ADR-0004). Membership-gated
  // like the rest of the sample record.
  app.get("/samples/:sampleId/label.png", { preHandler: requireAuth }, async (request, reply) => {
    const { sampleId } = request.params as { sampleId: string };
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });
    const [sample] = await app.db.select().from(samples).where(eq(samples.id, sampleId)).limit(1);
    if (!sample) return reply.code(404).send({ error: "sample not found" });
    if (!user.isSystemAdmin && !(await isStudyMember(app.db, user.id, sample.studyId))) {
      return reply.code(403).send({ error: "not a member of this study" });
    }
    const png = await generateDataMatrixPng(sample.accessionId);
    return reply.header("content-type", "image/png").send(png);
  });
};
