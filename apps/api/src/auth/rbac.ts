import { type Permission, withActor } from "@lims-core/core";
import { type Db, rolePermissions, userStudyRoles } from "@lims-core/db";
import { and, eq, isNull, or } from "drizzle-orm";

export interface PermissionScope {
  studyId: string;
  /** When set, grants scoped to a different site do not qualify. */
  siteId?: string;
}

/**
 * A user holds a permission in a study when any unrevoked role grant for that
 * study carries it. Site-scoped grants (siteId set on the grant) only apply
 * to their own site; study-wide grants (siteId null) apply everywhere.
 * System admins do NOT implicitly hold lab permissions — deliberate:
 * administering the system must not entitle anyone to enter, verify, or sign
 * results (P11-04).
 */
export async function hasPermission(
  db: Db,
  userId: string,
  permission: Permission,
  scope: PermissionScope,
): Promise<boolean> {
  const siteCondition = scope.siteId
    ? or(isNull(userStudyRoles.siteId), eq(userStudyRoles.siteId, scope.siteId))
    : isNull(userStudyRoles.siteId);

  const rows = await db
    .select({ roleId: userStudyRoles.roleId })
    .from(userStudyRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userStudyRoles.roleId))
    .where(
      and(
        eq(userStudyRoles.userId, userId),
        eq(userStudyRoles.studyId, scope.studyId),
        isNull(userStudyRoles.revokedAt),
        eq(rolePermissions.permission, permission),
        siteCondition,
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * All permissions the user's unrevoked grants confer in the scope. Serves the
 * UI's action gating; route guards still call hasPermission — this is
 * advisory, never authorization.
 */
export async function effectivePermissions(
  db: Db,
  userId: string,
  scope: PermissionScope,
): Promise<Permission[]> {
  const siteCondition = scope.siteId
    ? or(isNull(userStudyRoles.siteId), eq(userStudyRoles.siteId, scope.siteId))
    : isNull(userStudyRoles.siteId);
  const rows = await db
    .selectDistinct({ permission: rolePermissions.permission })
    .from(userStudyRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userStudyRoles.roleId))
    .where(
      and(
        eq(userStudyRoles.userId, userId),
        eq(userStudyRoles.studyId, scope.studyId),
        isNull(userStudyRoles.revokedAt),
        siteCondition,
      ),
    );
  return rows.map((r) => r.permission as Permission).sort();
}

/**
 * Whether the user holds a permission in ANY study they are a member of.
 * Lab-wide resources (reagent inventory, ADR-0016) have no study to scope a
 * grant to; authority is "you hold this somewhere." A knowingly-interim
 * resolution until a true org-scoped grant exists — never used for
 * study-scoped, per-record authorization, which stays on hasPermission.
 */
export async function hasPermissionAnywhere(
  db: Db,
  userId: string,
  permission: Permission,
): Promise<boolean> {
  const rows = await db
    .select({ roleId: userStudyRoles.roleId })
    .from(userStudyRoles)
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userStudyRoles.roleId))
    .where(
      and(
        eq(userStudyRoles.userId, userId),
        isNull(userStudyRoles.revokedAt),
        eq(rolePermissions.permission, permission),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Membership = any unrevoked role grant in the study (read visibility). */
export async function isStudyMember(db: Db, userId: string, studyId: string): Promise<boolean> {
  const rows = await db
    .select({ id: userStudyRoles.id })
    .from(userStudyRoles)
    .where(
      and(
        eq(userStudyRoles.userId, userId),
        eq(userStudyRoles.studyId, studyId),
        isNull(userStudyRoles.revokedAt),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Grant and revocation are trigger-audited via withActor (ADR-0002). */
export async function grantRole(
  db: Db,
  grant: {
    userId: string;
    studyId: string;
    roleId: string;
    siteId?: string;
    grantedBy: string;
    grantedByLabel: string;
  },
) {
  return withActor(db, { userId: grant.grantedBy, label: grant.grantedByLabel }, async (tx) => {
    const [row] = await tx
      .insert(userStudyRoles)
      .values({
        userId: grant.userId,
        studyId: grant.studyId,
        roleId: grant.roleId,
        siteId: grant.siteId ?? null,
        grantedBy: grant.grantedBy,
      })
      .returning();
    if (!row) throw new Error("role grant insert returned no row");
    return row;
  });
}

export async function revokeRole(
  db: Db,
  grantId: string,
  revokedBy: string,
  revokedByLabel: string,
): Promise<void> {
  await withActor(db, { userId: revokedBy, label: revokedByLabel }, async (tx) => {
    const [row] = await tx
      .update(userStudyRoles)
      .set({ revokedAt: new Date() })
      .where(and(eq(userStudyRoles.id, grantId), isNull(userStudyRoles.revokedAt)))
      .returning();
    if (!row) throw new Error("role grant not found or already revoked");
  });
}
