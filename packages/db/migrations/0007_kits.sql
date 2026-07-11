-- Collection kits: empty specimen containers assembled centrally and sent out to
-- a site so it can collect specimens. This is the outbound-logistics counterpart
-- to shipments (which move filled samples inbound); ADR-0007 deferred it as
-- logistics, not sample custody. A kit carries no samples, so there are no
-- custody_event rows — but the kit's own lifecycle is audited so dispatch is
-- attributable. Logic lives in packages/core/src/kit.ts (ADR-0011).

CREATE TABLE kit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL REFERENCES study(id),
  kit_number text NOT NULL UNIQUE,
  destination_site_id uuid NOT NULL REFERENCES site(id),
  status text NOT NULL DEFAULT 'assembled'
    CHECK (status IN ('assembled', 'shipped', 'delivered', 'cancelled')),
  carrier text,
  tracking_number text,
  notes text,
  shipped_at timestamptz,
  delivered_at timestamptz,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
COMMENT ON TABLE kit IS
  'Outbound collection kit (empty containers) sent to a site. assembled -> shipped -> delivered; cancelled reserved. Logistics, not sample custody (ADR-0011).';
--> statement-breakpoint
COMMENT ON COLUMN kit.study_id IS
  'Audit chain scope (ADR-0002) and study filter; a kit belongs to one study.';
--> statement-breakpoint

CREATE TABLE kit_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kit_id uuid NOT NULL REFERENCES kit(id),
  study_id uuid NOT NULL REFERENCES study(id),
  container_type text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX kit_item_kit_lookup ON kit_item (kit_id);
--> statement-breakpoint

-- Per-study kit number allocator, like accession_counter / shipment_counter.
CREATE TABLE kit_counter (
  study_id uuid PRIMARY KEY REFERENCES study(id),
  last_value integer NOT NULL DEFAULT 0
);
--> statement-breakpoint

-- Audit the kit lifecycle to the per-study chain (kit is mutable, not
-- append-only; the trigger records before/after on each transition).
CREATE TRIGGER kit_audit AFTER INSERT OR UPDATE OR DELETE ON kit
  FOR EACH ROW EXECUTE FUNCTION lims_audit();
--> statement-breakpoint
CREATE TRIGGER kit_item_audit AFTER INSERT OR UPDATE OR DELETE ON kit_item
  FOR EACH ROW EXECUTE FUNCTION lims_audit();
--> statement-breakpoint

-- kit.manage: assemble, ship, and mark a kit delivered. Kits are lower-stakes
-- than sample custody, so one authority covers the lifecycle. Keep in sync with
-- PERMISSIONS in packages/core/src/permissions.ts.
INSERT INTO role_permission (role_id, permission)
SELECT r.id, p.permission
FROM role r
JOIN (VALUES
  ('lab_admin', 'kit.manage'),
  ('lab_manager', 'kit.manage'),
  ('technician', 'kit.manage')
) AS p(role_name, permission) ON p.role_name = r.name;
