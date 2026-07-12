import { type CoaSnapshot, getCertificate, issueCertificate, withActor } from "@lims-core/core";
import { certificatesOfAnalysis, samples, users } from "@lims-core/db";
import { desc, eq } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../auth/plugin.js";
import { hasPermission, isStudyMember } from "../auth/rbac.js";
import { renderCoaPdf } from "../coa-pdf.js";
import { sendDomainError } from "./helpers.js";

// Certificate of Analysis (ADR-0022): issue an immutable snapshot of a sample's
// released results (reuses result.sign, the release authority) and render it to
// PDF on demand from the stored snapshot.
export const coaRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    "/samples/:sampleId/certificates",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { sampleId } = request.params as { sampleId: string };
      const user = request.user;
      if (!user) return reply.code(401).send({ error: "authentication required" });
      const [sample] = await app.db.select().from(samples).where(eq(samples.id, sampleId)).limit(1);
      if (!sample) return reply.code(404).send({ error: "sample not found" });
      if (!user.isSystemAdmin && !(await isStudyMember(app.db, user.id, sample.studyId))) {
        return reply.code(403).send({ error: "not a member of this study" });
      }
      return app.db
        .select({
          id: certificatesOfAnalysis.id,
          coaNumber: certificatesOfAnalysis.coaNumber,
          contentHash: certificatesOfAnalysis.contentHash,
          issuedAt: certificatesOfAnalysis.issuedAt,
          issuedBy: users.username,
        })
        .from(certificatesOfAnalysis)
        .innerJoin(users, eq(certificatesOfAnalysis.issuedBy, users.id))
        .where(eq(certificatesOfAnalysis.sampleId, sampleId))
        .orderBy(desc(certificatesOfAnalysis.issuedAt));
    },
  );

  app.post("/samples/:sampleId/certificates", async (request, reply) => {
    const { sampleId } = request.params as { sampleId: string };
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });
    const [sample] = await app.db.select().from(samples).where(eq(samples.id, sampleId)).limit(1);
    if (!sample) return reply.code(404).send({ error: "sample not found" });
    if (!(await hasPermission(app.db, user.id, "result.sign", { studyId: sample.studyId }))) {
      return reply.code(403).send({ error: "missing permission: result.sign" });
    }
    try {
      const coa = await withActor(app.db, { userId: user.id, label: user.username }, (tx) =>
        issueCertificate(tx, { sampleId, actorId: user.id }),
      );
      return reply.code(201).send(coa);
    } catch (err) {
      return sendDomainError(reply, err);
    }
  });

  app.get("/certificates/:coaId/pdf", { preHandler: requireAuth }, async (request, reply) => {
    const { coaId } = request.params as { coaId: string };
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });
    const coa = await getCertificate(app.db, coaId);
    if (!coa) return reply.code(404).send({ error: "certificate not found" });
    if (!user.isSystemAdmin && !(await isStudyMember(app.db, user.id, coa.studyId))) {
      return reply.code(403).send({ error: "not a member of this study" });
    }
    const pdf = await renderCoaPdf(coa.snapshot as CoaSnapshot, {
      coaNumber: coa.coaNumber,
      contentHash: coa.contentHash,
    });
    return reply
      .header("content-type", "application/pdf")
      .header("content-disposition", `inline; filename="${coa.coaNumber}.pdf"`)
      .send(Buffer.from(pdf));
  });
};
