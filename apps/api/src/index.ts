import { runMigrations } from "@lims-core/db";
import { buildServer } from "./server.js";

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

// Migrations run as the owner role (DATABASE_URL); the server itself then
// connects as DML-only lims_app (APP_DATABASE_URL) — least privilege stays
// real even in the single-container dev setup.
await runMigrations();
const server = await buildServer();

try {
  await server.listen({ port, host });
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
