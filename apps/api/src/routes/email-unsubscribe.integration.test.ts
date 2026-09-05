import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()

const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const {
  default: unsubscribeRouter,
  signContactUnsubscribeToken,
  buildUnsubscribeUrl,
} = await import('./email-unsubscribe.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/email', unsubscribeRouter)
  return app
}

const CONTACT_ID = 'contact-unsub-1'

beforeEach(() => {
  store = createStore()
  store.tables['contacts'] = [
    { id: CONTACT_ID, tenant_id: 'tenant-1', email_status: 'ok', full_name: 'Jane' },
  ]
})

describe('GET /api/email/unsubscribe', () => {
  it('flips email_status to unsubscribed with a valid token', async () => {
    const token = signContactUnsubscribeToken(CONTACT_ID)
    const res = await request(makeApp()).get(
      `/api/email/unsubscribe?contactId=${CONTACT_ID}&token=${token}`
    )

    expect(res.status).toBe(200)
    const contact = (store.tables['contacts'] as Row[]).find((c) => c['id'] === CONTACT_ID)
    expect(contact?.['email_status']).toBe('unsubscribed')
  })

  it('rejects an invalid token', async () => {
    const res = await request(makeApp()).get(
      `/api/email/unsubscribe?contactId=${CONTACT_ID}&token=not-the-real-token`
    )

    expect(res.status).toBe(400)
    const contact = (store.tables['contacts'] as Row[]).find((c) => c['id'] === CONTACT_ID)
    expect(contact?.['email_status']).toBe('ok')
  })

  it('rejects missing params', async () => {
    const res = await request(makeApp()).get('/api/email/unsubscribe')
    expect(res.status).toBe(400)
  })
})

describe('POST /api/email/unsubscribe — one-click', () => {
  it('unsubscribes with a valid token and no body', async () => {
    const token = signContactUnsubscribeToken(CONTACT_ID)
    const res = await request(makeApp()).post(
      `/api/email/unsubscribe?contactId=${CONTACT_ID}&token=${token}`
    )

    expect(res.status).toBe(200)
    const contact = (store.tables['contacts'] as Row[]).find((c) => c['id'] === CONTACT_ID)
    expect(contact?.['email_status']).toBe('unsubscribed')
  })

  it('rejects an invalid token', async () => {
    const res = await request(makeApp()).post(
      `/api/email/unsubscribe?contactId=${CONTACT_ID}&token=bad`
    )
    expect(res.status).toBe(400)
  })
})

describe('buildUnsubscribeUrl', () => {
  it('produces a URL whose token verifies for that contact', async () => {
    const url = buildUnsubscribeUrl(CONTACT_ID)
    const token = new URL(url).searchParams.get('token')!

    const res = await request(makeApp()).get(
      `/api/email/unsubscribe?contactId=${CONTACT_ID}&token=${token}`
    )
    expect(res.status).toBe(200)
  })
})
