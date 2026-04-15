ALTER TABLE tenants ADD COLUMN IF NOT EXISTS booking_page_enabled BOOLEAN DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS booking_page_slug TEXT UNIQUE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS booking_services UUID[] DEFAULT '{}';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS booking_buffer_minutes INTEGER DEFAULT 15;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS booking_advance_days INTEGER DEFAULT 30;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS booking_confirmation_message TEXT DEFAULT 'Your appointment has been booked! We look forward to seeing you.';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS booking_google_review_url TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS booking_accent_color TEXT DEFAULT '#2563eb';

CREATE INDEX IF NOT EXISTS idx_tenants_booking_slug ON tenants(booking_page_slug) WHERE booking_page_slug IS NOT NULL;
