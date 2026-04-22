import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { SignJWT } from 'jose'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000000002'
const USER_ID = 'user-staff-001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  const secretBytes = new TextEncoder().encode(SECRET)
  return new SignJWT({ sub: USER_ID, tenantId: TENANT_ID, role: 'owner', vertical: 'dental' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secretBytes)
}

const [{ default: express }, { default: request }, { default: staffRouter }] = await Promise.all([
  import('express'),
  import('supertest'),
  import('./staff.js'),
])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/staff', staffRouter)
  return app
}

function nextMondayIso(): string {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  const dow = d.getDay()
  const daysUntilMon = (1 - dow + 7) % 7 || 7
  d.setDate(d.getDate() + daysUntilMon)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [{ id: TENANT_ID, modules: { crm: true } }]
  store.tables['staff_members'] = []
  store.tables['shifts'] = []
  store.tables['activity_log'] = []
})

describe('POST /api/staff', () => {
  it('creates a staff member and returns 201 with id', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/staff')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jane Doe', role: 'Receptionist' })

    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()
    expect(res.body.name).toBe('Jane Doe')
  })

  it('returns 400 when role is missing', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/staff')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Jane Doe' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBeDefined()
  })
})

describe('POST /api/staff/:id/shifts', () => {
  it('creates a valid shift and returns 201', async () => {
    const token = await makeToken()
    const app = makeApp()

    const staffRes = await request(app)
      .post('/api/staff')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Dr. Patel', role: 'Dentist' })
    expect(staffRes.status).toBe(201)
    const staffId = staffRes.body.id as string
    const monday = nextMondayIso()

    const shiftRes = await request(app)
      .post(`/api/staff/${staffId}/shifts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ date: monday, start_time: '09:00', end_time: '17:00' })

    expect(shiftRes.status).toBe(201)
    expect(shiftRes.body.id).toBeDefined()
    expect(shiftRes.body.staff_id).toBe(staffId)
  })

  it('returns 409 with shift_conflict when shift overlaps', async () => {
    const token = await makeToken()
    const app = makeApp()

    const staffRes = await request(app)
      .post('/api/staff')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Dr. Patel', role: 'Dentist' })
    const staffId = staffRes.body.id as string
    const monday = nextMondayIso()

    const first = await request(app)
      .post(`/api/staff/${staffId}/shifts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ date: monday, start_time: '09:00', end_time: '17:00' })
    expect(first.status).toBe(201)

    const conflict = await request(app)
      .post(`/api/staff/${staffId}/shifts`)
      .set('Authorization', `Bearer ${token}`)
      .send({ date: monday, start_time: '10:00', end_time: '14:00' })

    expect(conflict.status).toBe(409)
    expect(conflict.body.error).toBe('shift_conflict')
    expect(conflict.body.conflicting_shift).toBeDefined()
  })
})
