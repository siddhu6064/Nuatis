import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const { SEEDED_TYPES, seedIncidentTypes } = await import('./incident-types.js')

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000typ0001'

beforeEach(() => {
  store = createStore()
  store.tables['incident_types'] = []
  store.tables['menu_items'] = []
})

function seededKeys(): string[] {
  return (store.tables['incident_types'] ?? []).map((r) => String(r['key']))
}

describe('seeded incident types', () => {
  it('gives a restaurant the reasons a till actually needs', () => {
    const keys = SEEDED_TYPES['restaurant']!.map((t) => t.key)
    expect(keys).toEqual(
      expect.arrayContaining(['wrong_item', 'allergy', 'dropped', 'late', 'equipment'])
    )
  })

  it('has a default set for a vertical with no specific list', () => {
    expect(SEEDED_TYPES['default']!.length).toBeGreaterThan(0)
  })

  it('marks allergy critical — it is the one that ends up in a newspaper', () => {
    const allergy = SEEDED_TYPES['restaurant']!.find((t) => t.key === 'allergy')
    expect(allergy?.default_severity).toBe('critical')
  })

  it('marks wastage as always carrying a cost', () => {
    const dropped = SEEDED_TYPES['restaurant']!.find((t) => t.key === 'dropped')
    expect(dropped?.requires_cost).toBe(true)
  })

  it('uses keys that are stable identifiers, not labels', () => {
    for (const list of Object.values(SEEDED_TYPES)) {
      for (const t of list) {
        expect(t.key).toMatch(/^[a-z][a-z0-9_]*$/)
      }
    }
  })
})

describe('seedIncidentTypes', () => {
  it('uses the vertical when it has a list of its own', async () => {
    await seedIncidentTypes(TENANT_ID, 'restaurant')
    expect(seededKeys()).toContain('allergy')
  })

  it('falls back to the generic set for a vertical with no list and no kitchen', async () => {
    await seedIncidentTypes(TENANT_ID, 'law_firm')
    expect(seededKeys()).toContain('service_failure')
    expect(seededKeys()).not.toContain('allergy')
  })

  it('uses restaurant types when the tenant has a menu, whatever the vertical says', async () => {
    // The demo tenant is the real case: vertical 'sales_crm', 18 menu items and
    // a burger register. menu_items carries kitchen_station, so a tenant with a
    // menu has a kitchen — a stronger signal than a signup dropdown.
    store.tables['menu_items'] = [{ id: 'm1', tenant_id: TENANT_ID, name: 'Burger' }]

    await seedIncidentTypes(TENANT_ID, 'sales_crm')

    expect(seededKeys()).toContain('allergy')
    expect(seededKeys()).not.toContain('service_failure')
  })

  it("does not borrow another tenant's menu as evidence of a kitchen", async () => {
    store.tables['menu_items'] = [{ id: 'm1', tenant_id: 'someone-else', name: 'Burger' }]

    await seedIncidentTypes(TENANT_ID, 'sales_crm')

    expect(seededKeys()).toContain('service_failure')
    expect(seededKeys()).not.toContain('allergy')
  })

  it('still respects an explicit vertical over the menu signal', async () => {
    // A vertical with its own list wins: the merchant said what they are.
    store.tables['menu_items'] = [{ id: 'm1', tenant_id: TENANT_ID, name: 'Burger' }]

    await seedIncidentTypes(TENANT_ID, 'restaurant')

    expect(seededKeys()).toContain('allergy')
  })

  it('is idempotent — a second call adds nothing', async () => {
    await seedIncidentTypes(TENANT_ID, 'restaurant')
    const first = seededKeys().length

    await seedIncidentTypes(TENANT_ID, 'restaurant')

    expect(seededKeys()).toHaveLength(first)
  })

  it('never overwrites a type the tenant has edited', async () => {
    store.tables['incident_types'] = [
      {
        id: 't1',
        tenant_id: TENANT_ID,
        key: 'wrong_item',
        label: 'Our own wording',
        default_severity: 'low',
        requires_cost: false,
        sort_order: 0,
        deleted_at: null,
      },
    ]

    await seedIncidentTypes(TENANT_ID, 'restaurant')

    expect(store.tables['incident_types']).toHaveLength(1)
    expect(store.tables['incident_types']![0]!['label']).toBe('Our own wording')
  })
})
