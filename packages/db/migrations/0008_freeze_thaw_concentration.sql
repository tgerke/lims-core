-- Freeze-thaw cycle counts and concentration (aliquot follow-on, ADR-0013).
-- Both are operational sample attributes: their changes are captured by the
-- existing sample AFTER UPDATE audit trigger, like quantity (CoC-04), so no new
-- custody event type or permission is introduced. Logic lives in
-- packages/core/src/measurement.ts; the endpoints reuse sample.aliquot as the
-- bench-handling authority.

ALTER TABLE sample ADD COLUMN freeze_thaw_count integer NOT NULL DEFAULT 0
  CHECK (freeze_thaw_count >= 0);
--> statement-breakpoint
ALTER TABLE sample ADD COLUMN concentration numeric CHECK (concentration >= 0);
--> statement-breakpoint
ALTER TABLE sample ADD COLUMN concentration_unit text
  CHECK (concentration_unit IS NULL OR concentration IS NOT NULL);
--> statement-breakpoint
COMMENT ON COLUMN sample.freeze_thaw_count IS
  'Number of freeze-thaw cycles the specimen has undergone; incremented per thaw. Operational-mutable, audited by the sample trigger (ADR-0013).';
--> statement-breakpoint
COMMENT ON COLUMN sample.concentration IS
  'Measured concentration (e.g. nucleic-acid yield). Operational-mutable, audited by the sample trigger (ADR-0013).';
