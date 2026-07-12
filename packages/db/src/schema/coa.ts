import { char, index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { samples } from "./samples.js";
import { studies } from "./studies.js";

// Certificate of Analysis (ADR-0022): an immutable snapshot of a sample's
// released results, issued and rendered to PDF on demand. Append-only; the
// content hash binds the rendered PDF to what was certified. Logic in
// packages/core/src/coa.ts.

export const certificatesOfAnalysis = pgTable(
  "certificate_of_analysis",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sampleId: uuid("sample_id")
      .notNull()
      .references(() => samples.id),
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id),
    coaNumber: text("coa_number").notNull().unique(),
    snapshot: jsonb("snapshot").notNull(),
    contentHash: char("content_hash", { length: 64 }).notNull(),
    issuedBy: uuid("issued_by")
      .notNull()
      .references(() => users.id),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("certificate_of_analysis_sample_lookup").on(t.sampleId)],
);

export const coaCounters = pgTable("coa_counter", {
  studyId: uuid("study_id")
    .primaryKey()
    .references(() => studies.id),
  lastValue: integer("last_value").notNull().default(0),
});
