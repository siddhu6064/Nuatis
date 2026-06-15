-- 0131: Trigger link hardening (G46)
-- Adds expiry + use limits to trigger_links and an atomic claim function so
-- state-mutating action links cannot be replayed (forwarded link re-firing
-- webhooks / re-flipping appointment & deal status).

ALTER TABLE trigger_links
  ADD COLUMN expires_at TIMESTAMPTZ,
  ADD COLUMN max_uses INTEGER,
  ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0;

-- Backfill: existing links whose action mutates state become single-use.
-- mark_contacted is engagement tracking (refreshes last_contacted_at) and
-- stays multi-use, as do pure tracking/redirect clicks.
UPDATE trigger_links
SET max_uses = 1
WHERE action IN (
  'confirm_appointment',
  'cancel_appointment',
  'mark_won',
  'mark_lost',
  'custom_webhook'
);

-- Atomic claim: increments use_count only while under max_uses (NULL = unlimited).
-- Returns the claimed row; zero rows means the link is consumed. The single
-- UPDATE serializes concurrent clicks via row locking, preventing double-fire.
CREATE OR REPLACE FUNCTION claim_trigger_link_use(p_link_id UUID)
RETURNS SETOF trigger_links
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE trigger_links
  SET use_count = use_count + 1,
      updated_at = now()
  WHERE id = p_link_id
    AND (max_uses IS NULL OR use_count < max_uses)
  RETURNING *;
$$;
