import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { sites, studies } from "./studies.js";

export const kits = pgTable("kit", {
  id: uuid("id").primaryKey().defaultRandom(),
  studyId: uuid("study_id")
    .notNull()
    .references(() => studies.id),
  kitNumber: text("kit_number").notNull().unique(),
  destinationSiteId: uuid("destination_site_id")
    .notNull()
    .references(() => sites.id),
  status: text("status").notNull().default("assembled"),
  carrier: text("carrier"),
  trackingNumber: text("tracking_number"),
  notes: text("notes"),
  shippedAt: timestamp("shipped_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const kitItems = pgTable("kit_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  kitId: uuid("kit_id")
    .notNull()
    .references(() => kits.id),
  studyId: uuid("study_id")
    .notNull()
    .references(() => studies.id),
  containerType: text("container_type").notNull(),
  quantity: integer("quantity").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const kitCounters = pgTable("kit_counter", {
  studyId: uuid("study_id")
    .primaryKey()
    .references(() => studies.id),
  lastValue: integer("last_value").notNull().default(0),
});
