import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { SignJWT } from 'jose'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()
const logActivity = jest.fn(async () => undefined)

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/activity.js', () => ({ logActivity }))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000rv00001'
const USER_ID = 'user-rv-001'
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

const [
  { default: express },
  { default: request },
  { default: reviewSettingsRouter, reviewTrackingRouter },
] = await Promise.all([import('express'), import('supertest'), import('./review-settings.js')])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/settings/review-automation', reviewSettingsRouter)
  app.use('/api/review-tracking', reviewTrackingRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = []
  store.tables['review_requests'] = []
  logActivity.mockClear()
})

describe('GET /api/settings/review-automation', () => {
  it('returns review automation settings for tenant', async () => {
    ;(store.tables['tenants'] as Row[]).push({
      id: TENANT_ID,
      review_automation_enabled: true,
      review_delay_minutes: 120,
      review_message_template: 'Hi {{first_name}}, leave review: {{review_url}}',
      booking_google_review_url: 'https://g.page/test',
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .get('/api/settings/review-automation')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.enabled).toBe(true)
    expect(res.body.delayMinutes).toBe(120)
    expect(res.body.googleReviewUrl).toBe('https://g.page/test')
  })
})

describe('PUT /api/settings/review-automation', () => {
  it('updates settings and returns updated values', async () => {
    ;(store.tables['tenants'] as Row[]).push({
      id: TENANT_ID,
      review_automation_enabled: false,
      review_delay_minutes: 60,
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .put('/api/settings/review-automation')
      .set('Authorization', `Bearer ${token}`)
      .send({
        enabled: true,
        delayMinutes: 60,
        messageTemplate: 'Thanks! {{review_url}}',
        googleReviewUrl: 'https://g.page/test',
      })

    expect(res.status).toBe(200)
    expect(res.body.delayMinutes).toBe(60)
    expect(res.body.enabled).toBe(true)
  })

  it('returns 400 when messageTemplate missing {{review_url}}', async () => {
    ;(store.tables['tenants'] as Row[]).push({ id: TENANT_ID })
    const token = await makeToken()

    const res = await request(makeApp())
      .put('/api/settings/review-automation')
      .set('Authorization', `Bearer ${token}`)
      .send({ messageTemplate: 'Thanks for visiting!' })

    expect(res.status).toBe(400)
  })
})

describe('GET /api/review-tracking/:id', () => {
  it('redirects to google review url and marks review_request as clicked', async () => {
    const reqId = randomUUID()
    ;(store.tables['tenants'] as Row[]).push({
      id: TENANT_ID,
      booking_google_review_url: 'https://g.page/leave-review',
    })
    ;(store.tables['review_requests'] as Row[]).push({
      id: reqId,
      tenant_id: TENANT_ID,
      contact_id: 'contact-rv-001',
      status: 'sent',
      clicked_at: null,
    })

    const res = await request(makeApp()).get(`/api/review-tracking/${reqId}`)

    expect(res.status).toBe(302)
    expect(res.headers.location).toContain('g.page/leave-review')

    const row = (store.tables['review_requests'] as Row[]).find((r) => r['id'] === reqId)
    expect(row?.['status']).toBe('clicked')
    expect(row?.['clicked_at']).not.toBeNull()

    expect(logActivity).toHaveBeenCalled()
  })
})
