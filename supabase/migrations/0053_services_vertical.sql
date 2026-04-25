-- Add vertical column to services for per-vertical filtering on booking page
ALTER TABLE services ADD COLUMN IF NOT EXISTS vertical text;

CREATE INDEX IF NOT EXISTS idx_services_vertical
  ON services (tenant_id, vertical) WHERE is_active = true;

-- Backfill by known service names from seed data (names are unique across verticals)
UPDATE services SET vertical = 'dental'
WHERE name IN ('Dental Cleaning','Dental Exam','X-Rays','Teeth Whitening','Root Canal','Crown','Filling','Emergency Visit')
  AND vertical IS NULL;

UPDATE services SET vertical = 'salon'
WHERE name IN ('Haircut','Color','Highlights','Blowout','Manicure','Pedicure','Facial','Wax')
  AND vertical IS NULL;

UPDATE services SET vertical = 'contractor'
WHERE name IN ('Site Visit / Estimate','General Repair','Kitchen Remodel','Bathroom Remodel','Flooring','Painting','Electrical','Plumbing')
  AND vertical IS NULL;

UPDATE services SET vertical = 'law_firm'
WHERE name IN ('Initial Consultation','Hourly Rate','Retainer','Document Review','Court Appearance','Contract Drafting')
  AND vertical IS NULL;

UPDATE services SET vertical = 'real_estate'
WHERE name IN ('Buyer Consultation','Listing Presentation','Home Valuation','Photography Package','Staging Consultation')
  AND vertical IS NULL;

UPDATE services SET vertical = 'restaurant'
WHERE name IN ('Catering (Small)','Catering (Medium)','Catering (Large)','Private Dining','Event Space Rental')
  AND vertical IS NULL;

UPDATE services SET vertical = 'sales_crm'
WHERE name IN ('Basic Package','Professional Package','Enterprise Package','Custom Solution','Training Session')
  AND vertical IS NULL;

UPDATE services SET vertical = 'medical'
WHERE name IN ('Office Visit','Physical Exam','Blood Draw','EKG','Vaccination','Urgent Care Visit')
  AND vertical IS NULL;

UPDATE services SET vertical = 'veterinary'
WHERE name IN ('Wellness Exam','Vaccination','Spay / Neuter','Dental Cleaning','Bloodwork','Grooming')
  AND vertical IS NULL;
