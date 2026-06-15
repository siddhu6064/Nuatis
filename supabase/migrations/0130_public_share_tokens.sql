-- 0130: public share tokens for invoices + chat_sessions
--
-- The public routes GET /api/invoices/public/:id and GET /api/chat/messages/:sessionId
-- previously keyed on the raw primary-key UUID, so a leaked/forwarded URL was a
-- forever-valid credential. Switch public access to an unguessable share_token,
-- mirroring quotes.share_token and webchat_sessions.session_token.
--
-- Idempotent + backfilled so every existing row gets a unique token and the
-- column ends NOT NULL with a UNIQUE index.

-- ── invoices ────────────────────────────────────────────────────────────────
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS share_token text;
UPDATE invoices SET share_token = gen_random_uuid()::text WHERE share_token IS NULL;
ALTER TABLE invoices ALTER COLUMN share_token SET DEFAULT gen_random_uuid()::text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_share_token ON invoices(share_token);
ALTER TABLE invoices ALTER COLUMN share_token SET NOT NULL;

-- ── chat_sessions ───────────────────────────────────────────────────────────
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS share_token text;
UPDATE chat_sessions SET share_token = gen_random_uuid()::text WHERE share_token IS NULL;
ALTER TABLE chat_sessions ALTER COLUMN share_token SET DEFAULT gen_random_uuid()::text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_sessions_share_token ON chat_sessions(share_token);
ALTER TABLE chat_sessions ALTER COLUMN share_token SET NOT NULL;
