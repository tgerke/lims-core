import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { samples } from "./samples.js";
import { storageUnits } from "./storage.js";
import { studies } from "./studies.js";

export const custodyEvents = pgTable(
  "custody_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sampleId: uuid("sample_id")
      .notNull()
      .references(() => samples.id),
    // Denormalized from sample: audit chain scope + join-free study filters.
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id),
    eventType: text("event_type").notNull(),
    actorId: uuid("actor_id").references(() => users.id),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    storageUnitId: uuid("storage_unit_id").references(() => storageUnits.id),
    position: text("position"),
    details: jsonb("details"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("custody_event_sample_lookup").on(t.sampleId, t.occurredAt)],
);
