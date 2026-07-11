-- Aliquot workflow: sample quantity tracking (CoC-04). Quantity is optional on
-- a sample; when present, aliquoting deducts it and conserves the total across
-- parent and children (see packages/core/src/aliquot.ts, ADR-0006).

ALTER TABLE sample
  ADD COLUMN quantity numeric CHECK (quantity >= 0),
  ADD COLUMN quantity_unit text,
  ADD COLUMN initial_quantity numeric CHECK (initial_quantity >= 0),
  ADD CONSTRAINT sample_quantity_unit_needs_quantity
    CHECK (quantity_unit IS NULL OR quantity IS NOT NULL);
--> statement-breakpoint
COMMENT ON COLUMN sample.quantity IS
  'Remaining amount (CoC-04). NULL = not tracked. Operational-mutable: aliquoting deducts it and its changes are captured by the sample audit trigger (AFTER UPDATE) — no separate audit path.';
--> statement-breakpoint
COMMENT ON COLUMN sample.initial_quantity IS
  'Amount at accession, set once for a "X of Y remaining" view (CoC-04). Never changed after creation.';
--> statement-breakpoint

-- sample.aliquot: authority to split a sample into child aliquots. Granted to
-- the same roles that hold sample.store (bench + supervisory). Keep in sync
-- with PERMISSIONS in packages/core/src/permissions.ts.
INSERT INTO role_permission (role_id, permission)
SELECT r.id, 'sample.aliquot'
FROM role r
WHERE r.name IN ('lab_admin', 'lab_manager', 'technician');
