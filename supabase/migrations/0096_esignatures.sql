ALTER TABLE quotes ADD COLUMN IF NOT EXISTS requires_signature BOOLEAN DEFAULT false;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS signature_data TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS signed_by_name TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS signed_ip TEXT;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS signature_status TEXT DEFAULT 'none'
  CHECK (signature_status IN ('none', 'waiting', 'signed', 'declined'));
