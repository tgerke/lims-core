import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

// Host port 5434 (infra/compose.yaml) so a local edc-core Postgres on 5432
// never gets hit by accident.
export const DEFAULT_DATABASE_URL = "postgres://lims:lims-dev-only@localhost:5434/lims";

/** Owner/migration connection string. */
export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

/**
 * Runtime connection string for the DML-only lims_app role (0002). Falls back
 * to the owner URL so tests and local hacking work against a bare database;
 * the deployed API must set APP_DATABASE_URL to keep least privilege real.
 */
export function appDatabaseUrl(): string {
  return process.env.APP_DATABASE_URL ?? databaseUrl();
}

export function createDb(url = appDatabaseUrl()) {
  const client = postgres(url, { onnotice: () => {} });
  return { db: drizzle(client, { schema }), client };
}

export type Db = ReturnType<typeof createDb>["db"];
