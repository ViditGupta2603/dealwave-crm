-- Phase 2: file attachments, email templates and the email log.

CREATE TABLE email_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  subject     text NOT NULL,
  body        text NOT NULL,
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE email_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  to_email      text NOT NULL,
  subject       text NOT NULL,
  body          text NOT NULL,
  status        text NOT NULL CHECK (status IN ('sent','simulated','failed')),
  error         text,
  source        text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','automation','invite')),
  related_type  text CHECK (related_type IN ('lead','contact','account','deal')),
  related_id    uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_log_tenant_idx ON email_log (tenant_id, created_at DESC);
CREATE INDEX email_log_related_idx ON email_log (tenant_id, related_type, related_id);

-- Files live in the database (bytea) so they are covered by row level security and by normal backups.
CREATE TABLE attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity       text NOT NULL CHECK (entity IN ('lead','contact','account','deal')),
  entity_id    uuid NOT NULL,
  filename     text NOT NULL,
  mime_type    text NOT NULL,
  size_bytes   integer NOT NULL CHECK (size_bytes > 0),
  data         bytea NOT NULL,
  uploaded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_entity_idx ON attachments (tenant_id, entity, entity_id, created_at DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['email_templates','email_log','attachments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (tenant_id = app_tenant_id() OR app_bypass()) WITH CHECK (tenant_id = app_tenant_id() OR app_bypass())', t);
  END LOOP;
END $$;
