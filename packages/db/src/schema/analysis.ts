import {
  boolean,
  char,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth.js";
import { samples } from "./samples.js";
import { studies } from "./studies.js";

export const analysisServices = pgTable("analysis_service", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  unit: text("unit"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Acceptance criteria for a service (ADR-0017): a numeric range (lower/upper) or
// a qualitative expected value. Superseded, never edited in place, so history
// is retained. Lab-wide, like the service catalog.
export const analysisSpecifications = pgTable(
  "analysis_specification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => analysisServices.id),
    unit: text("unit"),
    lowerLimit: numeric("lower_limit"),
    upperLimit: numeric("upper_limit"),
    expectedValue: text("expected_value"),
    active: boolean("active").notNull().default(true),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("analysis_specification_service_lookup").on(t.serviceId)],
);

export const analysisRequests = pgTable(
  "analysis_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sampleId: uuid("sample_id")
      .notNull()
      .references(() => samples.id),
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => analysisServices.id),
    status: text("status").notNull().default("ordered"),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("analysis_request_sample_lookup").on(t.sampleId)],
);

export const results = pgTable(
  "result",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => analysisRequests.id),
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id),
    version: integer("version").notNull(),
    value: text("value").notNull(),
    unit: text("unit"),
    status: text("status").notNull(),
    qcStatus: text("qc_status").notNull().default("not_evaluated"),
    reasonForChange: text("reason_for_change"),
    enteredBy: uuid("entered_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.requestId, t.version)],
);

export const signatures = pgTable("signature", {
  id: uuid("id").primaryKey().defaultRandom(),
  requestId: uuid("request_id")
    .notNull()
    .references(() => analysisRequests.id),
  resultId: uuid("result_id")
    .notNull()
    .references(() => results.id),
  studyId: uuid("study_id")
    .notNull()
    .references(() => studies.id),
  signerId: uuid("signer_id")
    .notNull()
    .references(() => users.id),
  meaning: text("meaning").notNull(),
  recordHash: char("record_hash", { length: 64 }).notNull(),
  signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
  invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
  invalidatedReason: text("invalidated_reason"),
});
