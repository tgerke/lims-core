-- Calculated results (ADR-0020): a service can define a formula that computes
-- its result from other services' results on the same sample (e.g. a ratio or
-- an index). Builds on the analysis_service / result model (ADR-0017). The
-- formula is a restricted arithmetic expression over named input variables,
-- each bound to an input analysis service. Superseded, never edited in place,
-- like analysis_specification, so a calculated result traces to the formula in
-- force. Lab-wide (the service catalog has no study_id), audits to `global`.
-- Logic lives in packages/core/src/calculation.ts.

CREATE TABLE analysis_calculation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid NOT NULL REFERENCES analysis_service(id),
  -- Restricted arithmetic over the input variables: + - * / ( ) and numbers.
  -- Parsed and evaluated by evaluateExpression (no eval); see calculation.ts.
  expression text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
COMMENT ON TABLE analysis_calculation IS
  'A formula computing a service''s result from other services on the same sample. Superseded, never edited. Lab-wide; global chain (ADR-0020).';
--> statement-breakpoint
CREATE INDEX analysis_calculation_service_lookup ON analysis_calculation (service_id);
--> statement-breakpoint

-- The formula's inputs: each variable name in the expression bound to the
-- analysis service whose current result supplies its value.
CREATE TABLE analysis_calculation_input (
  calculation_id uuid NOT NULL REFERENCES analysis_calculation(id),
  variable text NOT NULL,
  input_service_id uuid NOT NULL REFERENCES analysis_service(id),
  PRIMARY KEY (calculation_id, variable)
);
--> statement-breakpoint

CREATE TRIGGER analysis_calculation_audit
  AFTER INSERT OR UPDATE OR DELETE ON analysis_calculation
  FOR EACH ROW EXECUTE FUNCTION lims_audit();
--> statement-breakpoint
CREATE TRIGGER analysis_calculation_input_audit
  AFTER INSERT OR UPDATE OR DELETE ON analysis_calculation_input
  FOR EACH ROW EXECUTE FUNCTION lims_audit();
--> statement-breakpoint

-- Whether a result version was measured at the bench or computed from a formula.
-- result is append-only (rejects UPDATE/DELETE); adding a column is owner DDL,
-- new rows carry the value, existing rows default to 'measured'.
ALTER TABLE result ADD COLUMN source text NOT NULL DEFAULT 'measured'
  CHECK (source IN ('measured', 'calculated'));
--> statement-breakpoint
COMMENT ON COLUMN result.source IS
  'measured (entered at the bench) or calculated (computed from a formula, ADR-0020).';
--> statement-breakpoint

-- Authority reuses existing grants (ADR-0020): defining a formula is a config
-- act (spec.manage holders, lab-wide), computing a result is result entry
-- (result.enter). No new permission is introduced.
