-- Phase 3: AI switch, two-step verification, calendar feed token, and card/UPI payments.

ALTER TABLE tenants
  ADD COLUMN ai_enabled      boolean NOT NULL DEFAULT true,
  ADD COLUMN plan_paid_until timestamptz;

ALTER TABLE users
  ADD COLUMN totp_secret_enc    text,
  ADD COLUMN totp_enabled       boolean NOT NULL DEFAULT false,
  ADD COLUMN totp_last_step     bigint,
  ADD COLUMN totp_backup_hashes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN calendar_token_hash text;
CREATE UNIQUE INDEX users_calendar_token_uq ON users (calendar_token_hash) WHERE calendar_token_hash IS NOT NULL;

CREATE TABLE payments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan                 text NOT NULL CHECK (plan IN ('pro','enterprise')),
  amount_paise         integer NOT NULL CHECK (amount_paise > 0),
  currency             text NOT NULL DEFAULT 'INR',
  status               text NOT NULL DEFAULT 'created' CHECK (status IN ('created','paid','failed')),
  razorpay_order_id    text NOT NULL UNIQUE,
  razorpay_payment_id  text,
  created_by           uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  paid_at              timestamptz
);
CREATE INDEX payments_tenant_idx ON payments (tenant_id, created_at DESC);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payments USING (tenant_id = app_tenant_id() OR app_bypass()) WITH CHECK (tenant_id = app_tenant_id() OR app_bypass());
