import { analysisServices, sites, storageUnits, studies, userStudyRoles } from "@lims-core/db";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { requireAuth } from "../auth/plugin.js";
import { effectivePermissions, isStudyMember } from "../auth/rbac.js";

/** Read surfaces for the slice: studies the user belongs to, their sites,
 * the storage tree, and the analysis-service catalog. */
export const studyRoutes: FastifyPluginAsync = async (app) => {
  app.get("/studies", { preHandler: requireAuth }, async (request) => {
    const user = request.user;
    if (!user) return [];
    if (user.isSystemAdmin) {
      return app.db.select().from(studies).orderBy(asc(studies.name));
    }
    const memberships = await app.db
      .selectDistinct({ studyId: userStudyRoles.studyId })
      .from(userStudyRoles)
      .where(and(eq(userStudyRoles.userId, user.id), isNull(userStudyRoles.revokedAt)));
    const ids = memberships.map((m) => m.studyId);
    if (ids.length === 0) return [];
    return app.db.select().from(studies).where(inArray(studies.id, ids)).orderBy(asc(studies.name));
  });

  app.get("/studies/:studyId/sites", { preHandler: requireAuth }, async (request, reply) => {
    const { studyId } = request.params as { studyId: string };
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });
    if (!user.isSystemAdmin && !(await isStudyMember(app.db, user.id, studyId))) {
      return reply.code(403).send({ error: "not a member of this study" });
    }
    return app.db.select().from(sites).where(eq(sites.studyId, studyId)).orderBy(asc(sites.oid));
  });

  app.get("/studies/:studyId/permissions", { preHandler: requireAuth }, async (request, reply) => {
    const { studyId } = request.params as { studyId: string };
    const user = request.user;
    if (!user) return reply.code(401).send({ error: "authentication required" });
    return { permissions: await effectivePermissions(app.db, user.id, { studyId }) };
  });

  app.get(
    "/studies/:studyId/storage-units",
    { preHandler: requireAuth },
    async (request, reply) => {
      const { studyId } = request.params as { studyId: string };
      const user = request.user;
      if (!user) return reply.code(401).send({ error: "authentication required" });
      if (!user.isSystemAdmin && !(await isStudyMember(app.db, user.id, studyId))) {
        return reply.code(403).send({ error: "not a member of this study" });
      }
      // Shared infrastructure (study_id null) plus this study's own units;
      // clients assemble the tree from parentId.
      const rows = await app.db.select().from(storageUnits).orderBy(asc(storageUnits.name));
      return rows.filter((u) => u.studyId === null || u.studyId === studyId);
    },
  );

  app.get("/analysis-services", { preHandler: requireAuth }, async () => {
    return app.db
      .select()
      .from(analysisServices)
      .where(eq(analysisServices.active, true))
      .orderBy(asc(analysisServices.code));
  });
};
