-- Default lab roles and their permissions (P11-04). Deployments may add
-- roles; these six cover the standard division of responsibilities in a
-- trial biobank / clinical lab. Permission strings are defined in
-- packages/core/src/permissions.ts — keep in sync.

INSERT INTO role (name, description) VALUES
  ('lab_admin', 'Laboratory administrator: full control within a study, grants roles'),
  ('lab_manager', 'Supervises operations: manages the study, verifies and signs results, reviews audit trails'),
  ('technician', 'Bench work: accessions and stores samples, orders tests, enters results'),
  ('accessioner', 'Receiving desk: accessions and stores samples only'),
  ('monitor', 'External reviewer: reviews audit trails and custody records'),
  ('read_only', 'Read access through study membership; no capabilities');
--> statement-breakpoint

INSERT INTO role_permission (role_id, permission)
SELECT r.id, p.permission
FROM role r
JOIN (VALUES
  ('lab_admin', 'study.manage'),
  ('lab_admin', 'sample.accession'),
  ('lab_admin', 'sample.store'),
  ('lab_admin', 'order.create'),
  ('lab_admin', 'result.enter'),
  ('lab_admin', 'result.verify'),
  ('lab_admin', 'result.sign'),
  ('lab_admin', 'audit.review'),
  ('lab_admin', 'roles.grant'),
  ('lab_manager', 'study.manage'),
  ('lab_manager', 'sample.accession'),
  ('lab_manager', 'sample.store'),
  ('lab_manager', 'order.create'),
  ('lab_manager', 'result.enter'),
  ('lab_manager', 'result.verify'),
  ('lab_manager', 'result.sign'),
  ('lab_manager', 'audit.review'),
  ('technician', 'sample.accession'),
  ('technician', 'sample.store'),
  ('technician', 'order.create'),
  ('technician', 'result.enter'),
  ('accessioner', 'sample.accession'),
  ('accessioner', 'sample.store'),
  ('monitor', 'audit.review')
) AS p(role_name, permission) ON p.role_name = r.name;
