import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const studies = pgTable("study", {
  id: uuid("id").primaryKey().defaultRandom(),
  oid: text("oid").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sites = pgTable(
  "site",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id),
    oid: text("oid").notNull(),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.studyId, t.oid)],
);
