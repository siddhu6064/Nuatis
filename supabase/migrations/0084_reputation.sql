-- Migration 0084: Reputation Module (GBP + Reviews)

CREATE TABLE gbp_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id) ON DELETE SET NULL,
  google_account_id TEXT NOT NULL,
  google_location_name TEXT NOT NULL,
  location_name TEXT NOT NULL,
  place_id TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  connected_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id)
);

CREATE TABLE reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  google_review_id TEXT NOT NULL,
  reviewer_name TEXT,
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  published_at TIMESTAMPTZ,
  reply_text TEXT,
  reply_sent_at TIMESTAMPTZ,
  ai_suggested_reply TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','replied','ignored')),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, google_review_id)
);

CREATE INDEX ON reviews(tenant_id, published_at DESC);
CREATE INDEX ON reviews(tenant_id, status);
