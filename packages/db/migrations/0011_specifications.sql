-- Analytical/QC first slice (ADR-0017): acceptance criteria per analysis
-- service, evaluated automatically at result entry to flag in-spec vs.
-- out-of-spec. Builds on analysis_service/analysis_request/result. Worksheets,
-- QC control samples, Westgard rules, and Certificate-of-Analysis are deferred
-- to later slices. Logic lives in packages/core/src/specification.ts.
--
-- Lab-wide, like the analysis_service catalog it hangs off (services carry no
-- study_id), so specifications audit to the `global` chain.

CREATE TABLE analysis_specification (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES analysis_service(id),
  unit text,
  lower_limit numeric,
  upper_limit numeric,
  expected_value text,
  active boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- A spec is either a numeric range (a bound on either side) or a qualitative
  -- expected value, never both, and never empty.
  CHECK (
    (expected_value IS NOT NULL AND lower_limit IS NULL AND upper_limit IS NULL)
    OR (expected_value IS NULL AND (lower_limit IS NOT NULL OR upper_limit IS NOT NULL))
  )
);
--> statement-breakpoint
COMMENT ON TABLE analysis_specification IS
  'Acceptance criteria for an analysis service. Kept as rows and superseded (never edited in place) so spec history is retained. Lab-wide; global chain (ADR-0017).';
--> statement-breakpoint
CREATE INDEX analysis_specification_service_lookup ON analysis_specification (service_id);
--> statement-breakpoint
CREATE TRIGGER analysis_specification_audit
  AFTER INSERT OR UPDATE OR DELETE ON analysis_specification
  FOR EACH ROW EXECUTE FUNCTION lims_audit();
--> statement-breakpoint

-- QC verdict computed against the active spec at result entry. result is
-- append-only (rejects UPDATE/DELETE); adding a column is owner DDL, and new
-- rows carry the computed value. Existing rows default to 'not_evaluated'.
ALTER TABLE result ADD COLUMN qc_status text NOT NULL DEFAULT 'not_evaluated'
  CHECK (qc_status IN ('pass', 'out_of_spec', 'not_evaluated'));
--> statement-breakpoint
COMMENT ON COLUMN result.qc_status IS
  'Spec evaluation at entry: pass / out_of_spec / not_evaluated (ADR-0017).';
--> statement-breakpoint

-- spec.manage: define acceptance criteria. A supervisory config act, so
-- lab_admin and lab_manager only (not bench technicians). Lab-wide, so the
-- route authorizes on holding it in any study (requirePermissionAnywhere).
-- Keep in sync with PERMISSIONS in packages/core/src/permissions.ts.
INSERT INTO role_permission (role_id, permission)
SELECT r.id, p.permission
FROM role r
JOIN (VALUES
  ('lab_admin', 'spec.manage'),
  ('lab_manager', 'spec.manage')
) AS p(role_name, permission) ON p.role_name = r.name;
