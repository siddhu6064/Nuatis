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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000gc00099'
const OTHER_TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000gc00098'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken({ sub: 'user-1', tenantId: TENANT_ID, role: 'owner' }, { secret: SECRET })
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: giftCardsRouter } = await import('./gift-cards.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/gift-cards', giftCardsRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['gift_cards'] = [
    {
      id: 'gc-1',
      tenant_id: TENANT_ID,
      code: 'GIFT1234',
      amount_cents: 5000,
      balance_cents: 5000,
      status: 'active',
      recipient_name: 'Original Recipient',
      recipient_email: 'original@example.com',
      purchased_by_contact_id: null,
    },
  ]
  store.tables['contacts'] = [{ id: 'contact-1', tenant_id: TENANT_ID, full_name: 'New Owner' }]
  store.tables['activity_log'] = []
})

describe('PATCH /api/gift-cards/:id/transfer', () => {
  it('reassigns recipient name/email', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .patch('/api/gift-cards/gc-1/transfer')
      .set('Authorization', `Bearer ${token}`)
      .send({ recipient_name: 'New Recipient', recipient_email: 'new@example.com' })

    expect(res.status).toBe(200)
    expect(res.body.recipient_name).toBe('New Recipient')
    expect(res.body.recipient_email).toBe('new@example.com')
  })

  it('reassigns to a different contact after validating tenant ownership', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .patch('/api/gift-cards/gc-1/transfer')
      .set('Authorization', `Bearer ${token}`)
      .send({ contact_id: 'contact-1' })

    expect(res.status).toBe(200)
    expect(res.body.purchased_by_contact_id).toBe('contact-1')
  })

  it('400s a contact_id that belongs to another tenant', async () => {
    store.tables['contacts'] = [
      { id: 'contact-other', tenant_id: OTHER_TENANT_ID, full_name: 'Not Mine' },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .patch('/api/gift-cards/gc-1/transfer')
      .set('Authorization', `Bearer ${token}`)
      .send({ contact_id: 'contact-other' })

    expect(res.status).toBe(400)
  })

  it('400s a non-active gift card', async () => {
    store.tables['gift_cards'] = [
      {
        id: 'gc-1',
        tenant_id: TENANT_ID,
        code: 'GIFT1234',
        status: 'redeemed',
        recipient_name: null,
        recipient_email: null,
      },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .patch('/api/gift-cards/gc-1/transfer')
      .set('Authorization', `Bearer ${token}`)
      .send({ recipient_name: 'New Recipient' })

    expect(res.status).toBe(400)
  })

  it('404s a gift card in another tenant', async () => {
    store.tables['gift_cards'] = [
      { id: 'gc-1', tenant_id: OTHER_TENANT_ID, code: 'GIFT1234', status: 'active' },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .patch('/api/gift-cards/gc-1/transfer')
      .set('Authorization', `Bearer ${token}`)
      .send({ recipient_name: 'New Recipient' })

    expect(res.status).toBe(404)
  })

  it('logs an activity entry on transfer', async () => {
    const token = await makeToken()
    await request(makeApp())
      .patch('/api/gift-cards/gc-1/transfer')
      .set('Authorization', `Bearer ${token}`)
      .send({ recipient_name: 'New Recipient' })

    const activity = (store.tables['activity_log'] as Row[]).find((a) =>
      String(a['body']).includes('transferred')
    )
    expect(activity).toBeDefined()
  })
})
