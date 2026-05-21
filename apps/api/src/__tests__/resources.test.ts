import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

jest.unstable_mockModule('../lib/auth.js', () => ({
  requireAuth: (
    _req: { tenantId: string; userId: string; role: string },
    _res: unknown,
    next: () => void
  ) => {
    _req.tenantId = 'tenant-1'
    _req.userId = 'user-1'
    _req.role = 'admin'
    next()
  },
}))

// Dynamic imports AFTER mocks
const [
  { default: express },
  { default: request },
  { default: resourcesRouter },
  { checkResourceAvailable },
] = await Promise.all([
  import('express'),
  import('supertest'),
  import('../routes/resources.js'),
  import('../lib/resource-availability.js'),
])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/resources', resourcesRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['bookable_resources'] = []
  store.tables['resource_bookings'] = []
})

function seedResource(overrides: Partial<Row> = {}): Row {
  const r: Row = {
    id: 'res-1',
    tenant_id: 'tenant-1',
    location_id: null,
    name: 'Treatment Room 1',
    resource_type: 'room',
    capacity: 1,
    color: '#007A6E',
    status: 'active',
    notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
  ;(store.tables['bookable_resources'] as Row[]).push(r)
  return r
}

// ── Test 1: checkResourceAvailable returns true when no overlapping bookings ──
describe('checkResourceAvailable — no overlap', () => {
  it('returns true when resource_bookings table is empty', async () => {
    // store.tables['resource_bookings'] is empty
    const result = await checkResourceAvailable({
      resourceId: 'res-1',
      startTime: new Date('2025-06-01T09:00:00Z'),
      endTime: new Date('2025-06-01T10:00:00Z'),
    })
    expect(result).toBe(true)
  })
})

// ── Test 2: checkResourceAvailable returns false when booking exactly overlaps ─
describe('checkResourceAvailable — exact overlap', () => {
  it('returns false when an existing confirmed booking covers the same time', async () => {
    ;(store.tables['resource_bookings'] as Row[]).push({
      id: 'booking-1',
      tenant_id: 'tenant-1',
      resource_id: 'res-1',
      appointment_id: null,
      contact_id: null,
      booked_by: null,
      start_time: '2025-06-01T09:00:00Z',
      end_time: '2025-06-01T10:00:00Z',
      status: 'confirmed',
      notes: null,
    })

    const result = await checkResourceAvailable({
      resourceId: 'res-1',
      startTime: new Date('2025-06-01T09:00:00Z'),
      endTime: new Date('2025-06-01T10:00:00Z'),
    })
    expect(result).toBe(false)
  })
})

// ── Test 3: checkResourceAvailable returns false on partial overlap ────────────
describe('checkResourceAvailable — partial overlap', () => {
  it('returns false when existing booking partially overlaps the requested window', async () => {
    ;(store.tables['resource_bookings'] as Row[]).push({
      id: 'booking-2',
      tenant_id: 'tenant-1',
      resource_id: 'res-1',
      appointment_id: null,
      contact_id: null,
      booked_by: null,
      start_time: '2025-06-01T09:30:00Z',
      end_time: '2025-06-01T10:30:00Z',
      status: 'confirmed',
      notes: null,
    })

    const result = await checkResourceAvailable({
      resourceId: 'res-1',
      startTime: new Date('2025-06-01T09:00:00Z'),
      endTime: new Date('2025-06-01T10:00:00Z'),
    })
    expect(result).toBe(false)
  })
})

// ── Test 4: POST /:id/book returns 409 when resource already booked ───────────
describe('POST /api/resources/:id/book — conflict', () => {
  it('returns 409 when resource already has a confirmed booking for that time', async () => {
    const resource = seedResource()
    ;(store.tables['resource_bookings'] as Row[]).push({
      id: 'existing-booking',
      tenant_id: 'tenant-1',
      resource_id: resource.id,
      appointment_id: null,
      contact_id: null,
      booked_by: null,
      start_time: '2025-06-01T10:00:00Z',
      end_time: '2025-06-01T11:00:00Z',
      status: 'confirmed',
      notes: null,
    })

    const res = await request(makeApp())
      .post(`/api/resources/${resource.id as string}/book`)
      .set('Content-Type', 'application/json')
      .send({
        start_time: '2025-06-01T10:00:00Z',
        end_time: '2025-06-01T11:00:00Z',
      })

    expect(res.status).toBe(409)
    expect(res.body.conflict).toBe(true)
  })
})

// ── Test 5: POST /:id/book succeeds when resource is free ─────────────────────
describe('POST /api/resources/:id/book — success', () => {
  it('creates booking and returns 201 with booking_id and resource_name', async () => {
    const resource = seedResource()
    // No existing bookings

    const res = await request(makeApp())
      .post(`/api/resources/${resource.id as string}/book`)
      .set('Content-Type', 'application/json')
      .send({
        start_time: '2025-06-01T14:00:00Z',
        end_time: '2025-06-01T15:00:00Z',
      })

    expect(res.status).toBe(201)
    expect(res.body.resource_name).toBe('Treatment Room 1')
    expect(res.body.booking_id).toBeTruthy()
    // Confirm stored
    const bookings = store.tables['resource_bookings'] as Row[]
    expect(bookings.length).toBe(1)
    expect(bookings[0]!.status).toBe('confirmed')
  })
})

// ── Test 6: POST /:id/book returns 400 when end_time is before start_time ─────
describe('POST /api/resources/:id/book — invalid time range', () => {
  it('returns 400 when end_time is before start_time', async () => {
    const resource = seedResource()

    const res = await request(makeApp())
      .post(`/api/resources/${resource.id as string}/book`)
      .set('Content-Type', 'application/json')
      .send({
        start_time: '2025-06-01T11:00:00Z',
        end_time: '2025-06-01T10:00:00Z', // end before start
      })

    expect(res.status).toBe(400)
  })
})
