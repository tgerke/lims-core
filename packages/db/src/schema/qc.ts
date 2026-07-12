import { boolean, date, index, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { analysisServices } from "./analysis.js";
import { users } from "./auth.js";
import { studies } from "./studies.js";
import { worksheets } from "./worksheets.js";

// QC control samples (ADR-0019): a control material catalog with an established
// mean/SD per service, and control measurements recorded on a worksheet run and
// evaluated at entry with Westgard rules — the single-point rules (1-2s / 1-3s)
// plus the sequential multi-observation rejection rules 2-2s / 4-1s / 10-x over
// prior measurements of the same control material (ADR-0023). Logic in
// packages/core/src/qc-control.ts.

// Lab-wide, like the service catalog and specifications it sits beside.
// Superseded, never edited in place, so a verdict traces to the target in force.
export const controlMaterials = pgTable(
  "control_material",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => analysisServices.id),
    level: text("level").notNull(),
    lotNumber: text("lot_number").notNull(),
    expiry: date("expiry"),
    targetMean: numeric("target_mean").notNull(),
    targetSd: numeric("target_sd").notNull(),
    unit: text("unit"),
    active: boolean("active").notNull().default(true),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull().defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("control_material_service_lookup").on(t.serviceId)],
);

// A control measurement on a run; z-score and verdict frozen at entry.
// Append-only (the DB rejects UPDATE/DELETE); a mis-entry is corrected by
// recording another measurement.
export const qcMeasurements = pgTable(
  "qc_measurement",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    worksheetId: uuid("worksheet_id")
      .notNull()
      .references(() => worksheets.id),
    controlMaterialId: uuid("control_material_id")
      .notNull()
      .references(() => controlMaterials.id),
    // Denormalized for the per-study audit chain scope (ADR-0002).
    studyId: uuid("study_id")
      .notNull()
      .references(() => studies.id),
    value: numeric("value").notNull(),
    zScore: numeric("z_score").notNull(),
    verdict: text("verdict").notNull(),
    // The Westgard rule that produced the verdict; null on accept (ADR-0023).
    rule: text("rule"),
    measuredBy: uuid("measured_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("qc_measurement_worksheet_lookup").on(t.worksheetId)],
);
