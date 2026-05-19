-- Create the table
CREATE TABLE waitlist_leads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name   text NOT NULL,
  email       text NOT NULL,
  phone       text,
  vertical    text,
  pain_point  text,
  source      text DEFAULT 'nuatis.com',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE waitlist_leads ENABLE ROW LEVEL SECURITY;

-- Allow anon inserts (the landing page key)
CREATE POLICY "anon can insert waitlist" ON waitlist_leads
  FOR INSERT TO anon WITH CHECK (true);