CREATE TABLE mobile_push_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id),
  expo_token TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  device_name TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE mobile_push_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON mobile_push_tokens
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE authjs_user_id = auth.uid()));
CREATE INDEX idx_mobile_push_tokens_user ON mobile_push_tokens(user_id);
CREATE INDEX idx_mobile_push_tokens_tenant ON mobile_push_tokens(tenant_id);
