import cookie from "@fastify/cookie";
import type { Permission } from "@lims-core/core";
import { type Db, users } from "@lims-core/db";
import { loginRequestSchema } from "@lims-core/schemas";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { type AuthConfig, loadAuthConfig } from "./config.js";
import {
  decodeFlowState,
  encodeFlowState,
  newFlowState,
  OidcClient,
  OidcProvisionError,
  provisionOidcUser,
  safeReturnTo,
} from "./oidc.js";
import { hasPermission, hasPermissionAnywhere, type PermissionScope } from "./rbac.js";
import { type AuthenticatedUser, AuthService } from "./service.js";

declare module "fastify" {
  interface FastifyRequest {
    user: AuthenticatedUser | null;
  }
  interface FastifyInstance {
    authService: AuthService;
    db: Db;
  }
}

export const SESSION_COOKIE = "lims_session";
export const OIDC_STATE_COOKIE = "lims_oidc_state";

function extractToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header?.startsWith("Bearer ")) return header.slice("Bearer ".length);
  return request.cookies[SESSION_COOKIE] ?? null;
}

export interface AuthPluginOptions {
  db: Db;
  config?: AuthConfig;
}

const plugin: FastifyPluginAsync<AuthPluginOptions> = async (app, opts) => {
  const config = opts.config ?? loadAuthConfig();
  const service = new AuthService(opts.db, config);
  const oidcClient = config.oidc ? new OidcClient(config.oidc) : null;
  if (oidcClient) {
    oidcClient.warmUp().catch((err) => {
      app.log.error({ err }, "OIDC discovery failed at boot; will retry on first login");
    });
  }

  await app.register(cookie);
  app.decorate("db", opts.db);
  app.decorate("authService", service);
  app.decorateRequest("user", null);

  app.addHook("onRequest", async (request) => {
    const token = extractToken(request);
    request.user = token ? await service.validateSession(token) : null;
  });

  app.get("/auth/config", async () => ({
    oidcEnabled: oidcClient !== null,
    oidcOnly: config.oidcOnly,
    providerLabel: config.oidc?.providerLabel ?? null,
    passwordLoginEnabled: !config.oidcOnly,
  }));

  app.post("/auth/login", async (request, reply) => {
    if (config.oidcOnly) {
      // Break-glass for a misconfigured IdP is unsetting LIMS_OIDC_ONLY.
      return reply.code(403).send({ error: "password_login_disabled" });
    }
    const parsed = loginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "username and password are required" });
    }
    const result = await service.login(parsed.data.username, parsed.data.password, {
      ...(request.ip ? { ip: request.ip } : {}),
      ...(request.headers["user-agent"] ? { userAgent: request.headers["user-agent"] } : {}),
    });
    if (!result.ok) {
      return reply.code(401).send({ error: result.reason });
    }
    reply.setCookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    });
    return { token: result.token };
  });

  app.post("/auth/logout", { preHandler: requireAuth }, async (request, reply) => {
    const user = request.user as AuthenticatedUser;
    await service.logout(user.sessionId, user.id, user.username);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/auth/me", { preHandler: requireAuth }, async (request) => {
    const user = request.user as AuthenticatedUser;
    return {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      isSystemAdmin: user.isSystemAdmin,
      hasPassword: user.hasPassword,
    };
  });

  // ── OIDC (authorization code + PKCE) ──────────────────────────────────
  // Browser-navigation endpoints: errors surface as redirects back into the
  // SPA, not JSON. The flow-state cookie must be sameSite=lax — the IdP's
  // redirect to the callback is a cross-site top-level navigation, which a
  // strict cookie would not accompany. The session cookie stays strict; it
  // is only *set* on the callback response, never required by it.

  const stateCookieOptions = {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  } as const;

  app.get("/auth/oidc/login", async (request, reply) => {
    if (!oidcClient) return reply.code(404).send({ error: "SSO is not configured" });
    const query = request.query as { returnTo?: string };
    const { flow, codeChallenge } = await newFlowState(safeReturnTo(query.returnTo));
    try {
      const url = await oidcClient.buildAuthorizationUrl({
        state: flow.state,
        nonce: flow.nonce,
        codeChallenge,
      });
      reply.setCookie(OIDC_STATE_COOKIE, encodeFlowState(flow), stateCookieOptions);
      return reply.redirect(url.href);
    } catch (err) {
      request.log.error({ err }, "OIDC authorization redirect failed");
      return reply.code(503).send({ error: "identity provider unreachable" });
    }
  });

  app.get("/auth/oidc/callback", async (request, reply) => {
    if (!oidcClient || !config.oidc)
      return reply.code(404).send({ error: "SSO is not configured" });
    const raw = request.cookies[OIDC_STATE_COOKIE];
    reply.clearCookie(OIDC_STATE_COOKIE, { path: "/" });
    const flow = raw ? decodeFlowState(raw) : null;
    if (!flow) return reply.redirect("/login?error=oidc_state");

    // Reconstruct the callback URL on the *registered* redirect URI (the API
    // may sit behind a proxy that rewrites paths); token-endpoint redirect_uri
    // validation requires an exact match.
    const callbackUrl = new URL(config.oidc.redirectUri);
    callbackUrl.search = new URL(request.url, "http://placeholder.invalid").search;

    let claims: Awaited<ReturnType<OidcClient["exchangeCode"]>>;
    try {
      claims = await oidcClient.exchangeCode(callbackUrl, {
        state: flow.state,
        nonce: flow.nonce,
        codeVerifier: flow.codeVerifier,
      });
    } catch (err) {
      request.log.error({ err }, "OIDC code exchange failed");
      return reply.redirect("/login?error=oidc_exchange");
    }

    try {
      const { userId } = await provisionOidcUser(opts.db, claims);
      const [me] = await opts.db.select().from(users).where(eq(users.id, userId)).limit(1);
      const token = await service.createSession(userId, me?.username ?? "oidc-user", "oidc", {
        ...(request.ip ? { ip: request.ip } : {}),
        ...(request.headers["user-agent"] ? { userAgent: request.headers["user-agent"] } : {}),
      });
      reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      });
      return reply.redirect(flow.returnTo);
    } catch (err) {
      if (err instanceof OidcProvisionError) {
        return reply.redirect(`/login?error=${err.code}`);
      }
      request.log.error({ err }, "OIDC provisioning failed");
      return reply.redirect("/login?error=oidc_provision");
    }
  });
};

export const authPlugin = fp(plugin, { name: "lims-auth" });

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!request.user) {
    await reply.code(401).send({ error: "authentication required" });
  }
}

export function requireSystemAdmin() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      await reply.code(401).send({ error: "authentication required" });
      return;
    }
    if (!request.user.isSystemAdmin) {
      await reply.code(403).send({ error: "system administrator required" });
    }
  };
}

/**
 * Route guard: 401 unauthenticated, 403 when the permission is not held in
 * the scope the route resolves from its request (P11-04).
 *
 * `allowSystemAdmin` is for administrative permissions only (e.g. the first
 * role grant in a new study, which would otherwise be unreachable). Never
 * set it on lab capabilities — system administration must not entitle
 * anyone to accession, enter, verify, or sign data.
 */
export function requirePermission(
  permission: Permission,
  resolveScope: (request: FastifyRequest) => PermissionScope,
  opts: { allowSystemAdmin?: boolean } = {},
) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      await reply.code(401).send({ error: "authentication required" });
      return;
    }
    if (opts.allowSystemAdmin && request.user.isSystemAdmin) return;
    const allowed = await hasPermission(
      request.server.db,
      request.user.id,
      permission,
      resolveScope(request),
    );
    if (!allowed) {
      await reply.code(403).send({ error: `missing permission: ${permission}` });
    }
  };
}

/**
 * Route guard for lab-wide resources with no study scope (reagent inventory,
 * ADR-0016): 403 unless the permission is held in some study the user belongs
 * to. Do not use for study-scoped records — use requirePermission there.
 */
export function requirePermissionAnywhere(permission: Permission) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      await reply.code(401).send({ error: "authentication required" });
      return;
    }
    const allowed = await hasPermissionAnywhere(request.server.db, request.user.id, permission);
    if (!allowed) {
      await reply.code(403).send({ error: `missing permission: ${permission}` });
    }
  };
}
