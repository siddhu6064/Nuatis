import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
// Unset TELNYX_TENANT_MAP so tests hit the DB path
delete process.env['TELNYX_TENANT_MAP']

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
  requireModule: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))

// Dynamic imports AFTER mocks
const [
  { default: express },
  { default: request },
  { default: telnyxNumbersRouter },
  { getTenantByPhoneNumber },
] = await Promise.all([
  import('express'),
  import('supertest'),
  import('../routes/telnyx-numbers.js'),
  import('../lib/telnyx-tenant-lookup.js'),
])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/telnyx-numbers', telnyxNumbersRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['telnyx_numbers'] = []
  store.tables['locations'] = []
})

// ── Test 1: getTenantByPhoneNumber returns null for unknown number ────────────
describe('getTenantByPhoneNumber — unknown number', () => {
  it('returns null when phone number not found in DB and no env map', async () => {
    // store.tables['telnyx_numbers'] is empty
    const result = await getTenantByPhoneNumber('+15551112222')
    expect(result).toBeNull()
  })
})

// ── Test 2: getTenantByPhoneNumber finds number in telnyx_numbers table ───────
describe('getTenantByPhoneNumber — DB path', () => {
  it('finds a number in the telnyx_numbers table and maps fields correctly', async () => {
    ;(store.tables['telnyx_numbers'] as Row[]).push({
      id: 'num-1',
      tenant_id: 'tenant-abc',
      location_id: 'loc-1',
      phone_number: '+15127771234',
      label: 'Scheduling Line',
      department: 'scheduling',
      maya_enabled: true,
      forwarding_number: null,
      status: 'active',
      is_primary: false,
    })

    const result = await getTenantByPhoneNumber('+15127771234')

    expect(result).not.toBeNull()
    expect(result?.tenantId).toBe('tenant-abc')
    expect(result?.department).toBe('scheduling')
    expect(result?.mayaEnabled).toBe(true)
    expect(result?.label).toBe('Scheduling Line')
  })
})

// ── Test 3: POST invalid E.164 returns 400 ────────────────────────────────────
describe('POST /api/telnyx-numbers — invalid E.164', () => {
  it('returns 400 with E.164 message when phone_number is malformed', async () => {
    const res = await request(makeApp())
      .post('/api/telnyx-numbers')
      .set('Content-Type', 'application/json')
      .send({ phone_number: '5551234', label: 'Test', department: 'general' })

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/E\.164/)
  })
})

// ── Test 4: POST sets is_primary=true for tenant's first number ───────────────
describe('POST /api/telnyx-numbers — first number auto-primary', () => {
  it('sets is_primary=true automatically when no existing numbers for tenant', async () => {
    // telnyx_numbers table is empty (no existing numbers for tenant-1)
    const res = await request(makeApp())
      .post('/api/telnyx-numbers')
      .set('Content-Type', 'application/json')
      .send({ phone_number: '+15127770001', label: 'Main Line', department: 'general' })

    expect(res.status).toBe(201)
    expect(res.body.is_primary).toBe(true)
    // Confirm stored in mock
    const rows = store.tables['telnyx_numbers'] as Row[]
    expect(rows.length).toBe(1)
    expect(rows[0]?.['is_primary']).toBe(true)
  })
})

// ── Test 5: DELETE primary returns 400 ───────────────────────────────────────
describe('DELETE /api/telnyx-numbers/:id — primary number', () => {
  it('returns 400 with primary-related message when trying to delete primary number', async () => {
    ;(store.tables['telnyx_numbers'] as Row[]).push({
      id: 'num-primary',
      tenant_id: 'tenant-1',
      phone_number: '+15120000001',
      label: 'Main',
      department: 'general',
      is_primary: true,
      maya_enabled: true,
      status: 'active',
    })

    const res = await request(makeApp()).delete('/api/telnyx-numbers/num-primary')

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/primary/)
  })
})

// ── Test 6: POST /:id/set-primary clears old and sets new ────────────────────
describe('POST /api/telnyx-numbers/:id/set-primary', () => {
  it('clears old primary and sets the new one', async () => {
    ;(store.tables['telnyx_numbers'] as Row[]).push(
      {
        id: 'num-a',
        tenant_id: 'tenant-1',
        phone_number: '+15120000001',
        label: 'A',
        department: 'general',
        is_primary: true,
        maya_enabled: true,
        status: 'active',
      },
      {
        id: 'num-b',
        tenant_id: 'tenant-1',
        phone_number: '+15120000002',
        label: 'B',
        department: 'scheduling',
        is_primary: false,
        maya_enabled: true,
        status: 'active',
      }
    )

    const res = await request(makeApp()).post('/api/telnyx-numbers/num-b/set-primary')

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    // Check the store: num-b should now be primary, num-a should not
    const rows = store.tables['telnyx_numbers'] as Row[]
    const numA = rows.find((r) => r['id'] === 'num-a')
    const numB = rows.find((r) => r['id'] === 'num-b')
    expect(numB?.['is_primary']).toBe(true)
    expect(numA?.['is_primary']).toBe(false)
  })
})
