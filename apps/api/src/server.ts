import { createDb, type Db } from "@lims-core/db";
import { healthResponseSchema } from "@lims-core/schemas";
import Fastify, { type FastifyInstance } from "fastify";
import type { AuthConfig } from "./auth/config.js";
import { authPlugin } from "./auth/plugin.js";
import { auditRoutes } from "./routes/audit.js";
import { orderRoutes } from "./routes/orders.js";
import { resultRoutes } from "./routes/results.js";
import { sampleRoutes } from "./routes/samples.js";
import { storageRoutes } from "./routes/storage.js";
import { studyRoutes } from "./routes/studies.js";

export const API_VERSION = "0.1.0";

export interface BuildServerOptions {
  db?: Db;
  authConfig?: AuthConfig;
}

export async function buildServer(opts: BuildServerOptions = {}): Promise<FastifyInstance> {
  const server = Fastify({ logger: true });

  let db = opts.db;
  if (!db) {
    // Runtime traffic uses the DML-only lims_app role (APP_DATABASE_URL);
    // migrations run separately as the owner.
    const created = createDb();
    db = created.db;
    server.addHook("onClose", async () => {
      await created.client.end();
    });
  }

  await server.register(authPlugin, {
    db,
    ...(opts.authConfig ? { config: opts.authConfig } : {}),
  });
  await server.register(studyRoutes);
  await server.register(sampleRoutes);
  await server.register(storageRoutes);
  await server.register(orderRoutes);
  await server.register(resultRoutes);
  await server.register(auditRoutes);

  server.get("/health", async () => {
    return healthResponseSchema.parse({
      status: "ok",
      service: "lims-core-api",
      version: API_VERSION,
      time: new Date().toISOString(),
    });
  });

  return server;
}
