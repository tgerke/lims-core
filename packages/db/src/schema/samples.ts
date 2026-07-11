import { integer, numeric, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { storageUnits } from "./storage.js";
import { sites, studies } from "./studies.js";

export const samples = pgTable("sample", {
  id: uuid("id").primaryKey().defaultRandom(),
  studyId: uuid("study_id")
    .notNull()
    .references(() => studies.id),
  siteId: uuid("site_id")
    .notNull()
    .references(() => sites.id),
  accessionId: text("accession_id").notNull().unique(),
  sampleType: text("sample_type").notNull(),
  status: text("status").notNull().default("registered"),
  quantity: numeric("quantity"),
  quantityUnit: text("quantity_unit"),
  initialQuantity: numeric("initial_quantity"),
  subjectKey: text("subject_key"),
  studyEventOid: text("study_event_oid"),
  collectedAt: timestamp("collected_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  storageUnitId: uuid("storage_unit_id").references(() => storageUnits.id),
  storagePosition: text("storage_position"),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accessionCounters = pgTable("accession_counter", {
  studyId: uuid("study_id")
    .primaryKey()
    .references(() => studies.id),
  lastValue: integer("last_value").notNull().default(0),
});

export const sampleLineage = pgTable(
  "sample_lineage",
  {
    parentId: uuid("parent_id")
      .notNull()
      .references(() => samples.id),
    childId: uuid("child_id")
      .notNull()
      .references(() => samples.id),
    relation: text("relation").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.parentId, t.childId] })],
);
