import { DomainError, withActor } from "@lims-core/core";
import {
  analysisRequests,
  analysisServices,
  results,
  samples,
  signatures,
  users,
} from "@lims-core/db";
import { orderRequestSchema } from "@lims-core/schemas";
import { asc, desc, eq, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../auth/plugin.js";
import { hasPermission, isStudyMember } from "../auth/rbac.js";
import { sendDomainError } from "./helpers.js";

export const orderRoutes: FastifyPluginAsync = async (app) => {
  app.post("/samples/:sampleId/orders", async (request, reply) => {
    const { sampleId } = request.params as { sampleId: string };
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });
    const parsed = orderRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });

    const [sample] = await app.db.select().from(samples).where(eq(samples.id, sampleId)).limit(1);
    if (!sample) return reply.code(404).send({ error: "sample not found" });
    const allowed = await hasPermission(app.db, user.id, "order.create", {
      studyId: sample.studyId,
      siteId: sample.siteId,
    });
    if (!allowed) return reply.code(403).send({ error: "missing permission: order.create" });

    const [service] = await app.db
      .select()
      .from(analysisServices)
      .where(eq(analysisServices.id, parsed.data.serviceId))
      .limit(1);
    if (!service?.active) {
      return reply.code(400).send({ error: "analysis service not found or inactive" });
    }

    try {
      const order = await withActor(
        app.db,
        { userId: user.id, label: user.username },
        async (tx) => {
          if (sample.status === "disposed" || sample.status === "depleted") {
            throw new DomainError(`sample is ${sample.status}; tests cannot be ordered`, 409);
          }
          const [row] = await tx
            .insert(analysisRequests)
            .values({
              sampleId: sample.id,
              studyId: sample.studyId,
              serviceId: service.id,
              requestedBy: user.id,
            })
            .returning();
          if (!row) throw new Error("analysis request insert returned no row");
          await tx
            .update(samples)
            .set({ status: "in_testing", updatedAt: new Date() })
            .where(eq(samples.id, sample.id));
          return row;
        },
      );
      return reply.code(201).send(order);
    } catch (err) {
      return sendDomainError(reply, err);
    }
  });

  app.get("/samples/:sampleId/orders", { preHandler: requireAuth }, async (request, reply) => {
    const { sampleId } = request.params as { sampleId: string };
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });
    const [sample] = await app.db.select().from(samples).where(eq(samples.id, sampleId)).limit(1);
    if (!sample) return reply.code(404).send({ error: "sample not found" });
    if (!user.isSystemAdmin && !(await isStudyMember(app.db, user.id, sample.studyId))) {
      return reply.code(403).send({ error: "not a member of this study" });
    }

    const orders = await app.db
      .select({
        id: analysisRequests.id,
        status: analysisRequests.status,
        createdAt: analysisRequests.createdAt,
        serviceCode: analysisServices.code,
        serviceName: analysisServices.name,
        serviceUnit: analysisServices.unit,
        requestedBy: users.username,
        // Whether the service computes its result from a formula (ADR-0020).
        calculated: sql<boolean>`EXISTS (SELECT 1 FROM analysis_calculation ac WHERE ac.service_id = ${analysisRequests.serviceId} AND ac.active)`,
      })
      .from(analysisRequests)
      .innerJoin(analysisServices, eq(analysisRequests.serviceId, analysisServices.id))
      .innerJoin(users, eq(analysisRequests.requestedBy, users.id))
      .where(eq(analysisRequests.sampleId, sampleId))
      .orderBy(asc(analysisRequests.createdAt));

    return Promise.all(
      orders.map(async (order) => {
        const versions = await app.db
          .select({
            id: results.id,
            version: results.version,
            value: results.value,
            unit: results.unit,
            status: results.status,
            qcStatus: results.qcStatus,
            source: results.source,
            reasonForChange: results.reasonForChange,
            enteredBy: users.username,
            createdAt: results.createdAt,
          })
          .from(results)
          .innerJoin(users, eq(results.enteredBy, users.id))
          .where(eq(results.requestId, order.id))
          .orderBy(desc(results.version));
        const sigs = await app.db
          .select({
            id: signatures.id,
            meaning: signatures.meaning,
            recordHash: signatures.recordHash,
            signedAt: signatures.signedAt,
            signer: users.username,
            signerName: users.fullName,
            invalidatedAt: signatures.invalidatedAt,
          })
          .from(signatures)
          .innerJoin(users, eq(signatures.signerId, users.id))
          .where(eq(signatures.requestId, order.id))
          .orderBy(desc(signatures.signedAt));
        return { ...order, results: versions, signatures: sigs };
      }),
    );
  });
};
