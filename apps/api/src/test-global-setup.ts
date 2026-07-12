import { runMigrations } from "@lims-core/db";
import postgres from "postgres";
import { MAINTENANCE_DATABASE_URL, TEST_DATABASE_NAME, TEST_DATABASE_URL } from "./test-db.js";

// Vitest global setup: create the dedicated test database if it doesn't exist,
// then migrate it once. Runs in the main process before any worker, so tests
// find a ready database. Per-file `runMigrations()` calls then no-op (the runner
// skips already-applied migrations by name). CREATE DATABASE can't run inside a
// transaction, so it goes through the maintenance (`postgres`) connection with a
// plain query, guarded by an existence check.
export default async function setup(): Promise<void> {
  const admin = postgres(MAINTENANCE_DATABASE_URL, { onnotice: () => {}, max: 1 });
  try {
    const existing = await admin`SELECT 1 FROM pg_database WHERE datname = ${TEST_DATABASE_NAME}`;
    if (existing.length === 0) {
      await admin.unsafe(`CREATE DATABASE "${TEST_DATABASE_NAME}"`);
    }
  } finally {
    await admin.end();
  }
  await runMigrations(TEST_DATABASE_URL);
}
