import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sites, studies } from "./studies.js";

export const users = pgTable("app_user", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(),
  passwordHash: text("password_hash"),
  oidcSubject: text("oidc_subject").unique(),
  status: text("status").notNull().default("active"),
  isSystemAdmin: boolean("is_system_admin").notNull().default(false),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable(
  "session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull().unique(),
    authMethod: text("auth_method").notNull().default("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("session_user_lookup").on(t.userId)],
);

export const roles = pgTable("role", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
});

export const rolePermissions = pgTable(
  "role_permission",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    permission: text("permission").notNull(),
  },
  (t) => [index("role_permission_lookup").on(t.roleId, t.permission)],
);

export const userStudyRoles = pgTable(
  "user_study_role",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id),
    siteId: uuid("site_id").references(() => sites.id),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    grantedBy: uuid("granted_by")
      .notNull()
      .references(() => users.id),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("user_study_role_lookup").on(t.userId, t.studyId)],
);
