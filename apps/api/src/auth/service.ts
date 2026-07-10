import { createHash, randomBytes } from "node:crypto";
import { withActor } from "@lims-core/core";
import { type Db, sessions, users } from "@lims-core/db";
import { and, eq, isNull } from "drizzle-orm";
import type { AuthConfig } from "./config.js";
import { verifyPassword } from "./password.js";

export type LoginResult =
  | { ok: true; token: string; userId: string }
  | { ok: false; reason: "invalid_credentials" | "locked" | "deactivated" };

export type AuthMethod = "password" | "oidc";

export interface AuthenticatedUser {
  id: string;
  username: string;
  fullName: string;
  isSystemAdmin: boolean;
  /** False for OIDC-provisioned accounts with no local password. */
  hasPassword: boolean;
  sessionId: string;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Constant-ish response for unknown users / passwordless accounts.
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/**
 * Ported from edc-core, adapted to trigger-based audit: this service never
 * writes audit_event rows itself (the runtime role cannot — 0002 revoked
 * INSERT). Every user/session write goes through withActor so the database
 * triggers attribute and hash-chain it (ADR-0002).
 */
export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly config: AuthConfig,
  ) {}

  async login(
    username: string,
    password: string,
    meta: { ip?: string; userAgent?: string } = {},
  ): Promise<LoginResult> {
    const [user] = await this.db.select().from(users).where(eq(users.username, username)).limit(1);
    if (!user) {
      await verifyPassword(DUMMY_HASH, password); // constant-ish timing
      return { ok: false, reason: "invalid_credentials" };
    }

    if (user.status === "deactivated") return { ok: false, reason: "deactivated" };
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      return { ok: false, reason: "locked" };
    }

    const valid = await verifyPassword(user.passwordHash ?? DUMMY_HASH, password);
    if (!valid) {
      const locked = await this.recordFailedAttempt(user.id, user.username, user.failedLoginCount);
      return { ok: false, reason: locked ? "locked" : "invalid_credentials" };
    }

    const token = await this.createSession(user.id, user.username, "password", meta);
    return { ok: true, token, userId: user.id };
  }

  /** Failure counting toward lockout (P11-07, §11.300(d)); trigger-audited. */
  private async recordFailedAttempt(
    userId: string,
    username: string,
    priorFailures: number,
  ): Promise<boolean> {
    const failedCount = priorFailures + 1;
    const lock = failedCount >= this.config.maxFailedLogins;
    const lockedUntil = lock ? new Date(Date.now() + this.config.lockoutMinutes * 60_000) : null;
    await withActor(this.db, { userId, label: username }, async (tx) => {
      await tx
        .update(users)
        .set({ failedLoginCount: failedCount, lockedUntil, updatedAt: new Date() })
        .where(eq(users.id, userId));
    });
    return lock;
  }

  /**
   * Issues a session token after credentials have been verified by either
   * mechanism. Resets lockout counters; the session INSERT is the audited
   * login event.
   */
  async createSession(
    userId: string,
    username: string,
    authMethod: AuthMethod,
    meta: { ip?: string; userAgent?: string } = {},
  ): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await withActor(this.db, { userId, label: username }, async (tx) => {
      await tx
        .update(users)
        .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
        .where(eq(users.id, userId));
      await tx.insert(sessions).values({
        userId,
        tokenHash: hashToken(token),
        authMethod,
        expiresAt: new Date(Date.now() + this.config.sessionAbsoluteHours * 3_600_000),
        ip: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      });
    });
    return token;
  }

  /**
   * Part 11 §11.200(a) re-authentication at signing (ADR-0003): the signer
   * re-enters their password, verified against the Argon2 local credential —
   * self-contained, no IdP round-trip. It must resolve to the session user;
   * nobody signs as anyone else. Failures count toward lockout exactly like
   * login failures (§11.300(d)).
   */
  async reauthenticate(
    actorId: string,
    password: string,
  ): Promise<
    { ok: true } | { ok: false; reason: "invalid_credentials" | "locked" | "no_password" }
  > {
    const [user] = await this.db.select().from(users).where(eq(users.id, actorId)).limit(1);
    if (user?.status !== "active") return { ok: false, reason: "invalid_credentials" };
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      return { ok: false, reason: "locked" };
    }
    if (!user.passwordHash) return { ok: false, reason: "no_password" };

    const valid = await verifyPassword(user.passwordHash, password);
    if (!valid) {
      const locked = await this.recordFailedAttempt(user.id, user.username, user.failedLoginCount);
      return { ok: false, reason: locked ? "locked" : "invalid_credentials" };
    }

    await withActor(this.db, { userId: user.id, label: user.username }, async (tx) => {
      await tx
        .update(users)
        .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
        .where(eq(users.id, user.id));
    });
    return { ok: true };
  }

  /** Validates a bearer token; slides the idle window on success. */
  async validateSession(token: string): Promise<AuthenticatedUser | null> {
    const [row] = await this.db
      .select({ session: sessions, user: users })
      .from(sessions)
      .innerJoin(users, eq(sessions.userId, users.id))
      .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)))
      .limit(1);
    if (!row) return null;

    const now = Date.now();
    const idleDeadline = row.session.lastSeenAt.getTime() + this.config.sessionIdleMinutes * 60_000;
    if (now > row.session.expiresAt.getTime() || now > idleDeadline) return null;
    if (row.user.status !== "active") return null;

    // Deliberately not trigger-audited (session_revoke_audit only fires on
    // revocation): the idle-window slide is traffic, not an auditable act.
    await this.db
      .update(sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(sessions.id, row.session.id));

    return {
      id: row.user.id,
      username: row.user.username,
      fullName: row.user.fullName,
      isSystemAdmin: row.user.isSystemAdmin,
      hasPassword: row.user.passwordHash !== null,
      sessionId: row.session.id,
    };
  }

  async logout(sessionId: string, actorId: string, actorLabel: string): Promise<void> {
    await withActor(this.db, { userId: actorId, label: actorLabel }, async (tx) => {
      await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, sessionId));
    });
  }
}
