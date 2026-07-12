-- QC control samples, first slice (ADR-0019): a control material catalog with an
-- established mean/SD per analysis service, and control measurements recorded on
-- a worksheet run, evaluated at entry with single-point Westgard rules
-- (1-2s warning / 1-3s reject). Builds on the QC module (ADR-0017) and the
-- worksheet run (ADR-0018). Multi-observation Westgard rules (2-2s, R-4s, 4-1s,
-- 10-x) need paired/historical control data and are deferred to a later slice.
-- Logic lives in packages/core/src/qc-control.ts.
--
-- NOTE FOR HUMAN REVIEW: the 1-2s (|z| > 2 -> warning) and 1-3s (|z| > 3 ->
-- reject) thresholds are Westgard's published single-rule definitions. Verify
-- against an authoritative Westgard reference before relying on them clinically.

-- A QC control material for a service: an established target mean and SD for a
-- given control level and lot. Lab-wide, like the analysis_service catalog and
-- analysis_specification it sits beside, so it audits to the `global` chain.
-- Superseded, never edited in place (a new mean/SD deactivates the prior row),
-- so a measurement's verdict can always be traced to the target in force.
CREATE TABLE control_material (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES analysis_service(id),
  -- Free-text control level label (e.g. 'low', 'normal', 'high'); levels are not
  -- an enum because assays name them differently.
  level text NOT NULL,
  lot_number text NOT NULL,
  expiry date,
  target_mean numeric NOT NULL,
  target_sd numeric NOT NULL CHECK (target_sd > 0),
  unit text,
  active boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
COMMENT ON TABLE control_material IS
  'A QC control material (level + lot) with an established target mean/SD for a service. Superseded, never edited. Lab-wide; global chain (ADR-0019).';
--> statement-breakpoint
COMMENT ON COLUMN control_material.target_sd IS
  'Established SD of the control; the denominator of the z-score. Must be > 0 (ADR-0019).';
--> statement-breakpoint
CREATE INDEX control_material_service_lookup ON control_material (service_id);
--> statement-breakpoint
CREATE TRIGGER control_material_audit
  AFTER INSERT OR UPDATE OR DELETE ON control_material
  FOR EACH ROW EXECUTE FUNCTION lims_audit();
--> statement-breakpoint

-- A control measurement recorded during a worksheet run. Append-only (no
-- UPDATE/DELETE): a mis-entry is corrected by recording another measurement,
-- never by editing. z_score and verdict are computed at entry against the
-- control's target and frozen on the row (ADR-0019).
CREATE TABLE qc_measurement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worksheet_id uuid NOT NULL REFERENCES worksheet(id),
  control_material_id uuid NOT NULL REFERENCES control_material(id),
  -- Denormalized for the per-study audit chain scope (ADR-0002), as worksheet_item does.
  study_id uuid NOT NULL REFERENCES study(id),
  value numeric NOT NULL,
  z_score numeric NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('accept', 'warning', 'reject')),
  measured_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
COMMENT ON TABLE qc_measurement IS
  'A control measurement on a worksheet run; z-score and Westgard verdict frozen at entry. Append-only (ADR-0019).';
--> statement-breakpoint
COMMENT ON COLUMN qc_measurement.verdict IS
  'Single-point Westgard verdict at entry: accept / warning (1-2s) / reject (1-3s) (ADR-0019).';
--> statement-breakpoint
CREATE INDEX qc_measurement_worksheet_lookup ON qc_measurement (worksheet_id);
--> statement-breakpoint
CREATE INDEX qc_measurement_control_lookup ON qc_measurement (control_material_id);
--> statement-breakpoint

-- Append-only guard, mirroring result/custody_event: reject UPDATE and DELETE so
-- a recorded QC measurement and its verdict cannot be rewritten.
CREATE TRIGGER qc_measurement_no_mutate
  BEFORE UPDATE OR DELETE ON qc_measurement
  FOR EACH ROW EXECUTE FUNCTION lims_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER qc_measurement_audit
  AFTER INSERT ON qc_measurement
  FOR EACH ROW EXECUTE FUNCTION lims_audit();
--> statement-breakpoint

-- Authority reuses existing grants (ADR-0019): defining a control material is a
-- config act (control_material.manage -> spec.manage holders), recording a
-- measurement is bench work on a run (qc_measurement -> worksheet.manage
-- holders). No new permission is introduced.
