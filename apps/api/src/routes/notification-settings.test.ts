import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { SignJWT } from 'jose'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000nt00001'
const USER_ID = 'user-nt-001'
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

const [{ default: express }, { default: request }, { default: notificationSettingsRouter }] =
  await Promise.all([import('express'), import('supertest'), import('./notification-settings.js')])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/settings/notifications', notificationSettingsRouter)
  return app
}

const EVENT_KEYS = [
  'new_contact',
  'appointment_booked',
  'appointment_completed',
  'quote_viewed',
  'quote_accepted',
  'deposit_paid',
  'new_sms',
  'task_due',
  'review_sent',
  'form_submitted',
  'low_lead_score',
  'contact_assigned',
  'inventory_low_stock',
  'staff_shift_conflict',
] as const

function completePrefs(): Record<string, { push: boolean; sms: boolean; email: boolean }> {
  const prefs: Record<string, { push: boolean; sms: boolean; email: boolean }> = {}
  for (const key of EVENT_KEYS) {
    prefs[key] = { push: true, sms: false, email: false }
  }
  return prefs
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = []
})

describe('GET /api/settings/notifications', () => {
  it('returns notification prefs merged with defaults (all 14 keys present)', async () => {
    ;(store.tables['tenants'] as Row[]).push({ id: TENANT_ID, notification_prefs: null })
    const token = await makeToken()

    const res = await request(makeApp())
      .get('/api/settings/notifications')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    for (const key of EVENT_KEYS) {
      expect(res.body[key]).toBeDefined()
      expect(typeof res.body[key].push).toBe('boolean')
      expect(typeof res.body[key].sms).toBe('boolean')
      expect(typeof res.body[key].email).toBe('boolean')
    }
    expect(res.body.inventory_low_stock).toBeDefined()
    expect(res.body.staff_shift_conflict).toBeDefined()
  })
})

describe('PUT /api/settings/notifications', () => {
  it('saves complete prefs object and returns updated', async () => {
    ;(store.tables['tenants'] as Row[]).push({ id: TENANT_ID, notification_prefs: null })
    const token = await makeToken()
    const body = completePrefs()

    const res = await request(makeApp())
      .put('/api/settings/notifications')
      .set('Authorization', `Bearer ${token}`)
      .send(body)

    expect(res.status).toBe(200)
    expect(res.body.new_contact.push).toBe(true)
    expect(res.body.staff_shift_conflict.push).toBe(true)
  })

  it('returns 400 when prefs object is missing keys', async () => {
    ;(store.tables['tenants'] as Row[]).push({ id: TENANT_ID })
    const token = await makeToken()

    const res = await request(makeApp())
      .put('/api/settings/notifications')
      .set('Authorization', `Bearer ${token}`)
      .send({ new_contact: { push: true, sms: false, email: false } })

    expect(res.status).toBe(400)
  })
})
