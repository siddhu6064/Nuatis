-- Backfill vertical for services with non-standard names not caught by migration 0053
-- These are demo/custom service names that differ from the canonical seed names

UPDATE services SET vertical = 'contractor'
WHERE name IN ('AC Tune-Up', 'Duct Cleaning', 'HVAC Inspection')
  AND vertical IS NULL;

UPDATE services SET vertical = 'veterinary'
WHERE name IN ('Annual Wellness Exam', 'Vaccinations', 'Emergency Exam')
  AND vertical IS NULL;

UPDATE services SET vertical = 'real_estate'
WHERE name IN ('Home Valuation / CMA', 'Virtual Tour')
  AND vertical IS NULL;

UPDATE services SET vertical = 'salon'
WHERE name IN ('Blowout & Style', 'Hair Coloring', 'Treatment')
  AND vertical IS NULL;

UPDATE services SET vertical = 'sales_crm'
WHERE name IN ('Discovery Call', 'Product Demo', 'Implementation')
  AND vertical IS NULL;

UPDATE services SET vertical = 'medical'
WHERE name IN ('Blood Panel', 'Annual Physical', 'Flu Shot')
  AND vertical IS NULL;
