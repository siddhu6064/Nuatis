-- 0115_campaign_sends.sql
-- P13 AI Campaigns: per-contact delivery tracking across all channels.
-- One row per contact per channel per campaign send attempt.

CREATE TABLE campaign_sends (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  campaign_id  uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id   uuid REFERENCES contacts(id) ON DELETE SET NULL,
  channel      text NOT NULL,
  status       text NOT NULL DEFAULT 'queued',
  -- allowed: queued, sent, delivered, failed, opened, clicked, opted_out
  sent_at      timestamptz,
  delivered_at timestamptz,
  opened_at    timestamptz,
  clicked_at   timestamptz,
  error_msg    text,
  created_at   timestamptz DEFAULT now()
);

CREATE INDEX idx_campaign_sends_campaign ON campaign_sends(campaign_id);
CREATE INDEX idx_campaign_sends_contact  ON campaign_sends(contact_id);
CREATE INDEX idx_campaign_sends_status   ON campaign_sends(campaign_id, status);

ALTER TABLE campaign_sends ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON campaign_sends
  USING (
    EXISTS (
      SELECT 1 FROM campaigns c
      WHERE c.id = campaign_id
        AND c.tenant_id = current_setting('app.tenant_id')::uuid
    )
  );
