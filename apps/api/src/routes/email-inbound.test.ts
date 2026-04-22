import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { SignJWT } from 'jose'
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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000eb00001'
const USER_ID = 'user-eb-001'
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
  { default: bccSettingsRouter, emailInboundWebhookRouter },
] = await Promise.all([import('express'), import('supertest'), import('./email-inbound.js')])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/settings/bcc-logging', bccSettingsRouter)
  app.use('/api/webhooks/email-inbound', emailInboundWebhookRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = []
  store.tables['contacts'] = []
  store.tables['user_email_accounts'] = []
  store.tables['email_messages'] = []
  logActivity.mockClear()
})

describe('GET /api/settings/bcc-logging', () => {
  it('returns bcc_logging_address for tenant', async () => {
    ;(store.tables['tenants'] as Row[]).push({
      id: TENANT_ID,
      bcc_logging_address: 'log-abc123@mail.nuatis.com',
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .get('/api/settings/bcc-logging')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.bccAddress).toBe('log-abc123@mail.nuatis.com')
  })
})

describe('POST /api/settings/bcc-logging/enable', () => {
  it('generates and stores a bcc_logging_address', async () => {
    ;(store.tables['tenants'] as Row[]).push({
      id: TENANT_ID,
      bcc_logging_address: null,
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .post('/api/settings/bcc-logging/enable')
      .set('Authorization', `Bearer ${token}`)
      .send({})

    expect(res.status).toBe(200)
    expect(res.body.bccAddress).toMatch(/^log-[0-9a-f]{10}@mail\.nuatis\.com$/)
    const row = (store.tables['tenants'] as Row[]).find((r) => r['id'] === TENANT_ID)
    expect(row?.['bcc_logging_address']).toMatch(/^log-[0-9a-f]{10}@mail\.nuatis\.com$/)
  })
})

describe('POST /api/webhooks/email-inbound', () => {
  it('inserts email_messages row with source bcc and logs activity when contact matched', async () => {
    ;(store.tables['tenants'] as Row[]).push({
      id: TENANT_ID,
      bcc_logging_address: 'log-abc@mail.nuatis.com',
    })
    ;(store.tables['contacts'] as Row[]).push({
      id: 'contact-bcc-001',
      tenant_id: TENANT_ID,
      email: 'sender@example.com',
    })

    const res = await request(makeApp())
      .post('/api/webhooks/email-inbound')
      .send({
        from: 'sender@example.com',
        to: ['log-abc@mail.nuatis.com'],
        subject: 'Re: Your quote',
        text: 'Looks good!',
      })

    expect(res.status).toBe(200)
    const rows = store.tables['email_messages'] as Row[]
    expect(rows.length).toBe(1)
    expect(rows[0]!['source']).toBe('bcc')
    expect(rows[0]!['tenant_id']).toBe(TENANT_ID)
    expect(logActivity).toHaveBeenCalledTimes(1)
  })

  it('inserts email_messages without logActivity when no contact matches sender email', async () => {
    ;(store.tables['tenants'] as Row[]).push({
      id: TENANT_ID,
      bcc_logging_address: 'log-no-contact@mail.nuatis.com',
    })

    const res = await request(makeApp())
      .post('/api/webhooks/email-inbound')
      .send({
        from: 'stranger@elsewhere.com',
        to: ['log-no-contact@mail.nuatis.com'],
        subject: 'Hello',
        text: 'Body',
      })

    expect(res.status).toBe(200)
    const rows = store.tables['email_messages'] as Row[]
    expect(rows.length).toBe(1)
    expect(logActivity).not.toHaveBeenCalled()
  })

  it('returns 200 even when no tenant matches the to address (graceful miss)', async () => {
    const res = await request(makeApp())
      .post('/api/webhooks/email-inbound')
      .send({
        from: 'anyone@example.com',
        to: ['unknown@mail.nuatis.com'],
        subject: 'Does not matter',
        text: 'Body',
      })

    expect(res.status).toBe(200)
    const rows = store.tables['email_messages'] as Row[]
    expect(rows.length).toBe(0)
  })
})
