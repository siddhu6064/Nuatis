-- Add new columns for channel analytics
ALTER TABLE review_requests
  ADD COLUMN IF NOT EXISTS channel TEXT DEFAULT 'sms',
  ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_url TEXT,
  ADD COLUMN IF NOT EXISTS message_sid TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Expand status to include 'opened' and 'completed'
ALTER TABLE review_requests DROP CONSTRAINT IF EXISTS review_requests_status_check;
ALTER TABLE review_requests ADD CONSTRAINT review_requests_status_check
  CHECK (status IN ('pending', 'sent', 'opened', 'clicked', 'completed', 'reviewed'));

-- New indexes
CREATE INDEX IF NOT EXISTS idx_review_requests_sent_at ON review_requests(tenant_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_requests_status ON review_requests(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_review_requests_message_sid ON review_requests(message_sid);
