-- Certificate of Analysis (ADR-0022): a formal, immutable snapshot of a
-- sample's released analytical results, issued by an authorized user and
-- rendered to PDF on demand. The capstone of the analytical module — it
-- consumes results (ADR-0017), their spec verdicts, and QC (ADR-0019/0021).
-- Study-scoped, so it rides the per-study audit chain (ADR-0002). Logic in
-- packages/core/src/coa.ts; PDF rendering in apps/api/src/coa-pdf.ts.

CREATE TABLE certificate_of_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id uuid NOT NULL REFERENCES sample(id),
  study_id uuid NOT NULL REFERENCES study(id),
  coa_number text NOT NULL UNIQUE,
  -- The exact certified data at issue time (analytes, values, verdicts, issuer).
  -- The PDF is a deterministic rendering of this snapshot; content_hash binds it.
  snapshot jsonb NOT NULL,
  content_hash char(64) NOT NULL,
  issued_by uuid NOT NULL REFERENCES app_user(id),
  issued_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
COMMENT ON TABLE certificate_of_analysis IS
  'An immutable snapshot of a sample''s released results, issued as a Certificate of Analysis. Append-only; content_hash binds the rendered PDF (ADR-0022).';
--> statement-breakpoint
COMMENT ON COLUMN certificate_of_analysis.content_hash IS
  'sha256 of the canonical snapshot JSON; proves the PDF matches what was certified (ADR-0022).';
--> statement-breakpoint
CREATE INDEX certificate_of_analysis_sample_lookup ON certificate_of_analysis (sample_id);
--> statement-breakpoint

-- Per-study CoA number allocator, like shipment_counter / worksheet_counter.
CREATE TABLE coa_counter (
  study_id uuid PRIMARY KEY REFERENCES study(id),
  last_value integer NOT NULL DEFAULT 0
);
--> statement-breakpoint

-- Append-only: a certified document cannot be edited or deleted; a correction
-- is a newly issued CoA. Mirrors result / signature immutability.
CREATE TRIGGER certificate_of_analysis_no_mutate
  BEFORE UPDATE OR DELETE ON certificate_of_analysis
  FOR EACH ROW EXECUTE FUNCTION lims_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER certificate_of_analysis_audit
  AFTER INSERT ON certificate_of_analysis
  FOR EACH ROW EXECUTE FUNCTION lims_audit();
--> statement-breakpoint

-- Issuing a CoA is a senior release act, so it reuses result.sign (ADR-0022):
-- the authority already trusted to release results by e-signature. No new
-- permission is introduced.
