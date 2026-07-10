-- lims-core schema foundation. Hand-written (not drizzle-kit generated): the
-- compliance machinery in 0001/0002 depends on exact shapes, and requirement
-- IDs (P11-xx = 21 CFR Part 11, CoC-xx = chain of custody) are threaded
-- through column comments for the traceability matrix
-- (docs/regulatory-traceability.md).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Identity & sessions (ported from edc-core 0000/0002/0008)
-- ---------------------------------------------------------------------------

CREATE TABLE app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  full_name text NOT NULL,
  password_hash text,
  oidc_subject text UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deactivated')),
  is_system_admin boolean NOT NULL DEFAULT false,
  failed_login_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
COMMENT ON COLUMN app_user.password_hash IS
  'Argon2id local credential; also verified for e-signature step-up (P11-06, §11.200(a)). NULL for OIDC-only accounts, which cannot sign until one is set.';
--> statement-breakpoint
COMMENT ON COLUMN app_user.failed_login_count IS
  'Consecutive failures toward lockout (P11-07, §11.300(d)); reset on success.';
--> statement-breakpoint

CREATE TABLE session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(id),
  token_hash text NOT NULL UNIQUE,
  auth_method text NOT NULL DEFAULT 'password' CHECK (auth_method IN ('password', 'oidc')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  ip text,
  user_agent text
);
--> statement-breakpoint
CREATE INDEX session_user_lookup ON session (user_id);
--> statement-breakpoint
COMMENT ON COLUMN session.token_hash IS
  'sha256 of the opaque bearer token; the raw token is never stored (P11-08).';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Study / site spine (shared platform identifiers; CTMS is the natural master)
-- ---------------------------------------------------------------------------

CREATE TABLE study (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oid text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE site (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL REFERENCES study(id),
  oid text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (study_id, oid)
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- RBAC: grant-based, study/site-scoped (ported from edc-core; P11-04)
-- ---------------------------------------------------------------------------

CREATE TABLE role (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT ''
);
--> statement-breakpoint

CREATE TABLE role_permission (
  role_id uuid NOT NULL REFERENCES role(id),
  permission text NOT NULL
);
--> statement-breakpoint
CREATE INDEX role_permission_lookup ON role_permission (role_id, permission);
--> statement-breakpoint

CREATE TABLE user_study_role (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(id),
  study_id uuid NOT NULL REFERENCES study(id),
  site_id uuid REFERENCES site(id),
  role_id uuid NOT NULL REFERENCES role(id),
  granted_by uuid NOT NULL REFERENCES app_user(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
--> statement-breakpoint
CREATE INDEX user_study_role_lookup ON user_study_role (user_id, study_id);
--> statement-breakpoint
COMMENT ON COLUMN user_study_role.site_id IS
  'NULL = study-wide grant; set = grant applies only at that site (P11-04).';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Storage hierarchy: facility → freezer → shelf → rack → box (CoC-03)
-- ---------------------------------------------------------------------------

CREATE TABLE storage_unit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES storage_unit(id),
  study_id uuid REFERENCES study(id),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('facility', 'freezer', 'shelf', 'rack', 'box')),
  grid_rows integer,
  grid_cols integer,
  temperature_c numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (parent_id, name)
);
--> statement-breakpoint
COMMENT ON COLUMN storage_unit.study_id IS
  'Optional study restriction; NULL units are shared infrastructure. Also the audit chain scope key: NULL rows audit to the global chain.';
--> statement-breakpoint
COMMENT ON COLUMN storage_unit.grid_rows IS
  'Boxes only: position grid (A1..). Positions are allocated against this capacity (CoC-03).';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Sample core (domain-neutral: biobank specimen or analytical sample)
-- ---------------------------------------------------------------------------

CREATE TABLE sample (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL REFERENCES study(id),
  site_id uuid NOT NULL REFERENCES site(id),
  accession_id text NOT NULL UNIQUE,
  sample_type text NOT NULL,
  status text NOT NULL DEFAULT 'registered'
    CHECK (status IN ('registered', 'in_storage', 'in_testing', 'depleted', 'on_hold', 'disposed')),
  subject_key text,
  study_event_oid text,
  collected_at timestamptz,
  received_at timestamptz,
  storage_unit_id uuid REFERENCES storage_unit(id),
  storage_position text,
  created_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- One occupant per box position (CoC-03).
CREATE UNIQUE INDEX sample_position_unique ON sample (storage_unit_id, storage_position)
  WHERE storage_unit_id IS NOT NULL AND storage_position IS NOT NULL;
--> statement-breakpoint
COMMENT ON COLUMN sample.subject_key IS
  'EDC subject reference ONLY — never PHI or clinical data (platform-spine rule). Custody begins at collection (CoC-01).';
--> statement-breakpoint
COMMENT ON COLUMN sample.status IS
  'on_hold / disposed back the reserved custody states (consent withdrawal propagation, CoC-05; logic deferred, states structural).';
--> statement-breakpoint

CREATE TABLE sample_lineage (
  parent_id uuid NOT NULL REFERENCES sample(id),
  child_id uuid NOT NULL REFERENCES sample(id),
  relation text NOT NULL CHECK (relation IN ('aliquot', 'derivation', 'pool')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (parent_id, child_id)
);
--> statement-breakpoint

-- Per-study accession number allocator. Operational (mutable, not audited):
-- it only hands out candidate numbers; sample.accession_id's unique
-- constraint is what guarantees identity.
CREATE TABLE accession_counter (
  study_id uuid PRIMARY KEY REFERENCES study(id),
  last_value integer NOT NULL DEFAULT 0
);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Chain of custody: append-only event per sample (CoC-01, CoC-02)
-- ---------------------------------------------------------------------------

CREATE TABLE custody_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id uuid NOT NULL REFERENCES sample(id),
  study_id uuid NOT NULL REFERENCES study(id),
  event_type text NOT NULL CHECK (event_type IN (
    'collection', 'receipt', 'storage_add', 'storage_remove', 'transfer',
    'aliquot', 'hold', 'hold_release', 'disposal'
  )),
  actor_id uuid REFERENCES app_user(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  storage_unit_id uuid REFERENCES storage_unit(id),
  position text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX custody_event_sample_lookup ON custody_event (sample_id, occurred_at);
--> statement-breakpoint
COMMENT ON TABLE custody_event IS
  'Append-only (trigger-enforced, CoC-02). hold/hold_release/disposal are reserved now so the consent-withdrawal obligation (CoC-05) never forces an enum migration on this regulated table.';
--> statement-breakpoint
COMMENT ON COLUMN custody_event.study_id IS
  'Denormalized from sample: the audit trigger derives the per-study chain scope from the row itself (ADR-0002), and custody queries scope by study without a join.';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Analysis: service catalog, requests (orders), versioned results
-- ---------------------------------------------------------------------------

CREATE TABLE analysis_service (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  unit text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE analysis_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id uuid NOT NULL REFERENCES sample(id),
  study_id uuid NOT NULL REFERENCES study(id),
  service_id uuid NOT NULL REFERENCES analysis_service(id),
  status text NOT NULL DEFAULT 'ordered'
    CHECK (status IN ('ordered', 'resulted', 'verified', 'signed', 'cancelled')),
  requested_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX analysis_request_sample_lookup ON analysis_request (sample_id);
--> statement-breakpoint

CREATE TABLE result (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES analysis_request(id),
  study_id uuid NOT NULL REFERENCES study(id),
  version integer NOT NULL,
  value text NOT NULL,
  unit text,
  status text NOT NULL CHECK (status IN ('entered', 'verified')),
  reason_for_change text,
  entered_by uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, version)
);
--> statement-breakpoint
COMMENT ON TABLE result IS
  'Append-only versioned rows (edc item_value_versions pattern, P11-02): corrections append a new version with reason_for_change; nothing is overwritten (§11.10(e)).';
--> statement-breakpoint

-- Latest version per request (edc item_values_current pattern).
CREATE VIEW result_current AS
SELECT DISTINCT ON (request_id)
  id, request_id, study_id, version, value, unit, status, reason_for_change,
  entered_by, created_at
FROM result
ORDER BY request_id, version DESC;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- E-signatures (P11-06, P11-10)
-- ---------------------------------------------------------------------------

CREATE TABLE signature (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES analysis_request(id),
  result_id uuid NOT NULL REFERENCES result(id),
  study_id uuid NOT NULL REFERENCES study(id),
  signer_id uuid NOT NULL REFERENCES app_user(id),
  meaning text NOT NULL,
  record_hash char(64) NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now(),
  invalidated_at timestamptz,
  invalidated_reason text
);
--> statement-breakpoint
COMMENT ON COLUMN signature.record_hash IS
  'sha256 of the signed result content at signing time — binds signature to record (P11-09, §11.70). A later result version does not carry the signature forward.';
--> statement-breakpoint
COMMENT ON COLUMN signature.meaning IS
  'Displayed meaning of the signature, e.g. result_release (P11-06, §11.50(a)(3)).';
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Audit trail: hash-chained, per-study scoped (ADR-0002; P11-01, P11-03)
-- ---------------------------------------------------------------------------

CREATE TABLE audit_event (
  id bigserial PRIMARY KEY,
  chain_scope text NOT NULL,
  occurred_at timestamptz NOT NULL,
  actor_id uuid,
  actor_label text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  before jsonb,
  after jsonb,
  prev_hash char(64) NOT NULL,
  hash char(64) NOT NULL
);
--> statement-breakpoint
CREATE INDEX audit_event_chain_lookup ON audit_event (chain_scope, id DESC);
--> statement-breakpoint
CREATE INDEX audit_event_entity_lookup ON audit_event (entity_type, entity_id);
--> statement-breakpoint
COMMENT ON COLUMN audit_event.chain_scope IS
  'Hash-chain partition key (ADR-0002): ''study:<uuid>'' for study-scoped rows, ''global'' otherwise. Chains are independently verifiable and appends only serialize within a scope — no system-wide write bottleneck on bulk accessioning or instrument loads.';
--> statement-breakpoint
COMMENT ON COLUMN audit_event.prev_hash IS
  'Hash of the previous event in the same chain_scope (zeros for the first). Recomputable chain makes retroactive edits detectable (P11-03).';
