-- 0114_campaign_messages.sql
-- P13 AI Campaigns: per-channel AI-generated messages awaiting human approval.
-- One message per channel per campaign (UNIQUE constraint).

CREATE TABLE campaign_messages (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id  uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  channel      text NOT NULL,   -- 'sms' | 'email' | 'social'
  subject      text,            -- email only; null for sms/social
  body         text NOT NULL,
  ai_generated boolean NOT NULL DEFAULT true,
  approved     boolean NOT NULL DEFAULT false,
  approved_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at  timestamptz,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),

  UNIQUE(campaign_id, channel)
);

ALTER TABLE campaign_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON campaign_messages
  USING (
    EXISTS (
      SELECT 1 FROM campaigns c
      WHERE c.id = campaign_id
        AND c.tenant_id = current_setting('app.tenant_id')::uuid
    )
  );
