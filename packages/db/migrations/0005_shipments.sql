-- Shipments: custody handoff for samples moving between an origin site and a
-- receiving lab (CoC-06). packed -> in_transit -> received; each transition
-- records a transfer custody event per item, so a sample in transit keeps an
-- unbroken chain of custody (see packages/core/src/shipment.ts, ADR-0007).

CREATE TABLE shipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL REFERENCES study(id),
  shipment_number text NOT NULL UNIQUE,
  origin_site_id uuid REFERENCES site(id),
  destination text NOT NULL,
  carrier text,
  tracking_number text,
  status text NOT NULL DEFAULT 'packed'
    CHECK (status IN ('packed', 'in_transit', 'received', 'cancelled')),
  shipped_at timestamptz,
  received_at timestamptz,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
COMMENT ON TABLE shipment IS
  'Custody handoff for in-transit samples (CoC-06). packed -> in_transit -> received; cancelled is reserved. Each transition records a transfer custody event per item.';
--> statement-breakpoint
COMMENT ON COLUMN shipment.study_id IS
  'Audit chain scope (ADR-0002) and study filter; a shipment moves one study''s samples.';
--> statement-breakpoint

CREATE TABLE shipment_item (
  shipment_id uuid NOT NULL REFERENCES shipment(id),
  sample_id uuid NOT NULL REFERENCES sample(id),
  -- Denormalized for the per-study audit chain scope (ADR-0002), as custody_event does.
  study_id uuid NOT NULL REFERENCES study(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (shipment_id, sample_id)
);
--> statement-breakpoint
CREATE INDEX shipment_item_sample_lookup ON shipment_item (sample_id);
--> statement-breakpoint

-- Per-study shipment number allocator. Operational (mutable, not audited),
-- like accession_counter; shipment.shipment_number's unique constraint is what
-- guarantees identity.
CREATE TABLE shipment_counter (
  study_id uuid PRIMARY KEY REFERENCES study(id),
  last_value integer NOT NULL DEFAULT 0
);
--> statement-breakpoint

-- A sample handed to a carrier is neither in storage nor available (CoC-06).
ALTER TABLE sample DROP CONSTRAINT sample_status_check;
--> statement-breakpoint
ALTER TABLE sample ADD CONSTRAINT sample_status_check
  CHECK (status IN ('registered', 'in_storage', 'in_testing', 'in_transit', 'depleted', 'on_hold', 'disposed'));
--> statement-breakpoint

-- Audit both regulated tables to the per-study chain (the lims_audit function
-- and least-privilege grants come from 0001/0002).
CREATE TRIGGER shipment_audit AFTER INSERT OR UPDATE OR DELETE ON shipment
  FOR EACH ROW EXECUTE FUNCTION lims_audit();
--> statement-breakpoint
CREATE TRIGGER shipment_item_audit AFTER INSERT OR UPDATE OR DELETE ON shipment_item
  FOR EACH ROW EXECUTE FUNCTION lims_audit();
--> statement-breakpoint

-- shipment.send: pack and dispatch from the origin. shipment.receive: accept
-- at the destination (the receiving desk). Split models the site -> central
-- separation of duties. Keep in sync with PERMISSIONS in
-- packages/core/src/permissions.ts.
INSERT INTO role_permission (role_id, permission)
SELECT r.id, p.permission
FROM role r
JOIN (VALUES
  ('lab_admin', 'shipment.send'),
  ('lab_admin', 'shipment.receive'),
  ('lab_manager', 'shipment.send'),
  ('lab_manager', 'shipment.receive'),
  ('technician', 'shipment.send'),
  ('technician', 'shipment.receive'),
  ('accessioner', 'shipment.receive')
) AS p(role_name, permission) ON p.role_name = r.name;
