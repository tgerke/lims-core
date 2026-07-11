import {
  boolean,
  date,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { storageUnits } from "./storage.js";

// Reagent/consumable inventory (ADR-0016). Lab-wide, not study-scoped: a lab
// shares reagents across studies, so these tables carry no study_id and audit
// to the `global` chain scope (lims_audit falls back to it for rows without a
// study_id). Logic lives in packages/core/src/inventory.ts.

export const inventoryItems = pgTable("inventory_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  catalogNumber: text("catalog_number"),
  vendor: text("vendor"),
  category: text("category").notNull().default("reagent"),
  unit: text("unit").notNull(),
  active: boolean("active").notNull().default(true),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inventoryLots = pgTable(
  "inventory_lot",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => inventoryItems.id),
    lotNumber: text("lot_number").notNull(),
    expiryDate: date("expiry_date"),
    receivedDate: date("received_date").notNull(),
    quantityReceived: numeric("quantity_received").notNull(),
    quantityRemaining: numeric("quantity_remaining").notNull(),
    status: text("status").notNull().default("available"),
    storageUnitId: uuid("storage_unit_id").references(() => storageUnits.id),
    notes: text("notes"),
    receivedBy: uuid("received_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.itemId, t.lotNumber)],
);

// Append-only quantity ledger: the traceability spine. quantity_remaining on
// the lot is the denormalized running total; this is the source of truth.
export const inventoryTransactions = pgTable("inventory_transaction", {
  id: uuid("id").primaryKey().defaultRandom(),
  lotId: uuid("lot_id")
    .notNull()
    .references(() => inventoryLots.id),
  delta: numeric("delta").notNull(),
  reason: text("reason").notNull(),
  note: text("note"),
  performedBy: uuid("performed_by")
    .notNull()
    .references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
