import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000bs00001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken({ sub: 'user-1', tenantId: TENANT_ID, role: 'owner' }, { secret: SECRET })
}

const [{ default: express }, { default: request }, { default: bookingSettingsRouter }] =
  await Promise.all([import('express'), import('supertest'), import('./booking-settings.js')])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/settings/booking', bookingSettingsRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [{ id: TENANT_ID, vertical: null }]
  store.tables['services'] = []
})

describe('GET /api/settings/booking — fee fields', () => {
  it('defaults to null when no fee is configured', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/settings/booking')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.noShowFeeCents).toBeNull()
    expect(res.body.cancellationFeeNoticeHours).toBeNull()
  })

  it('returns a configured fee', async () => {
    ;(store.tables['tenants'] as Row[])[0]!['no_show_fee_cents'] = 2500
    ;(store.tables['tenants'] as Row[])[0]!['cancellation_fee_notice_hours'] = 24
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/settings/booking')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.noShowFeeCents).toBe(2500)
    expect(res.body.cancellationFeeNoticeHours).toBe(24)
  })
})

describe('PUT /api/settings/booking — fee fields', () => {
  it('sets a fee amount and notice window', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .put('/api/settings/booking')
      .set('Authorization', `Bearer ${token}`)
      .send({ noShowFeeCents: 5000, cancellationFeeNoticeHours: 48 })

    expect(res.status).toBe(200)
    expect(res.body.noShowFeeCents).toBe(5000)
    expect(res.body.cancellationFeeNoticeHours).toBe(48)
  })

  it('clears the fee when set to null', async () => {
    ;(store.tables['tenants'] as Row[])[0]!['no_show_fee_cents'] = 5000
    const token = await makeToken()
    const res = await request(makeApp())
      .put('/api/settings/booking')
      .set('Authorization', `Bearer ${token}`)
      .send({ noShowFeeCents: null })

    expect(res.status).toBe(200)
    expect(res.body.noShowFeeCents).toBeNull()
  })

  it('400s on a negative fee amount', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .put('/api/settings/booking')
      .set('Authorization', `Bearer ${token}`)
      .send({ noShowFeeCents: -100 })

    expect(res.status).toBe(400)
  })
})
