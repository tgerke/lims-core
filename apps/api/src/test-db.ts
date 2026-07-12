// The suite runs against a dedicated database so a test run never mutates the
// dev database. Regulated tables are append-only and can't be torn down
// (test-helpers.ts uses unique suffixes instead of teardown), so without this
// every run leaves cruft behind in whatever database the app also uses.
//
// The test URL is derived from the owner URL (DATABASE_URL, or the local
// default) by swapping only the database name, so a custom host/credentials
// still apply; override wholesale with TEST_DATABASE_URL if needed.
//
// This module is imported by vitest.config.ts, whose loader resolves imports
// with Node (no `.js`→`.ts` remap), so it must stay free of workspace imports.
// The fallback below mirrors DEFAULT_DATABASE_URL in packages/db/src/client.ts.
const DEFAULT_OWNER_URL = "postgres://lims:lims-dev-only@localhost:5434/lims";

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

const ownerUrl = process.env.DATABASE_URL ?? DEFAULT_OWNER_URL;

/** Owner/migration connection to the dedicated test database. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? withDatabase(ownerUrl, "lims_test");

/** Maintenance connection (the always-present `postgres` db) used to CREATE it. */
export const MAINTENANCE_DATABASE_URL = withDatabase(ownerUrl, "postgres");

/** The bare name of the test database, for the CREATE DATABASE statement. */
export const TEST_DATABASE_NAME = new URL(TEST_DATABASE_URL).pathname.slice(1);
