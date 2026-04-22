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

const sendViaGmail = jest.fn(async () => undefined)
const sendViaOutlook = jest.fn(async () => undefined)
const buildMimeMessage = jest.fn(() => 'raw-mime-base64')
const injectTrackingPixel = jest.fn((html: string) => html)
const getValidToken = jest.fn(async () => ({ accessToken: 'access-tok', provider: 'gmail' }))
const encryptToken = jest.fn(() => 'enc-tok')
const logActivity = jest.fn(async () => undefined)
const enqueueScoreCompute = jest.fn<() => void>()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/email-send.js', () => ({
  sendViaGmail,
  sendViaOutlook,
  buildMimeMessage,
  injectTrackingPixel,
}))
jest.unstable_mockModule('../lib/email-oauth.js', () => ({ getValidToken, encryptToken }))
jest.unstable_mockModule('../lib/activity.js', () => ({ logActivity }))
jest.unstable_mockModule('../lib/lead-score-queue.js', () => ({ enqueueScoreCompute }))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000ei00001'
const USER_ID = 'user-ei-001'
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

const [{ default: express }, { default: request }, { default: integrationsRouter }] =
  await Promise.all([import('express'), import('supertest'), import('./email-integrations.js')])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/email-integrations', integrationsRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['user_email_accounts'] = []
  store.tables['contacts'] = []
  store.tables['email_messages'] = []
  sendViaGmail.mockClear()
  sendViaOutlook.mockClear()
  buildMimeMessage.mockClear()
  injectTrackingPixel.mockClear()
  injectTrackingPixel.mockImplementation((html: string) => html)
  getValidToken.mockClear()
  getValidToken.mockResolvedValue({ accessToken: 'access-tok', provider: 'gmail' })
  encryptToken.mockClear()
  logActivity.mockClear()
  enqueueScoreCompute.mockClear()
})

describe('GET /api/email-integrations', () => {
  it('returns list of connected email accounts', async () => {
    ;(store.tables['user_email_accounts'] as Row[]).push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      provider: 'gmail',
      email_address: 'alice@example.com',
      is_default: true,
      created_at: new Date().toISOString(),
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .get('/api/email-integrations')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.accounts)).toBe(true)
    expect(res.body.accounts.length).toBe(1)
  })
})

describe('DELETE /api/email-integrations/:id', () => {
  it('disconnects account and returns success', async () => {
    const accountId = randomUUID()
    ;(store.tables['user_email_accounts'] as Row[]).push({
      id: accountId,
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      provider: 'gmail',
      email_address: 'alice@example.com',
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .delete(`/api/email-integrations/${accountId}`)
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    const rows = store.tables['user_email_accounts'] as Row[]
    expect(rows.find((r) => r['id'] === accountId)).toBeUndefined()
  })
})

describe('POST /api/email-integrations/send/:contactId', () => {
  it('sends via Gmail, inserts email_messages, logs activity, enqueues score', async () => {
    const accountId = randomUUID()
    const contactId = randomUUID()
    ;(store.tables['user_email_accounts'] as Row[]).push({
      id: accountId,
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      provider: 'gmail',
      email_address: 'alice@gmail.com',
    })
    ;(store.tables['contacts'] as Row[]).push({
      id: contactId,
      tenant_id: TENANT_ID,
      full_name: 'Bob Smith',
      email: 'bob@example.com',
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .post(`/api/email-integrations/send/${contactId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        subject: 'Follow up',
        bodyHtml: '<p>Hello</p>',
        bodyText: 'Hello',
        emailAccountId: accountId,
      })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(sendViaGmail).toHaveBeenCalledTimes(1)

    const rows = store.tables['email_messages'] as Row[]
    expect(rows.length).toBe(1)
    expect(rows[0]!['direction']).toBe('outbound')
    expect(rows[0]!['status']).toBe('sent')

    expect(logActivity).toHaveBeenCalledTimes(1)
    expect(enqueueScoreCompute).toHaveBeenCalledTimes(1)
    const args = enqueueScoreCompute.mock.calls[0]! as unknown as [string, string, string]
    expect(args[2]).toBe('email_sent')
  })

  it('returns 404 when contact not found', async () => {
    const token = await makeToken()

    const res = await request(makeApp())
      .post('/api/email-integrations/send/nonexistent-contact-id')
      .set('Authorization', `Bearer ${token}`)
      .send({
        subject: 'X',
        bodyHtml: '<p>Y</p>',
        bodyText: 'Y',
        emailAccountId: 'some-account-id',
      })

    expect(res.status).toBe(404)
  })
})
