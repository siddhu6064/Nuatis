import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

// ── Mock supabase ─────────────────────────────────────────────────────────────
let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const SECRET = 'test-inbound-secret'
const TENANT_ID = 'tenant-test-1'
const BCC_ADDRESS = 'log-abc123@mail.nuatis.com'

const [{ default: express }, { default: request }, { emailInboundWebhookRouter }] =
  await Promise.all([import('express'), import('supertest'), import('../routes/email-inbound.js')])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/webhooks/email-inbound', emailInboundWebhookRouter)
  return app
}

function seedTenant() {
  ;(store.tables['tenants'] as Row[]).push({
    id: TENANT_ID,
    bcc_logging_address: BCC_ADDRESS,
  })
}

const INBOUND_PAYLOAD = {
  from: 'Customer <customer@example.com>',
  to: BCC_ADDRESS,
  subject: 'Hello',
  text: 'Inbound body',
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = []
  store.tables['contacts'] = []
  store.tables['user_email_accounts'] = []
  store.tables['email_messages'] = []
  process.env['INBOUND_WEBHOOK_SECRET'] = SECRET
})

afterEach(() => {
  delete process.env['INBOUND_WEBHOOK_SECRET']
})

describe('POST /api/webhooks/email-inbound', () => {
  it('rejects fail-closed with 500 when INBOUND_WEBHOOK_SECRET is unset', async () => {
    delete process.env['INBOUND_WEBHOOK_SECRET']
    seedTenant()

    const res = await request(makeApp())
      .post(`/api/webhooks/email-inbound?secret=${SECRET}`)
      .send(INBOUND_PAYLOAD)

    expect(res.status).toBe(500)
    expect(store.tables['email_messages']).toHaveLength(0)
  })

  it('rejects an unsigned POST with 401 and writes nothing', async () => {
    seedTenant()

    const res = await request(makeApp()).post('/api/webhooks/email-inbound').send(INBOUND_PAYLOAD)

    expect(res.status).toBe(401)
    expect(store.tables['email_messages']).toHaveLength(0)
  })

  it('rejects a forged secret with 401 and writes nothing', async () => {
    seedTenant()

    const res = await request(makeApp())
      .post('/api/webhooks/email-inbound?secret=wrong-secret')
      .send(INBOUND_PAYLOAD)

    expect(res.status).toBe(401)
    expect(store.tables['email_messages']).toHaveLength(0)
  })

  it('accepts a valid secret in the URL and logs the email', async () => {
    seedTenant()

    const res = await request(makeApp())
      .post(`/api/webhooks/email-inbound?secret=${SECRET}`)
      .send(INBOUND_PAYLOAD)

    expect(res.status).toBe(200)
    const messages = store.tables['email_messages'] as Row[]
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      tenant_id: TENANT_ID,
      direction: 'inbound',
      from_address: 'customer@example.com',
      subject: 'Hello',
      body_text: 'Inbound body',
      source: 'bcc',
    })
  })

  it('accepts a valid secret in the x-inbound-secret header', async () => {
    seedTenant()

    const res = await request(makeApp())
      .post('/api/webhooks/email-inbound')
      .set('x-inbound-secret', SECRET)
      .send(INBOUND_PAYLOAD)

    expect(res.status).toBe(200)
    expect(store.tables['email_messages']).toHaveLength(1)
  })

  it('still returns 200 on a verified POST with no matching tenant (no write)', async () => {
    const res = await request(makeApp())
      .post(`/api/webhooks/email-inbound?secret=${SECRET}`)
      .send(INBOUND_PAYLOAD)

    expect(res.status).toBe(200)
    expect(store.tables['email_messages']).toHaveLength(0)
  })
})
