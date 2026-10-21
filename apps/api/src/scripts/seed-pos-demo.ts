import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'
import { hashPin } from '../lib/pos-pin.js'

/**
 * Seeds a restaurant menu, a POS entitlement, and register PINs for a demo
 * tenant.
 *
 * Run deliberately, never automatically:
 *
 *   npx tsx apps/api/src/scripts/seed-pos-demo.ts <tenant_id> <location_id>
 *
 * The prototype this replaces seeded demo data from inside React hooks whenever
 * a store looked empty, which on a real merchant's first load would have
 * invented a menu for them. Nothing here runs on import.
 *
 * Idempotent: re-running skips anything already present rather than
 * duplicating it.
 */

interface SeedOption {
  name: string
  priceDelta: number
}

interface SeedGroup {
  key: string
  name: string
  minSelect: number
  maxSelect: number
  required: boolean
  options: SeedOption[]
}

interface SeedItem {
  name: string
  price: number
  station: string | null
  taxable?: boolean
  groups?: string[]
}

const GROUPS: SeedGroup[] = [
  {
    key: 'temp',
    name: 'Temperature',
    minSelect: 1,
    maxSelect: 1,
    required: true,
    options: [
      { name: 'Rare', priceDelta: 0 },
      { name: 'Medium rare', priceDelta: 0 },
      { name: 'Medium', priceDelta: 0 },
      { name: 'Well done', priceDelta: 0 },
    ],
  },
  {
    key: 'addons',
    name: 'Add-ons',
    minSelect: 0,
    maxSelect: 4,
    required: false,
    options: [
      { name: 'Cheddar', priceDelta: 1.5 },
      { name: 'Bacon', priceDelta: 2.5 },
      { name: 'Fried egg', priceDelta: 2.0 },
      { name: 'Avocado', priceDelta: 2.5 },
    ],
  },
  {
    key: 'dressing',
    name: 'Dressing',
    minSelect: 1,
    maxSelect: 1,
    required: true,
    options: [
      { name: 'Caesar', priceDelta: 0 },
      { name: 'Ranch', priceDelta: 0 },
      { name: 'Vinaigrette', priceDelta: 0 },
      { name: 'No dressing', priceDelta: 0 },
    ],
  },
]

/**
 * Stations are spread across grill / fry / cold / bar on purpose: a single
 * order then fires as several tickets, which is the behaviour the KDS exists
 * to show. A menu routed entirely to one station demos nothing.
 */
const MENU: Array<{ category: string; items: SeedItem[] }> = [
  {
    category: 'Burgers',
    items: [
      { name: 'Classic Burger', price: 12.0, station: 'grill', groups: ['temp', 'addons'] },
      { name: 'Double Smash', price: 15.5, station: 'grill', groups: ['temp', 'addons'] },
      { name: 'Mushroom Swiss', price: 14.0, station: 'grill', groups: ['temp', 'addons'] },
      { name: 'Veggie Burger', price: 13.0, station: 'grill', groups: ['addons'] },
    ],
  },
  {
    category: 'Sides',
    items: [
      { name: 'Fries', price: 4.5, station: 'fry' },
      { name: 'Sweet Potato Fries', price: 5.5, station: 'fry' },
      { name: 'Onion Rings', price: 5.0, station: 'fry' },
      { name: 'Mozzarella Sticks', price: 6.5, station: 'fry' },
    ],
  },
  {
    category: 'Salads',
    items: [
      { name: 'Caesar Salad', price: 9.0, station: 'cold', groups: ['dressing'] },
      { name: 'Garden Salad', price: 8.5, station: 'cold', groups: ['dressing'] },
      { name: 'Cobb Salad', price: 12.5, station: 'cold', groups: ['dressing'] },
    ],
  },
  {
    category: 'Drinks',
    items: [
      { name: 'Fountain Soda', price: 3.0, station: 'bar' },
      { name: 'Iced Tea', price: 3.0, station: 'bar' },
      { name: 'Draft Beer', price: 7.0, station: 'bar' },
      { name: 'House Wine', price: 9.0, station: 'bar' },
    ],
  },
  {
    category: 'Desserts',
    items: [
      { name: 'Cheesecake', price: 7.5, station: 'cold' },
      { name: 'Brownie Sundae', price: 8.0, station: 'cold' },
      // Deliberately unrouted: exercises the "no station" ticket path.
      { name: 'Gift Card $25', price: 25.0, station: null, taxable: false },
    ],
  },
]

/** Staff who can sign in at a register. PINs are demo values, printed on run. */
const PINS: Array<{ match: string; pin: string }> = [
  { match: 'Alex Brown', pin: '1234' },
  { match: 'Carlos Mendez', pin: '4321' },
]

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  return createClient(url, key)
}

async function main(): Promise<void> {
  const tenantId = process.argv[2]
  const locationId = process.argv[3]

  if (!tenantId || !locationId) {
    console.error('usage: tsx apps/api/src/scripts/seed-pos-demo.ts <tenant_id> <location_id>')
    process.exit(1)
  }

  const supabase = getSupabase()

  // ── 1. Confirm the tenant and location exist and belong together ──────────
  const { data: location } = await supabase
    .from('locations')
    .select('id, name, tenant_id')
    .eq('id', locationId)
    .eq('tenant_id', tenantId)
    .maybeSingle<{ id: string; name: string; tenant_id: string }>()

  if (!location) {
    console.error(
      `[seed-pos-demo] location ${locationId} not found for tenant ${tenantId} — refusing to seed`
    )
    process.exit(1)
  }
  console.info(`[seed-pos-demo] seeding "${location.name}" (tenant ${tenantId})`)

  // ── 2. Enable the pos module ─────────────────────────────────────────────
  // An explicit boolean on tenants.modules wins over the plan default, so this
  // works without moving the tenant to the Scale plan.
  const { data: tenant } = await supabase
    .from('tenants')
    .select('modules')
    .eq('id', tenantId)
    .maybeSingle<{ modules: Record<string, boolean> | null }>()

  const modules = { ...(tenant?.modules ?? {}), pos: true }
  const { error: moduleError } = await supabase
    .from('tenants')
    .update({ modules })
    .eq('id', tenantId)
  if (moduleError) {
    console.error(`[seed-pos-demo] failed to enable the pos module: ${moduleError.message}`)
    process.exit(1)
  }
  console.info('[seed-pos-demo] pos module enabled')

  // ── 3. Modifier groups and options ───────────────────────────────────────
  const groupIdByKey = new Map<string, string>()

  for (const group of GROUPS) {
    const { data: existing } = await supabase
      .from('modifier_groups')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('name', group.name)
      .is('deleted_at', null)
      .maybeSingle<{ id: string }>()

    if (existing) {
      groupIdByKey.set(group.key, existing.id)
      console.info(`[seed-pos-demo] modifier group "${group.name}" exists — skipping`)
      continue
    }

    const { data: created, error } = await supabase
      .from('modifier_groups')
      .insert({
        tenant_id: tenantId,
        name: group.name,
        min_select: group.minSelect,
        max_select: group.maxSelect,
        required: group.required,
      })
      .select('id')
      .single<{ id: string }>()

    if (error || !created) {
      console.error(`[seed-pos-demo] modifier group "${group.name}" failed: ${error?.message}`)
      continue
    }
    groupIdByKey.set(group.key, created.id)

    const { error: optError } = await supabase.from('modifier_options').insert(
      group.options.map((o, i) => ({
        tenant_id: tenantId,
        group_id: created.id,
        name: o.name,
        price_delta: o.priceDelta,
        sort_order: i,
      }))
    )
    if (optError) {
      console.error(`[seed-pos-demo] options for "${group.name}" failed: ${optError.message}`)
      continue
    }
    console.info(
      `[seed-pos-demo] created modifier group "${group.name}" with ${group.options.length} options`
    )
  }

  // ── 4. Categories, items, and their modifier links ───────────────────────
  let itemCount = 0
  let linkCount = 0

  for (const [catIndex, section] of MENU.entries()) {
    const { data: existingCat } = await supabase
      .from('menu_categories')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('name', section.category)
      .is('deleted_at', null)
      .maybeSingle<{ id: string }>()

    let categoryId = existingCat?.id
    if (!categoryId) {
      const { data: created, error } = await supabase
        .from('menu_categories')
        .insert({ tenant_id: tenantId, name: section.category, sort_order: catIndex })
        .select('id')
        .single<{ id: string }>()
      if (error || !created) {
        console.error(`[seed-pos-demo] category "${section.category}" failed: ${error?.message}`)
        continue
      }
      categoryId = created.id
    }

    for (const [itemIndex, item] of section.items.entries()) {
      const { data: existingItem } = await supabase
        .from('menu_items')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('name', item.name)
        .is('deleted_at', null)
        .maybeSingle<{ id: string }>()

      if (existingItem) continue

      const { data: created, error } = await supabase
        .from('menu_items')
        .insert({
          tenant_id: tenantId,
          category_id: categoryId,
          name: item.name,
          price: item.price,
          taxable: item.taxable ?? true,
          kitchen_station: item.station,
          available: true,
          sort_order: itemIndex,
        })
        .select('id')
        .single<{ id: string }>()

      if (error || !created) {
        console.error(`[seed-pos-demo] item "${item.name}" failed: ${error?.message}`)
        continue
      }
      itemCount += 1

      for (const [linkIndex, key] of (item.groups ?? []).entries()) {
        const groupId = groupIdByKey.get(key)
        if (!groupId) continue
        const { error: linkError } = await supabase.from('menu_item_modifier_groups').insert({
          tenant_id: tenantId,
          item_id: created.id,
          group_id: groupId,
          sort_order: linkIndex,
        })
        if (!linkError) linkCount += 1
      }
    }
  }
  console.info(`[seed-pos-demo] created ${itemCount} menu items, ${linkCount} modifier links`)

  // ── 5. Register PINs ─────────────────────────────────────────────────────
  for (const { match, pin } of PINS) {
    const { data: staff } = await supabase
      .from('staff_members')
      .select('id, name, pos_location_ids')
      .eq('tenant_id', tenantId)
      .eq('name', match)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle<{ id: string; name: string; pos_location_ids: string[] | null }>()

    if (!staff) {
      console.warn(`[seed-pos-demo] no active staff named "${match}" — skipping PIN`)
      continue
    }

    const locations = new Set(staff.pos_location_ids ?? [])
    locations.add(locationId)

    const { error } = await supabase
      .from('staff_members')
      .update({
        pos_pin_hash: await hashPin(pin),
        pos_location_ids: [...locations],
      })
      .eq('id', staff.id)
      .eq('tenant_id', tenantId)

    if (error) {
      console.error(`[seed-pos-demo] PIN for "${match}" failed: ${error.message}`)
      continue
    }
    console.info(`[seed-pos-demo] ${staff.name} can sign in with PIN ${pin}`)
  }

  console.info('[seed-pos-demo] done')
}

main().catch((err) => {
  console.error('[seed-pos-demo] fatal:', err)
  process.exit(1)
})
