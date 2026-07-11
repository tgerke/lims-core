-- Reagent/consumable inventory: catalog items, received lots (with lot number,
-- expiry, on-hand quantity), and an append-only consumption ledger. Needed once
-- real assays run, so consumption is attributable and lots are traceable.
--
-- Lab-wide, not study-scoped (ADR-0016): a lab shares reagents across studies,
-- so these tables carry no study_id and audit to the `global` chain scope —
-- lims_audit() already falls back to 'global' for rows without a study_id.
-- Logic lives in packages/core/src/inventory.ts.

CREATE TABLE inventory_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  catalog_number text,
  vendor text,
  category text NOT NULL DEFAULT 'reagent'
    CHECK (category IN ('reagent', 'consumable', 'control', 'standard')),
  unit text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
COMMENT ON TABLE inventory_item IS
  'Catalog entry for a reagent/consumable. Lab-wide (no study_id); audits to the global chain (ADR-0016).';
--> statement-breakpoint

CREATE TABLE inventory_lot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES inventory_item(id),
  lot_number text NOT NULL,
  expiry_date date,
  received_date date NOT NULL,
  quantity_received numeric NOT NULL CHECK (quantity_received > 0),
  quantity_remaining numeric NOT NULL CHECK (quantity_remaining >= 0),
  status text NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'quarantine', 'expired', 'depleted', 'discarded')),
  storage_unit_id uuid REFERENCES storage_unit(id),
  notes text,
  received_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, lot_number)
);
--> statement-breakpoint
COMMENT ON TABLE inventory_lot IS
  'A received lot of an item. quantity_remaining is a denormalized running total; the inventory_transaction ledger is the source of truth.';
--> statement-breakpoint
CREATE INDEX inventory_lot_item_lookup ON inventory_lot (item_id);
--> statement-breakpoint

-- Append-only quantity ledger (P11-01/P11-02 immutability, reusing the
-- lims_reject_mutation guard the result/custody tables use): every receive,
-- consumption, adjustment, and discard is a permanent, attributable row.
CREATE TABLE inventory_transaction (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id uuid NOT NULL REFERENCES inventory_lot(id),
  delta numeric NOT NULL,
  reason text NOT NULL
    CHECK (reason IN ('received', 'consumed', 'adjusted', 'discarded')),
  note text,
  performed_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
COMMENT ON TABLE inventory_transaction IS
  'Append-only reagent quantity ledger; delta<0 consumes, >0 receives/adjusts up. Immutable (P11-01/P11-02).';
--> statement-breakpoint
CREATE INDEX inventory_transaction_lot_lookup ON inventory_transaction (lot_id);
--> statement-breakpoint

CREATE TRIGGER inventory_transaction_append_only
  BEFORE UPDATE OR DELETE ON inventory_transaction
  FOR EACH ROW EXECUTE FUNCTION lims_reject_mutation();
--> statement-breakpoint

-- Audit item and lot lifecycle (mutable), and each ledger append.
CREATE TRIGGER inventory_item_audit AFTER INSERT OR UPDATE OR DELETE ON inventory_item
  FOR EACH ROW EXECUTE FUNCTION lims_audit();
--> statement-breakpoint
CREATE TRIGGER inventory_lot_audit AFTER INSERT OR UPDATE OR DELETE ON inventory_lot
  FOR EACH ROW EXECUTE FUNCTION lims_audit();
--> statement-breakpoint
CREATE TRIGGER inventory_transaction_audit AFTER INSERT ON inventory_transaction
  FOR EACH ROW EXECUTE FUNCTION lims_audit();
--> statement-breakpoint

-- inventory.manage: catalog items, receive lots, consume, adjust, discard.
-- Lab-wide inventory has no study to scope a grant to, so the route authorizes
-- on holding this in ANY study (hasPermissionAnywhere) — see ADR-0016. Keep in
-- sync with PERMISSIONS in packages/core/src/permissions.ts.
INSERT INTO role_permission (role_id, permission)
SELECT r.id, p.permission
FROM role r
JOIN (VALUES
  ('lab_admin', 'inventory.manage'),
  ('lab_manager', 'inventory.manage'),
  ('technician', 'inventory.manage')
) AS p(role_name, permission) ON p.role_name = r.name;
