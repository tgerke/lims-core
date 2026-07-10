import { integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { studies } from "./studies.js";

export const storageUnits = pgTable("storage_unit", {
  id: uuid("id").primaryKey().defaultRandom(),
  parentId: uuid("parent_id"),
  studyId: uuid("study_id").references(() => studies.id),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  gridRows: integer("grid_rows"),
  gridCols: integer("grid_cols"),
  temperatureC: numeric("temperature_c"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
