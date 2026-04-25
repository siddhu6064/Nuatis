/**
 * Seed service packages for the internal tenant.
 * Usage: npx tsx packages/shared/supabase/seeds/service_packages_seed.ts
 *
 * Looks up services by name and creates bundled packages per vertical.
 */

import { createClient } from '@supabase/supabase-js'

const TENANT_ID = 'c35f4ce4-04f0-4ec0-bbc2-8512afbd3c5b'

const url = process.env['SUPABASE_URL']
const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const supabase = createClient(url, key)

interface PackagePreset {
  vertical: string
  name: string
  serviceNames: string[]
  discountPct: number
}

const PRESETS: PackagePreset[] = [
  {
    vertical: 'dental',
    name: 'New Patient Package',
    serviceNames: ['Dental Exam', 'X-Rays', 'Dental Cleaning'],
    discountPct: 15,
  },
  {
    vertical: 'salon',
    name: 'Color + Cut + Style',
    serviceNames: ['Color', 'Haircut', 'Blowout'],
    discountPct: 12,
  },
  {
    vertical: 'contractor',
    name: 'Home Service Package',
    serviceNames: ['Site Visit / Estimate', 'General Repair', 'Painting'],
    discountPct: 10,
  },
  {
    vertical: 'law_firm',
    name: 'Consultation + Intake',
    serviceNames: ['Initial Consultation', 'Retainer'],
    discountPct: 8,
  },
  {
    vertical: 'real_estate',
    name: 'Listing Package',
    serviceNames: ['Listing Presentation', 'Photography Package', 'Staging Consultation'],
    discountPct: 10,
  },
  {
    vertical: 'restaurant',
    name: 'Event Catering Package',
    serviceNames: ['Catering (Medium)', 'Catering (Small)', 'Private Dining'],
    discountPct: 10,
  },
  {
    vertical: 'sales_crm',
    name: 'Onboarding Package',
    serviceNames: ['Professional Package', 'Basic Package', 'Training Session'],
    discountPct: 10,
  },
]

async function seed() {
  console.info(`[seed] Seeding service packages for tenant ${TENANT_ID}`)

  // Fetch all services for the tenant
  const { data: allServices, error: svcErr } = await supabase
    .from('services')
    .select('id, name, unit_price')
    .eq('tenant_id', TENANT_ID)
    .eq('is_active', true)

  if (svcErr) {
    console.error('[seed] Failed to fetch services:', svcErr.message)
    process.exit(1)
  }

  const servicesByName = new Map<string, { id: string; unit_price: number }>()
  for (const svc of allServices ?? []) {
    servicesByName.set(svc.name, { id: svc.id, unit_price: Number(svc.unit_price) })
  }

  let inserted = 0

  for (const preset of PRESETS) {
    const items: Array<{ service_id: string; qty: number }> = []
    let listTotal = 0
    let skipped = false

    for (const name of preset.serviceNames) {
      const svc = servicesByName.get(name)
      if (!svc) {
        console.warn(
          `[seed] WARNING: service "${name}" not found for vertical "${preset.vertical}" — skipping item`
        )
        skipped = true
        continue
      }
      items.push({ service_id: svc.id, qty: 1 })
      listTotal += svc.unit_price
    }

    if (items.length < 2) {
      console.warn(`[seed] Skipping package "${preset.name}" — fewer than 2 services found`)
      continue
    }

    const bundlePrice = Number((listTotal * (1 - preset.discountPct / 100)).toFixed(2))
    const bundleDiscountPct = preset.discountPct

    const { error: insertErr } = await supabase.from('service_packages').insert({
      tenant_id: TENANT_ID,
      vertical: preset.vertical,
      name: preset.name,
      description: skipped ? 'Some services missing — partial package' : null,
      items,
      bundle_price: bundlePrice,
      bundle_discount_pct: bundleDiscountPct,
      sort_order: inserted,
    })

    if (insertErr) {
      console.error(`[seed] Failed to insert "${preset.name}":`, insertErr.message)
    } else {
      console.info(
        `[seed] Inserted: "${preset.name}" (${preset.vertical}) — $${bundlePrice} (${bundleDiscountPct}% off $${listTotal.toFixed(2)})`
      )
      inserted++
    }
  }

  console.info(`[seed] Done — inserted ${inserted} packages`)
}

seed().catch((err) => {
  console.error('[seed] Fatal error:', err)
  process.exit(1)
})
