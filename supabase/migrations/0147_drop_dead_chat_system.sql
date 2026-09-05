-- ============================================================
--  0147 — Drop dead "System A" chat tables
--  chat_sessions/chat_messages (migration 0039) never had a working AI
--  reply path and nothing in production ever wrote to them — the live
--  embeddable webchat widget uses the separate webchat_sessions/
--  webchat_messages tables (migration 0101) instead. Confirmed dead by
--  full-repo grep before this migration was written: no remaining code
--  references chat_sessions, chat_messages, or the chat_widget_* tenant
--  columns. DROP TABLE cascades away the FK/index/RLS-policy history from
--  migrations 0129 (tenant_id ON DELETE CASCADE rewrite) and 0130
--  (share_token column) automatically — nothing else to clean up there.
--  export_jobs, created in the same 0039 migration, is untouched — it's
--  still live (data-export.ts / export-worker.ts).
-- ============================================================

DROP TABLE IF EXISTS chat_messages;
DROP TABLE IF EXISTS chat_sessions;

ALTER TABLE tenants DROP COLUMN IF EXISTS chat_widget_enabled;
ALTER TABLE tenants DROP COLUMN IF EXISTS chat_widget_color;
ALTER TABLE tenants DROP COLUMN IF EXISTS chat_widget_greeting;
ALTER TABLE tenants DROP COLUMN IF EXISTS chat_widget_position;
