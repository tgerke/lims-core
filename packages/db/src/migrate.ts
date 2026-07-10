import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { databaseUrl } from "./client.js";

/**
 * Minimal migration runner for hand-written SQL files: applies
 * migrations/*.sql in name order, one transaction per file, recorded in
 * schema_migration. Statements are separated by `--> statement-breakpoint`
 * (the siblings' drizzle convention, kept so files stay portable).
 */
export async function runMigrations(url = databaseUrl()): Promise<void> {
  const client = postgres(url, { onnotice: () => {}, max: 1 });
  try {
    // Serialize concurrent migrators (e.g. parallel integration-test files on
    // a fresh database). Session-level lock; released with the client.
    await client`SELECT pg_advisory_lock(hashtextextended('lims-core:migrate', 0))`;
    await client`CREATE TABLE IF NOT EXISTS schema_migration (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`;
    const dir = path.join(fileURLToPath(import.meta.url), "../../migrations");
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
    const applied = new Set(
      (await client`SELECT name FROM schema_migration`).map((r) => r.name as string),
    );
    for (const file of files) {
      if (applied.has(file)) continue;
      const text = await fs.readFile(path.join(dir, file), "utf8");
      await client.begin(async (tx) => {
        for (const statement of text.split("--> statement-breakpoint")) {
          if (statement.trim()) await tx.unsafe(statement);
        }
        await tx`INSERT INTO schema_migration (name) VALUES (${file})`;
      });
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await runMigrations();
  console.log("migrations applied");
}
