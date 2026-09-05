-- Fixed-dollar reward option on Nuatis's own tenant-affiliate referral codes —
-- only a flat percentage rate existed, not the simpler "$X per referral"
-- model. Defaults preserve today's percent-only behavior for every existing
-- and newly-generated code.

ALTER TABLE referral_codes
  ADD COLUMN IF NOT EXISTS reward_type text NOT NULL DEFAULT 'percent'
    CHECK (reward_type IN ('percent', 'fixed')),
  ADD COLUMN IF NOT EXISTS fixed_reward_cents integer CHECK (fixed_reward_cents IS NULL OR fixed_reward_cents >= 0);
