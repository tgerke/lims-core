-- Least-privilege runtime role for the API (ports ctms-core 0004_app_role.sql).
-- lims_app holds DML only: no TRUNCATE, no DDL (no CREATE on the schema), and
-- no trigger disablement (requires table ownership, which stays with the
-- migration role). Dev-grade password; a production deployment rotates it
-- with ALTER ROLE.
DO $$ BEGIN
  CREATE ROLE lims_app LOGIN PASSWORD 'lims_app';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO lims_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lims_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO lims_app;
--> statement-breakpoint
-- Tables and sequences added by future migrations (run by the owning role)
-- inherit the same DML-only grants.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lims_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO lims_app;
--> statement-breakpoint
-- The audit trail is written only by the trigger, never by the role: with
-- SECURITY DEFINER the trigger function inserts as the table owner, and the
-- runtime role loses direct INSERT — it cannot fabricate audit events even
-- with a correctly recomputed hash chain (P11-01).
ALTER FUNCTION lims_audit() SECURITY DEFINER;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON audit_event FROM lims_app;
