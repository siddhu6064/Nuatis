-- ============================================================
--  0027 — Contact Attachments + Inbound/Outbound SMS
--  Phase 8 Wk 63-64: file attachments, two-way SMS, inbox
-- ============================================================

-- ── CONTACT_ATTACHMENTS ─────────────────────────────────────

CREATE TABLE contact_attachments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id          UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  filename            TEXT NOT NULL,
  original_filename   TEXT NOT NULL,
  file_type           TEXT NOT NULL,
  file_size           INTEGER NOT NULL,
  storage_path        TEXT NOT NULL,
  storage_bucket      TEXT NOT NULL DEFAULT 'contact-attachments',
  uploaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE contact_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON contact_attachments
  USING (tenant_id = current_tenant_id());

CREATE INDEX idx_contact_attachments_contact_time
  ON contact_attachments (contact_id, created_at DESC);

CREATE INDEX idx_contact_attachments_tenant_time
  ON contact_attachments (tenant_id, created_at DESC);


-- ── INBOUND_SMS (stores both inbound and outbound for thread view) ──────────

CREATE TABLE inbound_sms (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id        UUID REFERENCES contacts(id) ON DELETE SET NULL,
  from_number       TEXT NOT NULL,
  to_number         TEXT NOT NULL,
  body              TEXT NOT NULL,
  direction         TEXT NOT NULL DEFAULT 'inbound',    -- inbound | outbound
  telnyx_message_id TEXT,
  status            TEXT NOT NULL DEFAULT 'received',   -- received | read
  read_at           TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE inbound_sms ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON inbound_sms
  USING (tenant_id = current_tenant_id());

CREATE INDEX idx_inbound_sms_contact_thread
  ON inbound_sms (tenant_id, contact_id, created_at DESC);

CREATE INDEX idx_inbound_sms_unread
  ON inbound_sms (tenant_id, status, created_at DESC)
  WHERE status = 'received';

CREATE INDEX idx_inbound_sms_from_tenant
  ON inbound_sms (from_number, tenant_id);

CREATE UNIQUE INDEX idx_inbound_sms_telnyx_dedup
  ON inbound_sms (telnyx_message_id)
  WHERE telnyx_message_id IS NOT NULL;

-- NOTE: Enable Supabase Realtime for inbound_sms:
-- Dashboard → Database → Replication → enable inbound_sms table
