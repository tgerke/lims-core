import { studyChainScope, verifyAuditChain } from "@lims-core/core";
import { auditEvents, users } from "@lims-core/db";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { hasPermission } from "../auth/rbac.js";

const filterSchema = z.object({
  action: z.string().min(1).optional(),
  entityType: z.string().min(1).optional(),
  entityId: z.string().min(1).optional(),
  actor: z.string().min(1).optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Audit review surface (P11-05): the trail is not just stored but reviewable —
 * filterable by action, entity, actor, and time. Read-only by construction;
 * the table itself rejects UPDATE/DELETE by trigger, and /verify replays the
 * study's hash chain on demand (ADR-0002).
 */
export const auditRoutes: FastifyPluginAsync = async (app) => {
  app.get("/studies/:studyId/audit", async (request, reply) => {
    const { studyId } = request.params as { studyId: string };
    if (!request.user) return reply.code(401).send({ error: "authentication required" });
    if (!(await hasPermission(app.db, request.user.id, "audit.review", { studyId }))) {
      return reply.code(403).send({ error: "missing permission: audit.review" });
    }
    const parsed = filterSchema.safeParse(request.query ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.message });
    const f = parsed.data;

    const conditions = [eq(auditEvents.chainScope, studyChainScope(studyId))];
    if (f.action) conditions.push(eq(auditEvents.action, f.action));
    if (f.entityType) conditions.push(eq(auditEvents.entityType, f.entityType));
    if (f.entityId) conditions.push(eq(auditEvents.entityId, f.entityId));
    if (f.actor) conditions.push(eq(auditEvents.actorLabel, f.actor));
    if (f.from) conditions.push(gte(auditEvents.occurredAt, new Date(f.from)));
    if (f.to) conditions.push(lte(auditEvents.occurredAt, new Date(f.to)));
    const where = and(...conditions);

    const rows = await app.db
      .select({
        id: auditEvents.id,
        occurredAt: auditEvents.occurredAt,
        actorLabel: auditEvents.actorLabel,
        actorName: users.fullName,
        action: auditEvents.action,
        entityType: auditEvents.entityType,
        entityId: auditEvents.entityId,
        before: auditEvents.before,
        after: auditEvents.after,
        prevHash: auditEvents.prevHash,
        hash: auditEvents.hash,
      })
      .from(auditEvents)
      .leftJoin(users, eq(auditEvents.actorId, users.id))
      .where(where)
      .orderBy(desc(auditEvents.id))
      .limit(f.limit)
      .offset(f.offset);

    const [{ total } = { total: 0 }] = await app.db
      .select({ total: sql<number>`count(*)::int` })
      .from(auditEvents)
      .where(where);

    const facets = await app.db
      .select({ action: auditEvents.action, entityType: auditEvents.entityType })
      .from(auditEvents)
      .where(eq(auditEvents.chainScope, studyChainScope(studyId)))
      .groupBy(auditEvents.action, auditEvents.entityType);

    return {
      total,
      events: rows.map((row) => ({ ...row, id: String(row.id) })),
      facets: {
        actions: [...new Set(facets.map((x) => x.action))].sort(),
        entityTypes: [...new Set(facets.map((x) => x.entityType))].sort(),
      },
    };
  });

  app.get("/studies/:studyId/audit/verify", async (request, reply) => {
    const { studyId } = request.params as { studyId: string };
    if (!request.user) return reply.code(401).send({ error: "authentication required" });
    if (!(await hasPermission(app.db, request.user.id, "audit.review", { studyId }))) {
      return reply.code(403).send({ error: "missing permission: audit.review" });
    }
    const problems = await verifyAuditChain(app.db, studyChainScope(studyId));
    return { scope: studyChainScope(studyId), ok: problems.length === 0, problems };
  });
};
