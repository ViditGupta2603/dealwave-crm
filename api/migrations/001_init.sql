-- Dealwave CRM: initial schema. Multi-tenant (shared schema) with Row-Level Security.

CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS uuid
LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app_bypass() RETURNS boolean
LANGUAGE sql STABLE AS $$ SELECT COALESCE(current_setting('app.bypass', true), '') = 'on' $$;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text NOT NULL UNIQUE,
  plan        text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','pro','enterprise')),
  currency    text NOT NULL DEFAULT 'INR',
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email          text NOT NULL,
  name           text NOT NULL,
  password_hash  text NOT NULL,
  role           text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','manager','member')),
  title          text,
  active         boolean NOT NULL DEFAULT true,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
CREATE INDEX users_tenant_idx ON users (tenant_id);

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_user_idx ON refresh_tokens (user_id);

CREATE TABLE invitations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email       text NOT NULL,
  role        text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','manager','member')),
  token_hash  text NOT NULL UNIQUE,
  invited_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at  timestamptz NOT NULL,
  accepted_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitations_tenant_idx ON invitations (tenant_id);

CREATE TABLE pipeline_stages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name         text NOT NULL,
  position     integer NOT NULL,
  probability  integer NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
  is_won       boolean NOT NULL DEFAULT false,
  is_lost      boolean NOT NULL DEFAULT false,
  color        text NOT NULL DEFAULT '#0F6B5C',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stages_tenant_idx ON pipeline_stages (tenant_id, position);

CREATE TABLE accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            text NOT NULL,
  industry        text,
  website         text,
  phone           text,
  employees       integer,
  annual_revenue  numeric(16,2),
  city            text,
  state           text,
  country         text DEFAULT 'India',
  description     text,
  owner_id        uuid REFERENCES users(id) ON DELETE SET NULL,
  custom_data     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX accounts_tenant_idx ON accounts (tenant_id, created_at DESC);
CREATE INDEX accounts_owner_idx ON accounts (tenant_id, owner_id);

CREATE TABLE contacts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_id   uuid REFERENCES accounts(id) ON DELETE SET NULL,
  first_name   text NOT NULL,
  last_name    text,
  email        text,
  phone        text,
  title        text,
  city         text,
  owner_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  custom_data  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX contacts_tenant_idx ON contacts (tenant_id, created_at DESC);
CREATE INDEX contacts_account_idx ON contacts (account_id);
CREATE INDEX contacts_owner_idx ON contacts (tenant_id, owner_id);

CREATE TABLE leads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  first_name    text NOT NULL,
  last_name     text,
  email         text,
  phone         text,
  company       text,
  title         text,
  source        text,
  status        text NOT NULL DEFAULT 'new' CHECK (status IN ('new','contacted','qualified','unqualified','converted')),
  score         integer NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  city          text,
  notes         text,
  owner_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  converted_at  timestamptz,
  custom_data   jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX leads_tenant_idx ON leads (tenant_id, created_at DESC);
CREATE INDEX leads_status_idx ON leads (tenant_id, status);
CREATE INDEX leads_owner_idx ON leads (tenant_id, owner_id);

CREATE TABLE deals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name           text NOT NULL,
  account_id     uuid REFERENCES accounts(id) ON DELETE SET NULL,
  contact_id     uuid REFERENCES contacts(id) ON DELETE SET NULL,
  stage_id       uuid NOT NULL REFERENCES pipeline_stages(id),
  amount         numeric(16,2) NOT NULL DEFAULT 0,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open','won','lost')),
  expected_close date,
  next_step      text,
  lost_reason    text,
  owner_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  closed_at      timestamptz,
  custom_data    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deals_tenant_idx ON deals (tenant_id, created_at DESC);
CREATE INDEX deals_stage_idx ON deals (tenant_id, stage_id);
CREATE INDEX deals_owner_idx ON deals (tenant_id, owner_id);
CREATE INDEX deals_status_idx ON deals (tenant_id, status, closed_at);

CREATE TABLE activities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type          text NOT NULL CHECK (type IN ('task','call','meeting','email','note')),
  subject       text NOT NULL,
  notes         text,
  priority      text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  due_at        timestamptz,
  completed_at  timestamptz,
  related_type  text CHECK (related_type IN ('lead','contact','account','deal')),
  related_id    uuid,
  owner_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activities_tenant_idx ON activities (tenant_id, created_at DESC);
CREATE INDEX activities_related_idx ON activities (tenant_id, related_type, related_id);
CREATE INDEX activities_due_idx ON activities (tenant_id, owner_id, due_at) WHERE completed_at IS NULL;

CREATE TABLE field_definitions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity     text NOT NULL CHECK (entity IN ('lead','contact','account','deal')),
  key        text NOT NULL,
  label      text NOT NULL,
  type       text NOT NULL CHECK (type IN ('text','number','date','select','boolean')),
  options    jsonb NOT NULL DEFAULT '[]'::jsonb,
  required   boolean NOT NULL DEFAULT false,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, entity, key)
);

CREATE TABLE workflow_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  entity      text NOT NULL CHECK (entity IN ('lead','contact','account','deal')),
  event       text NOT NULL CHECK (event IN ('created','updated','stage_changed')),
  conditions  jsonb NOT NULL DEFAULT '[]'::jsonb,
  actions     jsonb NOT NULL DEFAULT '[]'::jsonb,
  active      boolean NOT NULL DEFAULT true,
  run_count   integer NOT NULL DEFAULT 0,
  last_run_at timestamptz,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workflow_lookup_idx ON workflow_rules (tenant_id, entity, event) WHERE active;

CREATE TABLE workflow_runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rule_id     uuid NOT NULL REFERENCES workflow_rules(id) ON DELETE CASCADE,
  entity      text NOT NULL,
  record_id   uuid NOT NULL,
  status      text NOT NULL CHECK (status IN ('success','failed','skipped')),
  log         jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX workflow_runs_idx ON workflow_runs (tenant_id, created_at DESC);
CREATE INDEX workflow_runs_rule_idx ON workflow_runs (rule_id, created_at DESC);

CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text NOT NULL,
  body        text,
  link        text,
  dedupe_key  text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (tenant_id, user_id, created_at DESC);
CREATE UNIQUE INDEX notifications_dedupe_uq ON notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   uuid,
  label       text,
  changes     jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_tenant_idx ON audit_logs (tenant_id, created_at DESC);
CREATE INDEX audit_entity_idx ON audit_logs (tenant_id, entity, entity_id);

-- updated_at triggers
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['users','accounts','contacts','leads','deals','activities','workflow_rules'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t || '_updated_at', t);
  END LOOP;
END $$;

-- Row-Level Security: every tenant-scoped table is locked to app.tenant_id.
-- FORCE makes the policy apply even to the table owner.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['users','refresh_tokens','invitations','pipeline_stages','accounts','contacts','leads','deals','activities','field_definitions','workflow_rules','workflow_runs','notifications','audit_logs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id() OR app_bypass()) WITH CHECK (tenant_id = app_tenant_id() OR app_bypass())', t);
  END LOOP;
END $$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants USING (id = app_tenant_id() OR app_bypass()) WITH CHECK (id = app_tenant_id() OR app_bypass());
