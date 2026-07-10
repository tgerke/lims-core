import { randomBytes } from "node:crypto";
import { withActor } from "@lims-core/core";
import {
  analysisServices,
  type Db,
  roles,
  sites,
  storageUnits,
  studies,
  userStudyRoles,
  users,
} from "@lims-core/db";
import { eq } from "drizzle-orm";
import { hashPassword } from "./auth/password.js";

// Regulated tables are append-only, so tests can never clean up after
// themselves — every fixture gets a unique suffix instead.
export function uniqueSuffix(): string {
  return randomBytes(4).toString("hex");
}

export const TEST_PASSWORD = "test-password-1A!";

export async function createTestUser(
  db: Db,
  opts: { username: string; isSystemAdmin?: boolean } = { username: `user-${uniqueSuffix()}` },
) {
  const passwordHash = await hashPassword(TEST_PASSWORD);
  return withActor(db, { label: "test-setup" }, async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        username: opts.username,
        email: `${opts.username}@test.local`,
        fullName: `Test ${opts.username}`,
        passwordHash,
        isSystemAdmin: opts.isSystemAdmin ?? false,
      })
      .returning();
    if (!user) throw new Error("test user insert failed");
    return user;
  });
}

export async function createTestStudy(db: Db) {
  const suffix = uniqueSuffix();
  return withActor(db, { label: "test-setup" }, async (tx) => {
    const [study] = await tx
      .insert(studies)
      .values({ oid: `TEST-${suffix}`, name: `Test Study ${suffix}` })
      .returning();
    if (!study) throw new Error("test study insert failed");
    const [site] = await tx
      .insert(sites)
      .values({ studyId: study.id, oid: "SITE-01", name: "Test Site" })
      .returning();
    if (!site) throw new Error("test site insert failed");
    return { study, site };
  });
}

export async function grantTestRole(
  db: Db,
  userId: string,
  studyId: string,
  roleName: string,
  grantedBy: string,
) {
  const [role] = await db.select().from(roles).where(eq(roles.name, roleName)).limit(1);
  if (!role) throw new Error(`role ${roleName} not seeded`);
  await withActor(db, { label: "test-setup" }, async (tx) => {
    await tx.insert(userStudyRoles).values({ userId, studyId, roleId: role.id, grantedBy });
  });
}

export async function createTestBox(db: Db, gridRows = 2, gridCols = 2) {
  return withActor(db, { label: "test-setup" }, async (tx) => {
    const [box] = await tx
      .insert(storageUnits)
      .values({ name: `Box-${uniqueSuffix()}`, kind: "box", gridRows, gridCols })
      .returning();
    if (!box) throw new Error("test box insert failed");
    return box;
  });
}

export async function createTestService(db: Db) {
  return withActor(db, { label: "test-setup" }, async (tx) => {
    const [service] = await tx
      .insert(analysisServices)
      .values({ code: `SVC-${uniqueSuffix()}`, name: "Test Assay", unit: "ng/mL" })
      .returning();
    if (!service) throw new Error("test service insert failed");
    return service;
  });
}
