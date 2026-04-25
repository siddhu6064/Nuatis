import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

const VERTICAL_SERVICES: Record<
  string,
  Array<{
    name: string
    unit_price: number
    unit?: string
    duration_minutes?: number
    category?: string
  }>
> = {
  dental: [
    { name: 'Dental Cleaning', unit_price: 150, duration_minutes: 45, category: 'Preventive' },
    { name: 'Dental Exam', unit_price: 100, duration_minutes: 30, category: 'Preventive' },
    { name: 'X-Rays', unit_price: 75, duration_minutes: 15, category: 'Diagnostic' },
    { name: 'Teeth Whitening', unit_price: 350, duration_minutes: 60, category: 'Cosmetic' },
    { name: 'Root Canal', unit_price: 800, duration_minutes: 90, category: 'Restorative' },
    { name: 'Crown', unit_price: 1200, duration_minutes: 60, category: 'Restorative' },
    { name: 'Filling', unit_price: 200, duration_minutes: 30, category: 'Restorative' },
    { name: 'Emergency Visit', unit_price: 250, duration_minutes: 30, category: 'Emergency' },
  ],
  salon: [
    { name: 'Haircut', unit_price: 45, duration_minutes: 30 },
    { name: 'Color', unit_price: 120, duration_minutes: 90 },
    { name: 'Highlights', unit_price: 150, duration_minutes: 120 },
    { name: 'Blowout', unit_price: 35, duration_minutes: 30 },
    { name: 'Manicure', unit_price: 30, duration_minutes: 30 },
    { name: 'Pedicure', unit_price: 45, duration_minutes: 45 },
    { name: 'Facial', unit_price: 85, duration_minutes: 60 },
    { name: 'Wax', unit_price: 25, duration_minutes: 15 },
  ],
  contractor: [
    {
      name: 'Site Visit / Estimate',
      unit_price: 0,
      duration_minutes: 60,
      category: 'Consultation',
    },
    { name: 'General Repair', unit_price: 85, unit: 'hour', category: 'Labor' },
    { name: 'Kitchen Remodel', unit_price: 15000, unit: 'project', category: 'Remodel' },
    { name: 'Bathroom Remodel', unit_price: 10000, unit: 'project', category: 'Remodel' },
    { name: 'Flooring', unit_price: 8, unit: 'sqft', category: 'Material + Labor' },
    { name: 'Painting', unit_price: 4, unit: 'sqft', category: 'Material + Labor' },
    { name: 'Electrical', unit_price: 95, unit: 'hour', category: 'Labor' },
    { name: 'Plumbing', unit_price: 95, unit: 'hour', category: 'Labor' },
  ],
  law_firm: [
    { name: 'Initial Consultation', unit_price: 0, duration_minutes: 30 },
    { name: 'Hourly Rate', unit_price: 350, unit: 'hour' },
    { name: 'Retainer', unit_price: 5000, unit: 'retainer' },
    { name: 'Document Review', unit_price: 500, unit: 'flat' },
    { name: 'Court Appearance', unit_price: 2500, unit: 'appearance' },
    { name: 'Contract Drafting', unit_price: 1500, unit: 'flat' },
  ],
  real_estate: [
    { name: 'Buyer Consultation', unit_price: 0, duration_minutes: 60 },
    { name: 'Listing Presentation', unit_price: 0, duration_minutes: 60 },
    { name: 'Home Valuation', unit_price: 250, unit: 'flat' },
    { name: 'Photography Package', unit_price: 500, unit: 'flat' },
    { name: 'Staging Consultation', unit_price: 300, unit: 'flat' },
  ],
  restaurant: [
    { name: 'Catering (Small)', unit_price: 500, unit: 'event' },
    { name: 'Catering (Medium)', unit_price: 1500, unit: 'event' },
    { name: 'Catering (Large)', unit_price: 3500, unit: 'event' },
    { name: 'Private Dining', unit_price: 1000, unit: 'event' },
    { name: 'Event Space Rental', unit_price: 750, unit: 'event' },
  ],
  sales_crm: [
    { name: 'Basic Package', unit_price: 500, unit: 'flat' },
    { name: 'Professional Package', unit_price: 1500, unit: 'flat' },
    { name: 'Enterprise Package', unit_price: 5000, unit: 'flat' },
    { name: 'Custom Solution', unit_price: 0, unit: 'quote' },
    { name: 'Training Session', unit_price: 200, unit: 'hour' },
  ],
}

// Also export for use by auto-quote logic
export { VERTICAL_SERVICES }

async function main() {
  const tenantId = process.argv[2] ?? process.env['VOICE_DEV_TENANT_ID']
  const vertical = process.argv[3] ?? 'sales_crm'

  if (!tenantId) {
    console.error('Usage: npx tsx src/scripts/seed-services.ts <tenant_id> [vertical]')
    process.exit(1)
  }

  const supabase = createClient(
    process.env['SUPABASE_URL']!,
    process.env['SUPABASE_SERVICE_ROLE_KEY']!
  )

  const { count } = await supabase
    .from('services')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId)

  if (count && count > 0) {
    console.info(
      `[seed-services] services already exist for tenant=${tenantId} (${count} found) — skipping`
    )
    return
  }

  const services = VERTICAL_SERVICES[vertical]
  if (!services) {
    console.error(`[seed-services] unknown vertical: ${vertical}`)
    process.exit(1)
  }

  const rows = services.map((s, i) => ({
    tenant_id: tenantId,
    vertical,
    name: s.name,
    unit_price: s.unit_price,
    unit: s.unit ?? 'each',
    duration_minutes: s.duration_minutes ?? null,
    category: s.category ?? null,
    sort_order: i,
  }))

  const { error } = await supabase.from('services').insert(rows)
  if (error) {
    console.error(`[seed-services] insert error: ${error.message}`)
    process.exit(1)
  }

  console.info(
    `[seed-services] inserted ${rows.length} services for tenant=${tenantId} vertical=${vertical}`
  )
}

main().catch(console.error)
