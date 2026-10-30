-- Phase 4: forgot password, email verification, "Continue with Google".

ALTER TABLE users
  ADD COLUMN email_verified_at timestamptz,
  ADD COLUMN google_sub        text;

-- Everyone who already exists keeps working exactly as before: treat their email as verified.
UPDATE users SET email_verified_at = COALESCE(created_at, now()) WHERE email_verified_at IS NULL;

CREATE UNIQUE INDEX users_google_sub_uq ON users (google_sub) WHERE google_sub IS NOT NULL;

-- One table for both kinds of emailed links. Only a SHA-256 hash of the token is stored,
-- so a leaked database backup cannot be used to reset anyone's password.
CREATE TABLE auth_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('reset','verify')),
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_tokens_user_idx ON auth_tokens (user_id, purpose, created_at DESC);

ALTER TABLE auth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON auth_tokens USING (tenant_id = app_tenant_id() OR app_bypass()) WITH CHECK (tenant_id = app_tenant_id() OR app_bypass());

-- The email log can now also record account emails (reset links, verification links).
ALTER TABLE email_log DROP CONSTRAINT email_log_source_check;
ALTER TABLE email_log ADD CONSTRAINT email_log_source_check CHECK (source IN ('manual','automation','invite','auth'));
