import { integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { samples } from "./samples.js";
import { sites, studies } from "./studies.js";

export const shipments = pgTable("shipment", {
  id: uuid("id").primaryKey().defaultRandom(),
  studyId: uuid("study_id")
    .notNull()
    .references(() => studies.id),
  shipmentNumber: text("shipment_number").notNull().unique(),
  originSiteId: uuid("origin_site_id").references(() => sites.id),
  destination: text("destination").notNull(),
  carrier: text("carrier"),
  trackingNumber: text("tracking_number"),
  status: text("status").notNull().default("packed"),
  shippedAt: timestamp("shipped_at", { withTimezone: true }),
  receivedAt: timestamp("received_at", { withTimezone: true }),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const shipmentItems = pgTable(
  "shipment_item",
  {
    shipmentId: uuid("shipment_id")
      .notNull()
      .references(() => shipments.id),
    sampleId: uuid("sample_id")
      .notNull()
      .references(() => samples.id),
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.shipmentId, t.sampleId] })],
);

export const shipmentCounters = pgTable("shipment_counter", {
  studyId: uuid("study_id")
    .primaryKey()
    .references(() => studies.id),
  lastValue: integer("last_value").notNull().default(0),
});
