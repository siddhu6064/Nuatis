import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from '../__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../__test-support__/supabase-mock.js'
import { seedEntitledTenant } from '../__test-support__/tenant-fixture.js'

let store: MockStore = createStore()

const broadcastToLocation = jest.fn()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../../lib/pos-ws.js', () => ({
  broadcastToLocation,
  initPosWs: () => ({}),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000tkt0001'
const OTHER_TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000tkt0002'
const LOCATION_ID = 'bbbbbbbb-0000-0000-0000-00000loc0001'
const ORDER_ID = 'cccccccc-0000-0000-0000-00000ord0001'
const USER_ID = 'user-tkt-001'
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

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: ticketsRouter } = await import('./tickets.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/pos/tickets', ticketsRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  seedEntitledTenant(store, TENANT_ID, { modules: { pos: true }, timezone: 'America/Chicago' })
  broadcastToLocation.mockClear()
  store.tables['orders'] = [
    {
      id: ORDER_ID,
      tenant_id: TENANT_ID,
      location_id: LOCATION_ID,
      order_number: 'POS-1',
      status: 'confirmed',
      source: 'pos',
    },
  ]
  store.tables['order_line_items'] = [
    {
      id: 'line-1',
      order_id: ORDER_ID,
      tenant_id: TENANT_ID,
      menu_item_id: 'item-1',
      description: 'Burger',
      quantity: 2,
      unit_price: '12.00',
      modifiers: [{ option_id: 'opt-1', option_name: 'Cheese', price_delta: '1.50' }],
      notes: 'no pickles',
    },
  ]
  store.tables['menu_items'] = [
    {
      id: 'item-1',
      tenant_id: TENANT_ID,
      category_id: 'cat-1',
      name: 'Burger',
      kitchen_station: 'grill',
      deleted_at: null,
    },
  ]
  store.tables['kitchen_tickets'] = []
  store.tables['kitchen_ticket_items'] = []
})

describe('POST /api/pos/tickets/fire', () => {
  it('creates one ticket per station with snapshotted line text', async () => {
    const res = await request(makeApp())
      .post('/api/pos/tickets/fire')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ order_id: ORDER_ID })

    expect(res.status).toBe(201)
    expect(res.body.tickets).toHaveLength(1)
    expect(res.body.tickets[0].station).toBe('grill')

    const items = store.tables['kitchen_ticket_items'] ?? []
    expect(items).toHaveLength(1)
    expect(items[0]!['name']).toBe('Burger')
    expect(items[0]!['notes']).toBe('no pickles')
  })

  it('stamps a service_date in the tenant timezone', async () => {
    const res = await request(makeApp())
      .post('/api/pos/tickets/fire')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ order_id: ORDER_ID })

    expect(res.status).toBe(201)
    const ticket = (store.tables['kitchen_tickets'] ?? [])[0]
    expect(ticket!['service_date']).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('broadcasts to the order’s location, not tenant-wide', async () => {
    await request(makeApp())
      .post('/api/pos/tickets/fire')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ order_id: ORDER_ID })

    expect(broadcastToLocation).toHaveBeenCalledTimes(1)
    const [tenantArg, locationArg, event] = broadcastToLocation.mock.calls[0] as [
      string,
      string,
      { type: string },
    ]
    expect(tenantArg).toBe(TENANT_ID)
    expect(locationArg).toBe(LOCATION_ID)
    expect(event.type).toBe('ticket.fired')
  })

  it('splits lines across stations into separate tickets', async () => {
    store.tables['menu_items']!.push({
      id: 'item-2',
      tenant_id: TENANT_ID,
      category_id: 'cat-1',
      name: 'Caesar Salad',
      kitchen_station: 'cold',
      deleted_at: null,
    })
    store.tables['order_line_items']!.push({
      id: 'line-2',
      order_id: ORDER_ID,
      tenant_id: TENANT_ID,
      menu_item_id: 'item-2',
      description: 'Caesar Salad',
      quantity: 1,
      unit_price: '9.00',
      modifiers: [],
      notes: null,
    })

    const res = await request(makeApp())
      .post('/api/pos/tickets/fire')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ order_id: ORDER_ID })

    expect(res.status).toBe(201)
    expect(res.body.tickets).toHaveLength(2)
    expect(res.body.tickets.map((t: { station: string }) => t.station).sort()).toEqual([
      'cold',
      'grill',
    ])
  })

  it('gives each station ticket a distinct number', async () => {
    store.tables['menu_items']!.push({
      id: 'item-2',
      tenant_id: TENANT_ID,
      category_id: 'cat-1',
      name: 'Caesar Salad',
      kitchen_station: 'cold',
      deleted_at: null,
    })
    store.tables['order_line_items']!.push({
      id: 'line-2',
      order_id: ORDER_ID,
      tenant_id: TENANT_ID,
      menu_item_id: 'item-2',
      description: 'Caesar Salad',
      quantity: 1,
      unit_price: '9.00',
      modifiers: [],
      notes: null,
    })

    await request(makeApp())
      .post('/api/pos/tickets/fire')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ order_id: ORDER_ID })

    const numbers = (store.tables['kitchen_tickets'] ?? []).map((t) => t['ticket_number'])
    expect(new Set(numbers).size).toBe(numbers.length)
  })

  it('continues numbering from the highest ticket already on this service day', async () => {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    store.tables['kitchen_tickets'] = [
      {
        id: 'tkt-old',
        tenant_id: TENANT_ID,
        location_id: LOCATION_ID,
        order_id: ORDER_ID,
        station: 'grill',
        status: 'bumped',
        ticket_number: 7,
        service_date: today,
      },
    ]

    await request(makeApp())
      .post('/api/pos/tickets/fire')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ order_id: ORDER_ID })

    const fresh = (store.tables['kitchen_tickets'] ?? []).find((t) => t['id'] !== 'tkt-old')
    expect(fresh!['ticket_number']).toBe(8)
  })

  it('does not continue numbering from a previous service day', async () => {
    store.tables['kitchen_tickets'] = [
      {
        id: 'tkt-yesterday',
        tenant_id: TENANT_ID,
        location_id: LOCATION_ID,
        order_id: ORDER_ID,
        station: 'grill',
        status: 'bumped',
        ticket_number: 99,
        service_date: '2020-01-01',
      },
    ]

    await request(makeApp())
      .post('/api/pos/tickets/fire')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ order_id: ORDER_ID })

    const fresh = (store.tables['kitchen_tickets'] ?? []).find((t) => t['id'] !== 'tkt-yesterday')
    expect(fresh!['ticket_number']).toBe(1)
  })

  it('does not continue numbering from another location', async () => {
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
    store.tables['kitchen_tickets'] = [
      {
        id: 'tkt-elsewhere',
        tenant_id: TENANT_ID,
        location_id: 'other-location',
        order_id: ORDER_ID,
        station: 'grill',
        status: 'queued',
        ticket_number: 42,
        service_date: today,
      },
    ]

    await request(makeApp())
      .post('/api/pos/tickets/fire')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ order_id: ORDER_ID })

    const fresh = (store.tables['kitchen_tickets'] ?? []).find((t) => t['id'] !== 'tkt-elsewhere')
    expect(fresh!['ticket_number']).toBe(1)
  })

  it('404s for an order belonging to another tenant', async () => {
    store.tables['orders'] = [
      {
        id: ORDER_ID,
        tenant_id: OTHER_TENANT_ID,
        location_id: LOCATION_ID,
        order_number: 'POS-1',
        status: 'confirmed',
        source: 'pos',
      },
    ]

    const res = await request(makeApp())
      .post('/api/pos/tickets/fire')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ order_id: ORDER_ID })

    expect(res.status).toBe(404)
  })

  it('400s when the order has no line items', async () => {
    store.tables['order_line_items'] = []

    const res = await request(makeApp())
      .post('/api/pos/tickets/fire')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ order_id: ORDER_ID })

    expect(res.status).toBe(400)
  })

  it('400s when the order has no location — a ticket must be routable', async () => {
    store.tables['orders'] = [
      {
        id: ORDER_ID,
        tenant_id: TENANT_ID,
        location_id: null,
        order_number: 'POS-1',
        status: 'confirmed',
        source: 'pos',
      },
    ]

    const res = await request(makeApp())
      .post('/api/pos/tickets/fire')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ order_id: ORDER_ID })

    expect(res.status).toBe(400)
    expect(broadcastToLocation).not.toHaveBeenCalled()
  })

  it('does not route a line using another tenant’s menu item station', async () => {
    // The station lookup must be tenant-scoped; otherwise a line pointing at a
    // foreign menu item would inherit that tenant's station routing.
    store.tables['menu_items'] = [
      {
        id: 'item-1',
        tenant_id: OTHER_TENANT_ID,
        category_id: 'cat-1',
        name: 'Theirs',
        kitchen_station: 'their-grill',
        deleted_at: null,
      },
    ]

    const res = await request(makeApp())
      .post('/api/pos/tickets/fire')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ order_id: ORDER_ID })

    expect(res.status).toBe(201)
    expect(res.body.tickets[0].station).toBeNull()
  })
})

describe('PATCH /api/pos/tickets/:id/status', () => {
  beforeEach(() => {
    store.tables['kitchen_tickets'] = [
      {
        id: 'tkt-1',
        tenant_id: TENANT_ID,
        location_id: LOCATION_ID,
        order_id: ORDER_ID,
        station: 'grill',
        status: 'queued',
        ticket_number: 1,
        service_date: '2026-09-11',
      },
    ]
  })

  it('bumps a ticket and broadcasts', async () => {
    const res = await request(makeApp())
      .patch('/api/pos/tickets/tkt-1/status')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ status: 'bumped' })

    expect(res.status).toBe(200)
    expect(res.body.ticket.status).toBe('bumped')
    expect(broadcastToLocation).toHaveBeenCalledWith(
      TENANT_ID,
      LOCATION_ID,
      expect.objectContaining({ type: 'ticket.bumped' })
    )
  })

  it('stamps started_at when moving to in_progress', async () => {
    const res = await request(makeApp())
      .patch('/api/pos/tickets/tkt-1/status')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ status: 'in_progress' })

    expect(res.status).toBe(200)
    expect(res.body.ticket.started_at).toBeTruthy()
  })

  it('rejects an unknown status', async () => {
    const res = await request(makeApp())
      .patch('/api/pos/tickets/tkt-1/status')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ status: 'incinerated' })

    expect(res.status).toBe(400)
  })

  it('404s for another tenant’s ticket and does not broadcast', async () => {
    store.tables['kitchen_tickets'] = [
      {
        id: 'tkt-1',
        tenant_id: OTHER_TENANT_ID,
        location_id: LOCATION_ID,
        order_id: ORDER_ID,
        station: 'grill',
        status: 'queued',
        ticket_number: 1,
        service_date: '2026-09-11',
      },
    ]

    const res = await request(makeApp())
      .patch('/api/pos/tickets/tkt-1/status')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ status: 'bumped' })

    expect(res.status).toBe(404)
    expect(broadcastToLocation).not.toHaveBeenCalled()
  })
})

describe('GET /api/pos/tickets', () => {
  it('requires a location_id so a request can never span locations', async () => {
    const res = await request(makeApp())
      .get('/api/pos/tickets')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(400)
  })

  it('returns only tickets for the requested location', async () => {
    store.tables['kitchen_tickets'] = [
      {
        id: 'tkt-1',
        tenant_id: TENANT_ID,
        location_id: LOCATION_ID,
        order_id: ORDER_ID,
        station: 'grill',
        status: 'queued',
        ticket_number: 1,
        service_date: '2026-09-11',
      },
      {
        id: 'tkt-2',
        tenant_id: TENANT_ID,
        location_id: 'other-location',
        order_id: ORDER_ID,
        station: 'grill',
        status: 'queued',
        ticket_number: 1,
        service_date: '2026-09-11',
      },
    ]

    const res = await request(makeApp())
      .get(`/api/pos/tickets?location_id=${LOCATION_ID}`)
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.tickets).toHaveLength(1)
    expect(res.body.tickets[0].id).toBe('tkt-1')
  })

  it('attaches only the items belonging to each ticket', async () => {
    store.tables['kitchen_tickets'] = [
      {
        id: 'tkt-1',
        tenant_id: TENANT_ID,
        location_id: LOCATION_ID,
        order_id: ORDER_ID,
        station: 'grill',
        status: 'queued',
        ticket_number: 1,
        service_date: '2026-09-11',
      },
    ]
    store.tables['kitchen_ticket_items'] = [
      { id: 'kti-1', tenant_id: TENANT_ID, ticket_id: 'tkt-1', name: 'Burger', quantity: 1 },
      { id: 'kti-2', tenant_id: TENANT_ID, ticket_id: 'tkt-other', name: 'Fries', quantity: 1 },
    ]

    const res = await request(makeApp())
      .get(`/api/pos/tickets?location_id=${LOCATION_ID}`)
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.tickets[0].items).toHaveLength(1)
    expect(res.body.tickets[0].items[0].name).toBe('Burger')
  })
})
