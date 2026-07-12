-- Worksheets/runs: batch analysis orders for an instrument run and record the
-- reagent lots the run consumes. This closes the seam between the analytical QC
-- module (ADR-0017) and reagent inventory (ADR-0016): running a worksheet draws
-- from a lot, and worksheet_reagent ties that draw to the exact append-only
-- ledger row. Study-scoped, so it rides the per-study audit chain (ADR-0002).
-- Logic lives in packages/core/src/worksheet.ts (ADR-0018).

CREATE TABLE worksheet (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL REFERENCES study(id),
  worksheet_number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'in_progress', 'completed', 'cancelled')),
  instrument text,
  notes text,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
COMMENT ON TABLE worksheet IS
  'A batch run of analysis orders on an instrument. draft -> in_progress -> completed; cancelled reserved (ADR-0018).';
--> statement-breakpoint
COMMENT ON COLUMN worksheet.study_id IS
  'Audit chain scope (ADR-0002) and study filter; a worksheet batches one study''s orders.';
--> statement-breakpoint

CREATE TABLE worksheet_item (
  worksheet_id uuid NOT NULL REFERENCES worksheet(id),
  request_id uuid NOT NULL REFERENCES analysis_request(id),
  -- Denormalized for the per-study audit chain scope (ADR-0002), as shipment_item does.
  study_id uuid NOT NULL REFERENCES study(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (worksheet_id, request_id)
);
--> statement-breakpoint
CREATE INDEX worksheet_item_request_lookup ON worksheet_item (request_id);
--> statement-breakpoint

-- The seam (ADR-0016 <-> ADR-0018): a run's reagent draw. transaction_id points
-- at the append-only inventory_transaction that recorded the consumption, so a
-- run's reagent usage is fully traceable to the ledger.
CREATE TABLE worksheet_reagent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  worksheet_id uuid NOT NULL REFERENCES worksheet(id),
  lot_id uuid NOT NULL REFERENCES inventory_lot(id),
  transaction_id uuid NOT NULL REFERENCES inventory_transaction(id),
  study_id uuid NOT NULL REFERENCES study(id),
  quantity numeric NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX worksheet_reagent_worksheet_lookup ON worksheet_reagent (worksheet_id);
--> statement-breakpoint

-- Per-study worksheet number allocator, like shipment_counter / kit_counter.
CREATE TABLE worksheet_counter (
  study_id uuid PRIMARY KEY REFERENCES study(id),
  last_value integer NOT NULL DEFAULT 0
);
--> statement-breakpoint

-- Audit the run and its links to the per-study chain (worksheet is mutable; the
-- trigger records before/after on each transition).
CREATE TRIGGER worksheet_audit AFTER INSERT OR UPDATE OR DELETE ON worksheet
  FOR EACH ROW EXECUTE FUNCTION lims_audit();
--> statement-breakpoint
CREATE TRIGGER worksheet_item_audit AFTER INSERT OR UPDATE OR DELETE ON worksheet_item
  FOR EACH ROW EXECUTE FUNCTION lims_audit();
--> statement-breakpoint
CREATE TRIGGER worksheet_reagent_audit AFTER INSERT OR UPDATE OR DELETE ON worksheet_reagent
  FOR EACH ROW EXECUTE FUNCTION lims_audit();
--> statement-breakpoint

-- worksheet.manage: assemble a run, record reagent use, and drive its
-- lifecycle. Bench work, so lab_admin, lab_manager, and technician. Keep in
-- sync with PERMISSIONS in packages/core/src/permissions.ts.
INSERT INTO role_permission (role_id, permission)
SELECT r.id, p.permission
FROM role r
JOIN (VALUES
  ('lab_admin', 'worksheet.manage'),
  ('lab_manager', 'worksheet.manage'),
  ('technician', 'worksheet.manage')
) AS p(role_name, permission) ON p.role_name = r.name;
