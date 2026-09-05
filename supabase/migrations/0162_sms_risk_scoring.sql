-- SMS-equivalent risk scoring — email already tracks a per-contact
-- deliverability score (contacts.email_risk_score/email_status); SMS
-- delivery health had nothing analogous.

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS sms_risk_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sms_status text NOT NULL DEFAULT 'ok'
    CHECK (sms_status IN ('ok', 'at_risk', 'suppressed'));
