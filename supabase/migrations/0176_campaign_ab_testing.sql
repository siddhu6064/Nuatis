-- Campaign A/B testing — campaign_messages was UNIQUE(campaign_id, channel),
-- exactly one message per channel, no variant concept. Widen to a real
-- variant slot: 'a' is the only variant most campaigns will ever use
-- (default), so every existing row keeps working unchanged; a second 'b'
-- row per channel is what turns a campaign into a real A/B test.

ALTER TABLE campaign_messages
  ADD COLUMN IF NOT EXISTS variant text NOT NULL DEFAULT 'a' CHECK (variant IN ('a', 'b'));

ALTER TABLE campaign_messages
  DROP CONSTRAINT campaign_messages_campaign_id_channel_key;

ALTER TABLE campaign_messages
  ADD CONSTRAINT campaign_messages_campaign_id_channel_variant_key
  UNIQUE (campaign_id, channel, variant);

-- Which variant a given send actually got, so performance can be split by
-- variant afterward. Nullable — existing rows and non-A/B sends stay 'a'
-- implicitly without needing a backfill.
ALTER TABLE campaign_sends
  ADD COLUMN IF NOT EXISTS variant text CHECK (variant IN ('a', 'b'));
