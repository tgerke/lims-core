import { defineConfig } from "vitest/config";
import { TEST_DATABASE_URL } from "./src/test-db.js";

// Point every test at the dedicated test database (created + migrated by the
// global setup) so runs never touch the dev database. `env` overrides
// DATABASE_URL in the worker, which is what `databaseUrl()` reads; the
// compliance test derives its lims_app connection from the same URL.
export default defineConfig({
  test: {
    env: { DATABASE_URL: TEST_DATABASE_URL },
    globalSetup: ["./src/test-global-setup.ts"],
  },
});
