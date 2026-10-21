import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from '../__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../__test-support__/supabase-mock.js'
import { seedEntitledTenant } from '../__test-support__/tenant-fixture.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000pos0001'
const OTHER_TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000pos0002'
const USER_ID = 'user-pos-001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken(
    { sub: USER_ID, tenantId: TENANT_ID, role: 'owner', vertical: 'restaurant' },
    { secret: SECRET }
  )
}

// Sequential, not Promise.all — concurrent dynamic imports that share a newly
// common dependency can race in Jest's experimental VM-modules linker.
const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: menuRouter } = await import('./menu.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/pos/menu', menuRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  seedEntitledTenant(store, TENANT_ID, { modules: { pos: true } })
})

describe('POST /api/pos/menu/categories', () => {
  it('creates a category scoped to the caller tenant', async () => {
    const res = await request(makeApp())
      .post('/api/pos/menu/categories')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ name: 'Mains', sort_order: 1 })

    expect(res.status).toBe(201)
    expect(res.body.category.name).toBe('Mains')
    expect(res.body.category.tenant_id).toBe(TENANT_ID)
  })

  it('rejects a blank name', async () => {
    const res = await request(makeApp())
      .post('/api/pos/menu/categories')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ name: '   ' })

    expect(res.status).toBe(400)
  })
})

describe('pos module gate', () => {
  it('returns 403 when the pos module is disabled', async () => {
    seedEntitledTenant(store, TENANT_ID, { modules: { pos: false } })
    const res = await request(makeApp())
      .get('/api/pos/menu/tree')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(403)
  })
})

describe('GET /api/pos/menu/tree', () => {
  it('nests items under categories and modifier groups under items', async () => {
    store.tables['menu_categories'] = [
      { id: 'cat-1', tenant_id: TENANT_ID, name: 'Mains', sort_order: 0, deleted_at: null },
    ]
    store.tables['menu_items'] = [
      {
        id: 'item-1',
        tenant_id: TENANT_ID,
        category_id: 'cat-1',
        name: 'Burger',
        price: '12.00',
        taxable: true,
        kitchen_station: 'grill',
        available: true,
        sort_order: 0,
        deleted_at: null,
      },
    ]
    store.tables['modifier_groups'] = [
      {
        id: 'grp-1',
        tenant_id: TENANT_ID,
        name: 'Temperature',
        min_select: 1,
        max_select: 1,
        required: true,
        deleted_at: null,
      },
    ]
    store.tables['modifier_options'] = [
      {
        id: 'opt-1',
        tenant_id: TENANT_ID,
        group_id: 'grp-1',
        name: 'Medium',
        price_delta: '0.00',
        sort_order: 0,
        deleted_at: null,
      },
    ]
    store.tables['menu_item_modifier_groups'] = [
      { tenant_id: TENANT_ID, item_id: 'item-1', group_id: 'grp-1', sort_order: 0 },
    ]

    const res = await request(makeApp())
      .get('/api/pos/menu/tree')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.categories).toHaveLength(1)
    expect(res.body.categories[0].items).toHaveLength(1)
    expect(res.body.categories[0].items[0].modifier_groups).toHaveLength(1)
    expect(res.body.categories[0].items[0].modifier_groups[0].options[0].name).toBe('Medium')
  })

  it('excludes soft-deleted items', async () => {
    store.tables['menu_categories'] = [
      { id: 'cat-1', tenant_id: TENANT_ID, name: 'Mains', sort_order: 0, deleted_at: null },
    ]
    store.tables['menu_items'] = [
      {
        id: 'item-1',
        tenant_id: TENANT_ID,
        category_id: 'cat-1',
        name: 'Retired Burger',
        price: '12.00',
        taxable: true,
        kitchen_station: 'grill',
        available: true,
        sort_order: 0,
        deleted_at: '2026-01-01T00:00:00Z',
      },
    ]

    const res = await request(makeApp())
      .get('/api/pos/menu/tree')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.categories[0].items).toHaveLength(0)
  })

  it('does not return another tenant’s categories', async () => {
    store.tables['menu_categories'] = [
      { id: 'cat-x', tenant_id: OTHER_TENANT_ID, name: 'Theirs', sort_order: 0, deleted_at: null },
    ]

    const res = await request(makeApp())
      .get('/api/pos/menu/tree')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.categories).toHaveLength(0)
  })
})

// The ownership checks must not reject legitimate writes — without these the
// cross-tenant tests below would still pass if ownsRow rejected everything.
describe('same-tenant writes still succeed', () => {
  beforeEach(() => {
    store.tables['menu_categories'] = [
      { id: 'cat-1', tenant_id: TENANT_ID, name: 'Mains', sort_order: 0, deleted_at: null },
    ]
    store.tables['modifier_groups'] = [
      {
        id: 'grp-1',
        tenant_id: TENANT_ID,
        name: 'Temperature',
        min_select: 1,
        max_select: 1,
        required: true,
        deleted_at: null,
      },
    ]
    store.tables['menu_items'] = [
      {
        id: 'item-1',
        tenant_id: TENANT_ID,
        category_id: 'cat-1',
        name: 'Burger',
        price: '12.00',
        taxable: true,
        kitchen_station: 'grill',
        available: true,
        sort_order: 0,
        deleted_at: null,
      },
    ]
  })

  it('creates an item under the caller’s own category', async () => {
    const res = await request(makeApp())
      .post('/api/pos/menu/items')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ name: 'Fries', category_id: 'cat-1', price: 4.5, kitchen_station: 'fry' })

    expect(res.status).toBe(201)
    expect(res.body.item.name).toBe('Fries')
    expect(res.body.item.kitchen_station).toBe('fry')
  })

  it('creates an option under the caller’s own modifier group', async () => {
    const res = await request(makeApp())
      .post('/api/pos/menu/modifier-options')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ name: 'Rare', group_id: 'grp-1', price_delta: 0 })

    expect(res.status).toBe(201)
    expect(res.body.option.name).toBe('Rare')
  })

  it('links the caller’s own group to the caller’s own item', async () => {
    const res = await request(makeApp())
      .post('/api/pos/menu/items/item-1/modifier-groups/grp-1')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({})

    expect(res.status).toBe(201)
    expect(store.tables['menu_item_modifier_groups']).toHaveLength(1)
  })
})

// These routes run on the service-role client, which BYPASSES RLS. The
// application-level tenant filter is therefore the only boundary, so any
// foreign key arriving from the request must be proven to belong to the
// caller before it is written.
describe('cross-tenant foreign keys', () => {
  beforeEach(() => {
    store.tables['menu_categories'] = [
      {
        id: 'cat-theirs',
        tenant_id: OTHER_TENANT_ID,
        name: 'Theirs',
        sort_order: 0,
        deleted_at: null,
      },
    ]
    store.tables['modifier_groups'] = [
      {
        id: 'grp-theirs',
        tenant_id: OTHER_TENANT_ID,
        name: 'Theirs',
        min_select: 0,
        max_select: 1,
        required: false,
        deleted_at: null,
      },
    ]
    store.tables['menu_items'] = [
      {
        id: 'item-theirs',
        tenant_id: OTHER_TENANT_ID,
        category_id: 'cat-theirs',
        name: 'Theirs',
        price: '1.00',
        taxable: true,
        kitchen_station: null,
        available: true,
        sort_order: 0,
        deleted_at: null,
      },
    ]
  })

  it('refuses to create an item under another tenant’s category', async () => {
    const res = await request(makeApp())
      .post('/api/pos/menu/items')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ name: 'Smuggled', category_id: 'cat-theirs', price: 5 })

    expect(res.status).toBe(404)
    expect(store.tables['menu_items']).toHaveLength(1) // only the pre-existing foreign row
  })

  it('refuses to create an option under another tenant’s modifier group', async () => {
    const res = await request(makeApp())
      .post('/api/pos/menu/modifier-options')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ name: 'Smuggled', group_id: 'grp-theirs' })

    expect(res.status).toBe(404)
  })

  it('refuses to link another tenant’s modifier group to an item', async () => {
    store.tables['menu_items']!.push({
      id: 'item-mine',
      tenant_id: TENANT_ID,
      category_id: 'cat-1',
      name: 'Mine',
      price: '5.00',
      taxable: true,
      kitchen_station: null,
      available: true,
      sort_order: 0,
      deleted_at: null,
    })

    const res = await request(makeApp())
      .post('/api/pos/menu/items/item-mine/modifier-groups/grp-theirs')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({})

    expect(res.status).toBe(404)
    expect(store.tables['menu_item_modifier_groups'] ?? []).toHaveLength(0)
  })
})

describe('DELETE /api/pos/menu/items/:id', () => {
  it('404s for another tenant’s item instead of reporting a false success', async () => {
    store.tables['menu_items'] = [
      {
        id: 'item-theirs',
        tenant_id: OTHER_TENANT_ID,
        category_id: 'cat-theirs',
        name: 'Theirs',
        price: '1.00',
        taxable: true,
        kitchen_station: null,
        available: true,
        sort_order: 0,
        deleted_at: null,
      },
    ]

    const res = await request(makeApp())
      .delete('/api/pos/menu/items/item-theirs')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(404)
    expect(store.tables['menu_items']![0]!['deleted_at']).toBeNull()
  })

  it('soft-deletes rather than hard-deleting, so historical tickets keep resolving', async () => {
    store.tables['menu_items'] = [
      {
        id: 'item-1',
        tenant_id: TENANT_ID,
        category_id: 'cat-1',
        name: 'Burger',
        price: '12.00',
        taxable: true,
        kitchen_station: 'grill',
        available: true,
        sort_order: 0,
        deleted_at: null,
      },
    ]

    const res = await request(makeApp())
      .delete('/api/pos/menu/items/item-1')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(204)
    expect(store.tables['menu_items']).toHaveLength(1)
    expect(store.tables['menu_items']![0]!['deleted_at']).not.toBeNull()
  })
})

describe('DELETE /api/pos/menu/categories/:id', () => {
  function seedCategoryWithItem(itemOverrides: Record<string, unknown> = {}) {
    store.tables['menu_categories'] = [
      { id: 'cat-1', tenant_id: TENANT_ID, name: 'Mains', sort_order: 0, deleted_at: null },
    ]
    store.tables['menu_items'] = [
      {
        id: 'item-1',
        tenant_id: TENANT_ID,
        category_id: 'cat-1',
        name: 'Burger',
        price: '12.00',
        taxable: true,
        kitchen_station: 'grill',
        available: true,
        sort_order: 0,
        deleted_at: null,
        ...itemOverrides,
      },
    ]
  }

  it('refuses to delete a category that still has items, and says how many', async () => {
    // Deleting it anyway drops the items out of /tree — they key off
    // category_id, and a deleted category is filtered out — while leaving them
    // priceable by id through POST /orders. That is an item invisible on the
    // register and still sellable through the API, which is worse than a
    // refusal a merchant can act on.
    seedCategoryWithItem()

    const res = await request(makeApp())
      .delete('/api/pos/menu/categories/cat-1')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(409)
    expect(res.body.item_count).toBe(1)
    expect(store.tables['menu_categories']![0]!['deleted_at']).toBeNull()
  })

  it('deletes a category whose only items are already soft-deleted', async () => {
    seedCategoryWithItem({ deleted_at: '2026-10-01T00:00:00.000Z' })

    const res = await request(makeApp())
      .delete('/api/pos/menu/categories/cat-1')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(204)
    expect(store.tables['menu_categories']![0]!['deleted_at']).not.toBeNull()
  })

  it('does not count another tenant’s items as a reason to refuse', async () => {
    store.tables['menu_categories'] = [
      { id: 'cat-1', tenant_id: TENANT_ID, name: 'Mains', sort_order: 0, deleted_at: null },
    ]
    store.tables['menu_items'] = [
      {
        id: 'item-x',
        tenant_id: OTHER_TENANT_ID,
        category_id: 'cat-1',
        name: 'Not ours',
        price: '1.00',
        taxable: true,
        kitchen_station: null,
        available: true,
        sort_order: 0,
        deleted_at: null,
      },
    ]

    const res = await request(makeApp())
      .delete('/api/pos/menu/categories/cat-1')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(204)
  })
})

describe('PATCH /api/pos/menu/categories/:id', () => {
  beforeEach(() => {
    store.tables['menu_categories'] = [
      { id: 'cat-1', tenant_id: TENANT_ID, name: 'Mains', sort_order: 0, deleted_at: null },
      {
        id: 'cat-other',
        tenant_id: OTHER_TENANT_ID,
        name: 'Theirs',
        sort_order: 0,
        deleted_at: null,
      },
    ]
  })

  it('renames a category', async () => {
    const res = await request(makeApp())
      .patch('/api/pos/menu/categories/cat-1')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ name: 'Main courses' })

    expect(res.status).toBe(200)
    expect(res.body.category.name).toBe('Main courses')
  })

  it('changes the sort order', async () => {
    const res = await request(makeApp())
      .patch('/api/pos/menu/categories/cat-1')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ sort_order: 3 })

    expect(res.status).toBe(200)
    expect(res.body.category.sort_order).toBe(3)
  })

  it('rejects a blank name rather than storing an unnamed category', async () => {
    const res = await request(makeApp())
      .patch('/api/pos/menu/categories/cat-1')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ name: '   ' })

    expect(res.status).toBe(400)
  })

  it('404s for another tenant’s category instead of renaming it', async () => {
    const res = await request(makeApp())
      .patch('/api/pos/menu/categories/cat-other')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ name: 'Mine now' })

    expect(res.status).toBe(404)
    expect(store.tables['menu_categories']![1]!['name']).toBe('Theirs')
  })
})

describe('DELETE /api/pos/menu/modifier-options/:id', () => {
  beforeEach(() => {
    store.tables['modifier_options'] = [
      {
        id: 'opt-1',
        tenant_id: TENANT_ID,
        group_id: 'grp-1',
        name: 'Bacon',
        price_delta: '1.50',
        sort_order: 0,
        deleted_at: null,
      },
      {
        id: 'opt-other',
        tenant_id: OTHER_TENANT_ID,
        group_id: 'grp-x',
        name: 'Theirs',
        price_delta: '0.00',
        sort_order: 0,
        deleted_at: null,
      },
    ]
  })

  it('soft-deletes, so a past ticket’s modifier snapshot still resolves', async () => {
    const res = await request(makeApp())
      .delete('/api/pos/menu/modifier-options/opt-1')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(204)
    expect(store.tables['modifier_options']![0]!['deleted_at']).not.toBeNull()
  })

  it('404s for another tenant’s option instead of reporting a false success', async () => {
    const res = await request(makeApp())
      .delete('/api/pos/menu/modifier-options/opt-other')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(404)
    expect(store.tables['modifier_options']![1]!['deleted_at']).toBeNull()
  })
})

describe('DELETE /api/pos/menu/modifier-groups/:id', () => {
  beforeEach(() => {
    store.tables['modifier_groups'] = [
      {
        id: 'grp-1',
        tenant_id: TENANT_ID,
        name: 'Extras',
        min_select: 0,
        max_select: 3,
        required: false,
        deleted_at: null,
      },
      {
        id: 'grp-other',
        tenant_id: OTHER_TENANT_ID,
        name: 'Theirs',
        min_select: 0,
        max_select: 1,
        required: false,
        deleted_at: null,
      },
    ]
  })

  it('soft-deletes the group', async () => {
    const res = await request(makeApp())
      .delete('/api/pos/menu/modifier-groups/grp-1')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(204)
    expect(store.tables['modifier_groups']![0]!['deleted_at']).not.toBeNull()
  })

  it('404s for another tenant’s group', async () => {
    const res = await request(makeApp())
      .delete('/api/pos/menu/modifier-groups/grp-other')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(404)
    expect(store.tables['modifier_groups']![1]!['deleted_at']).toBeNull()
  })
})

describe('GET /api/pos/menu/modifier-groups', () => {
  beforeEach(() => {
    store.tables['modifier_groups'] = [
      {
        id: 'grp-1',
        tenant_id: TENANT_ID,
        name: 'Extras',
        min_select: 0,
        max_select: 3,
        required: false,
        deleted_at: null,
      },
      {
        id: 'grp-gone',
        tenant_id: TENANT_ID,
        name: 'Retired',
        min_select: 0,
        max_select: 1,
        required: false,
        deleted_at: '2026-10-01T00:00:00.000Z',
      },
      {
        id: 'grp-other',
        tenant_id: OTHER_TENANT_ID,
        name: 'Theirs',
        min_select: 0,
        max_select: 1,
        required: false,
        deleted_at: null,
      },
    ]
    store.tables['modifier_options'] = [
      {
        id: 'opt-1',
        tenant_id: TENANT_ID,
        group_id: 'grp-1',
        name: 'Bacon',
        price_delta: '1.50',
        sort_order: 1,
        deleted_at: null,
      },
      {
        id: 'opt-0',
        tenant_id: TENANT_ID,
        group_id: 'grp-1',
        name: 'Cheddar',
        price_delta: '1.00',
        sort_order: 0,
        deleted_at: null,
      },
      {
        id: 'opt-gone',
        tenant_id: TENANT_ID,
        group_id: 'grp-1',
        name: 'Removed',
        price_delta: '0.00',
        sort_order: 2,
        deleted_at: '2026-10-01T00:00:00.000Z',
      },
    ]
  })

  it('lists the tenant’s live groups with their options in sort order', async () => {
    // /tree only nests groups under the items they are linked to, so a group
    // that has just been created — and is not attached to anything yet — is
    // invisible there. Without this the admin screen cannot offer it.
    const res = await request(makeApp())
      .get('/api/pos/menu/modifier-groups')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.groups).toHaveLength(1)
    expect(res.body.groups[0].id).toBe('grp-1')
    expect(res.body.groups[0].options.map((o: { name: string }) => o.name)).toEqual([
      'Cheddar',
      'Bacon',
    ])
  })

  it('does not list another tenant’s groups', async () => {
    const res = await request(makeApp())
      .get('/api/pos/menu/modifier-groups')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(JSON.stringify(res.body)).not.toContain('Theirs')
  })
})

describe('PATCH /api/pos/menu/items/:id — moving an item between categories', () => {
  beforeEach(() => {
    store.tables['menu_categories'] = [
      { id: 'cat-1', tenant_id: TENANT_ID, name: 'Mains', sort_order: 0, deleted_at: null },
      { id: 'cat-2', tenant_id: TENANT_ID, name: 'Sides', sort_order: 1, deleted_at: null },
      {
        id: 'cat-other',
        tenant_id: OTHER_TENANT_ID,
        name: 'Theirs',
        sort_order: 0,
        deleted_at: null,
      },
    ]
    store.tables['menu_items'] = [
      {
        id: 'item-1',
        tenant_id: TENANT_ID,
        category_id: 'cat-1',
        name: 'Fries',
        price: '4.00',
        taxable: true,
        kitchen_station: 'fry',
        available: true,
        sort_order: 0,
        deleted_at: null,
      },
    ]
  })

  it('moves the item to another of the tenant’s categories', async () => {
    // Deleting a category is refused while it still holds items, and the
    // refusal tells the merchant to move them — so there has to be a way to.
    const res = await request(makeApp())
      .patch('/api/pos/menu/items/item-1')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ category_id: 'cat-2' })

    expect(res.status).toBe(200)
    expect(store.tables['menu_items']![0]!['category_id']).toBe('cat-2')
  })

  it('refuses to move an item into another tenant’s category', async () => {
    // getServiceClient bypasses RLS, so this app-level check is the only
    // boundary — the same hole this file already closed for item creation.
    const res = await request(makeApp())
      .patch('/api/pos/menu/items/item-1')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ category_id: 'cat-other' })

    expect(res.status).toBe(404)
    expect(store.tables['menu_items']![0]!['category_id']).toBe('cat-1')
  })
})
