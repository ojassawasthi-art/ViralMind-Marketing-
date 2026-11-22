-- UNTESTED: no PostgreSQL available in build environment. Run in CI before trusting.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE,
  password_hash text NOT NULL, mfa_totp_secret_enc bytea, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE memberships (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, role text NOT NULL CHECK (role IN ('owner','admin','manager','member','client_viewer')),
  UNIQUE (org_id,user_id));
CREATE TABLE capabilities (id text PRIMARY KEY, ordinal int NOT NULL UNIQUE CHECK (ordinal BETWEEN 1 AND 705), name text NOT NULL,
  kind text NOT NULL, department_number int NOT NULL, division text NOT NULL, execution_mode text NOT NULL, cost_class text NOT NULL,
  implementation_status text NOT NULL DEFAULT 'not_implemented' CHECK (implementation_status IN ('not_implemented','engine_tested','template_runnable','implemented_tested')),
  meta jsonb NOT NULL, registry_version int NOT NULL);
CREATE TABLE approvals (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id),
  requested_by_agent text NOT NULL, action_type text NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending','approved','rejected','expired')), decided_by uuid REFERENCES users(id), decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE audit_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL REFERENCES organizations(id),
  actor text NOT NULL, action text NOT NULL, target text, meta jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX ON memberships(user_id); CREATE INDEX ON approvals(org_id,status); CREATE INDEX ON audit_events(org_id,created_at);
-- Row-level security: app sets `SET LOCAL app.org_id = '<uuid>'` per request.
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY; ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_approvals ON approvals USING (org_id = current_setting('app.org_id', true)::uuid);
CREATE POLICY tenant_audit ON audit_events USING (org_id = current_setting('app.org_id', true)::uuid);
COMMIT;
