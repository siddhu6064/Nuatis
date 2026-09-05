-- Manual review entry — reviews left on Yelp/Facebook/elsewhere had nowhere to
-- go; the sync/OAuth machinery in gbp-sync.ts stays entirely Google-specific,
-- this just lets a manually-entered review sit in the same feed/stats.
ALTER TABLE reviews
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'google'
    CHECK (source IN ('google', 'yelp', 'facebook', 'manual', 'other'));
