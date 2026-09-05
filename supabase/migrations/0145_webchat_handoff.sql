-- ============================================================
--  0145 — Webchat human handoff
--  Lets staff take over a live AI webchat conversation (mode='human'
--  stops the inline Gemini auto-reply in webchat.ts) and see it in the
--  dashboard inbox. Built entirely on the LIVE webchat_sessions/
--  webchat_messages tables (migration 0101) — the separate, unused
--  chat_sessions/chat_messages tables (migration 0039) are dead code
--  and untouched by this migration.
-- ============================================================

ALTER TABLE webchat_sessions
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'ai' CHECK (mode IN ('ai', 'human')),
  ADD COLUMN IF NOT EXISTS handoff_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS handoff_reason text,
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_message_preview text,
  ADD COLUMN IF NOT EXISTS unread_count integer NOT NULL DEFAULT 0;

-- Backfill so existing sessions sort correctly in the inbox by recency
UPDATE webchat_sessions ws
SET last_message_at = COALESCE(
  (SELECT MAX(wm.created_at) FROM webchat_messages wm WHERE wm.session_id = ws.id),
  ws.started_at
)
WHERE last_message_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_webchat_sessions_tenant_status_mode
  ON webchat_sessions(tenant_id, status, mode);
