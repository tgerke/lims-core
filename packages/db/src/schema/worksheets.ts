import { integer, numeric, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { analysisRequests } from "./analysis.js";
import { users } from "./auth.js";
import { inventoryLots, inventoryTransactions } from "./inventory.js";
import { studies } from "./studies.js";

// Worksheets/runs (ADR-0018): batch analysis orders for an instrument run and
// record the reagent lots the run consumes — the seam between the QC module
// (ADR-0017) and reagent inventory (ADR-0016). Study-scoped, so it rides the
// per-study audit chain (ADR-0002). Logic in packages/core/src/worksheet.ts.

export const worksheets = pgTable("worksheet", {
  id: uuid("id").primaryKey().defaultRandom(),
  studyId: uuid("study_id")
    .notNull()
    .references(() => studies.id),
  worksheetNumber: text("worksheet_number").notNull().unique(),
  status: text("status").notNull().default("draft"),
  instrument: text("instrument"),
  notes: text("notes"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const worksheetItems = pgTable(
  "worksheet_item",
  {
    worksheetId: uuid("worksheet_id")
      .notNull()
      .references(() => worksheets.id),
    requestId: uuid("request_id")
      .notNull()
      .references(() => analysisRequests.id),
    // Denormalized for the per-study audit chain scope (ADR-0002).
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.worksheetId, t.requestId] })],
);

// The seam: a run's reagent draw. Links the worksheet to the consumed lot and
// the exact append-only ledger row (ADR-0016) that recorded the consumption.
export const worksheetReagents = pgTable("worksheet_reagent", {
  id: uuid("id").primaryKey().defaultRandom(),
  worksheetId: uuid("worksheet_id")
    .notNull()
    .references(() => worksheets.id),
  lotId: uuid("lot_id")
    .notNull()
    .references(() => inventoryLots.id),
  transactionId: uuid("transaction_id")
    .notNull()
    .references(() => inventoryTransactions.id),
  studyId: uuid("study_id")
    .notNull()
    .references(() => studies.id),
  quantity: numeric("quantity").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const worksheetCounters = pgTable("worksheet_counter", {
  studyId: uuid("study_id")
    .primaryKey()
    .references(() => studies.id),
  lastValue: integer("last_value").notNull().default(0),
});
