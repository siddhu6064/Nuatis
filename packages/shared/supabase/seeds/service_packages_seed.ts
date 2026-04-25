/**
 * Seed service packages for the internal tenant (dental) and demo tenant (all 9 verticals).
 * Usage: npx tsx packages/shared/supabase/seeds/service_packages_seed.ts
 *
 * Idempotent — skips packages that already exist (matched by tenant_id + name).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

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

// ── Internal tenant (c35f4ce4) — dental only ──────────────────────────────────
const INTERNAL_TENANT_ID = 'c35f4ce4-04f0-4ec0-bbc2-8512afbd3c5b'

const INTERNAL_PRESETS: PackagePreset[] = [
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

// ── Demo tenant (018323e5) — all 9 verticals ──────────────────────────────────
const DEMO_TENANT_ID = '018323e5-4866-486e-bc90-15cfeb910fc4'

const DEMO_PRESETS: PackagePreset[] = [
  {
    vertical: 'dental',
    name: 'New Patient Package',
    serviceNames: ['Dental Exam', 'X-Rays', 'Dental Cleaning'],
    discountPct: 15,
  },
  {
    vertical: 'medical',
    name: 'New Patient Package',
    serviceNames: ['Office Visit', 'Blood Panel'],
    discountPct: 10,
  },
  {
    vertical: 'veterinary',
    name: 'Wellness Package',
    serviceNames: ['Annual Wellness Exam', 'Vaccinations'],
    discountPct: 12,
  },
  {
    vertical: 'salon',
    name: 'Color & Style Package',
    serviceNames: ['Hair Coloring', 'Haircut', 'Blowout & Style'],
    discountPct: 12,
  },
  {
    vertical: 'restaurant',
    name: 'Private Event Package',
    serviceNames: ['Private Dining', 'Catering (Medium)'],
    discountPct: 10,
  },
  {
    vertical: 'contractor',
    name: 'Home Service Package',
    serviceNames: ['Site Visit / Estimate', 'HVAC Inspection'],
    discountPct: 10,
  },
  {
    vertical: 'law_firm',
    name: 'New Client Package',
    serviceNames: ['Initial Consultation', 'Retainer'],
    discountPct: 8,
  },
  {
    vertical: 'real_estate',
    name: 'Listing Package',
    serviceNames: ['Listing Presentation', 'Photography Package'],
    discountPct: 10,
  },
  {
    vertical: 'sales_crm',
    name: 'Onboarding Package',
    serviceNames: ['Discovery Call', 'Product Demo', 'Basic Package'],
    discountPct: 10,
  },
]

// ── Seed function ─────────────────────────────────────────────────────────────
async function seedPackages(
  sb: SupabaseClient,
  tenantId: string,
  presets: PackagePreset[]
): Promise<number> {
  console.info(`\n[seed] Tenant ${tenantId}`)

  const { data: allServices, error: svcErr } = await sb
    .from('services')
    .select('id, name, unit_price')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)

  if (svcErr) {
    console.error('[seed] Failed to fetch services:', svcErr.message)
    return 0
  }

  const servicesByName = new Map<string, { id: string; unit_price: number }>()
  for (const svc of allServices ?? []) {
    servicesByName.set(svc.name, { id: svc.id, unit_price: Number(svc.unit_price) })
  }

  const { data: existingPkgs } = await sb
    .from('service_packages')
    .select('name')
    .eq('tenant_id', tenantId)

  const existingNames = new Set((existingPkgs ?? []).map((p: { name: string }) => p.name))

  let inserted = 0

  for (const preset of presets) {
    if (existingNames.has(preset.name)) {
      console.info(`[seed] SKIP (exists): "${preset.name}" (${preset.vertical})`)
      continue
    }

    const items: Array<{ service_id: string; qty: number }> = []
    let listTotal = 0
    let hasError = false

    for (const name of preset.serviceNames) {
      const svc = servicesByName.get(name)
      if (!svc) {
        console.warn(
          `[seed] ERROR: service "${name}" not found for "${preset.name}" — aborting package`
        )
        hasError = true
        break
      }
      items.push({ service_id: svc.id, qty: 1 })
      listTotal += svc.unit_price
    }

    if (hasError || items.length < 2) {
      console.warn(`[seed] Skipping "${preset.name}" — service lookup failed`)
      continue
    }

    const bundlePrice = Number((listTotal * (1 - preset.discountPct / 100)).toFixed(2))

    const { error: insertErr } = await sb.from('service_packages').insert({
      tenant_id: tenantId,
      vertical: preset.vertical,
      name: preset.name,
      items,
      bundle_price: bundlePrice,
      bundle_discount_pct: preset.discountPct,
      sort_order: inserted,
    })

    if (insertErr) {
      console.error(`[seed] Failed to insert "${preset.name}":`, insertErr.message)
    } else {
      console.info(
        `[seed] Inserted: "${preset.name}" (${preset.vertical}) — $${bundlePrice} (${preset.discountPct}% off $${listTotal.toFixed(2)})`
      )
      inserted++
    }
  }

  console.info(`[seed] Done — inserted ${inserted} packages`)
  return inserted
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function seed() {
  const internalCount = await seedPackages(supabase, INTERNAL_TENANT_ID, INTERNAL_PRESETS)
  const demoCount = await seedPackages(supabase, DEMO_TENANT_ID, DEMO_PRESETS)

  console.info(`\n[seed] TOTAL — internal: ${internalCount}, demo: ${demoCount}`)
}

seed().catch((err) => {
  console.error('[seed] Fatal error:', err)
  process.exit(1)
})
