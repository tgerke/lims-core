-- Consent-withdrawal holds and disposal (CoC-05). When a subject withdraws
-- consent (or a specimen must be quarantined), its samples are placed on hold —
-- blocked from aliquoting, storage moves, and shipment — and eventually
-- disposed, with every transition captured in the append-only custody chain.
-- The status values ('on_hold', 'disposed') and custody event types
-- ('hold', 'hold_release', 'disposal') were reserved in 0000_init.sql; this
-- migration adds the state a release needs plus the permissions. Logic lives in
-- packages/core/src/hold.ts (ADR-0009).

-- Remembers the status a sample held before the hold so hold_release can restore
-- it exactly (a stored sample returns to in_storage, a bare one to registered).
-- NULL whenever the sample is not on hold.
ALTER TABLE sample ADD COLUMN pre_hold_status text;
--> statement-breakpoint
COMMENT ON COLUMN sample.pre_hold_status IS
  'CoC-05: status captured at hold, restored on hold_release. NULL unless on_hold. Operational-mutable; changes are captured by the sample audit trigger.';
--> statement-breakpoint

-- sample.hold: place and release holds (quarantine, consent withdrawal).
-- sample.dispose: the terminal, destructive step — a higher bar, held by
-- supervisors only, mirroring the send/receive separation. Keep in sync with
-- PERMISSIONS in packages/core/src/permissions.ts.
INSERT INTO role_permission (role_id, permission)
SELECT r.id, p.permission
FROM role r
JOIN (VALUES
  ('lab_admin', 'sample.hold'),
  ('lab_admin', 'sample.dispose'),
  ('lab_manager', 'sample.hold'),
  ('lab_manager', 'sample.dispose'),
  ('technician', 'sample.hold')
) AS p(role_name, permission) ON p.role_name = r.name;
