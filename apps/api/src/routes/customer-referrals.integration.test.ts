import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()
const notifyOwner = jest.fn(async () => undefined)
const logActivity = jest.fn(async () => undefined)

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/notifications.js', () => ({ notifyOwner }))
jest.unstable_mockModule('../lib/activity.js', () => ({ logActivity }))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: customerReferralsRouter } = await import('./customer-referrals.js')

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000cx00001'
const REFERRER_ID = 'bbbbbbbb-0000-0000-0000-00000cx00002'

function makeApp() {
  const app = express()
  app.use('/api/customer-referrals', express.json(), customerReferralsRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [
    {
      id: TENANT_ID,
      name: 'Test Biz',
      booking_page_enabled: true,
      booking_page_slug: 'test-biz',
    },
  ]
  store.tables['contacts'] = [
    { id: REFERRER_ID, tenant_id: TENANT_ID, full_name: 'Ref Erra', phone: null, email: null },
  ]
  store.tables['contact_referral_codes'] = [
    {
      id: randomUUID(),
      tenant_id: TENANT_ID,
      contact_id: REFERRER_ID,
      code: 'REFAB12',
      status: 'active',
      clicks: 0,
    },
  ]
  notifyOwner.mockClear()
  logActivity.mockClear()
})

describe('GET /api/customer-referrals/:code', () => {
  it('resolves a valid code and increments clicks', async () => {
    const res = await request(makeApp()).get('/api/customer-referrals/REFAB12')

    expect(res.status).toBe(200)
    expect(res.body.business_name).toBe('Test Biz')
    expect(res.body.referrer_first_name).toBe('Ref')
    expect(res.body.booking_page_enabled).toBe(true)
    expect(res.body.booking_page_slug).toBe('test-biz')

    const row = (store.tables['contact_referral_codes'] as Row[]).find(
      (r) => r['code'] === 'REFAB12'
    )
    expect(row?.['clicks']).toBe(1)
  })

  it('is case-insensitive on the code', async () => {
    const res = await request(makeApp()).get('/api/customer-referrals/refab12')
    expect(res.status).toBe(200)
  })

  it('404s for an unknown code', async () => {
    const res = await request(makeApp()).get('/api/customer-referrals/NOPE0000')
    expect(res.status).toBe(404)
  })

  it('404s for a disabled code', async () => {
    store.tables['contact_referral_codes'] = [
      {
        id: randomUUID(),
        tenant_id: TENANT_ID,
        contact_id: REFERRER_ID,
        code: 'OFFCODE',
        status: 'disabled',
        clicks: 0,
      },
    ]
    const res = await request(makeApp()).get('/api/customer-referrals/OFFCODE')
    expect(res.status).toBe(404)
  })
})

describe('POST /api/customer-referrals/:code/lead', () => {
  it('creates a new contact attributed to the referrer', async () => {
    const res = await request(makeApp())
      .post('/api/customer-referrals/REFAB12/lead')
      .send({ full_name: 'New Friend', phone: '+15125553333', email: 'friend@example.com' })

    expect(res.status).toBe(201)
    const contacts = store.tables['contacts'] as Row[]
    const newContact = contacts.find((c) => c['full_name'] === 'New Friend')
    expect(newContact).toBeTruthy()
    expect(newContact?.['referred_by_contact_id']).toBe(REFERRER_ID)
    expect(newContact?.['referral_source_detail']).toBe('Referral link')
    expect(newContact?.['source']).toBe('referral')
    expect(notifyOwner).toHaveBeenCalledTimes(1)
  })

  it('backfills attribution on an existing contact only if it has none yet', async () => {
    const EXISTING_ID = randomUUID()
    ;(store.tables['contacts'] as Row[]).push({
      id: EXISTING_ID,
      tenant_id: TENANT_ID,
      full_name: 'Already Attributed',
      phone: '+15125554444',
      email: null,
      referred_by_contact_id: 'someone-else',
    })

    const res = await request(makeApp())
      .post('/api/customer-referrals/REFAB12/lead')
      .send({ full_name: 'Already Attributed', phone: '+15125554444' })

    expect(res.status).toBe(201)
    const row = (store.tables['contacts'] as Row[]).find((c) => c['id'] === EXISTING_ID)
    // never overwritten — still points at the original referrer
    expect(row?.['referred_by_contact_id']).toBe('someone-else')
  })

  it('400s without a name or without phone/email', async () => {
    const res = await request(makeApp())
      .post('/api/customer-referrals/REFAB12/lead')
      .send({ full_name: 'No Contact Info' })
    expect(res.status).toBe(400)
  })

  it('404s for an unknown code', async () => {
    const res = await request(makeApp())
      .post('/api/customer-referrals/NOPE0000/lead')
      .send({ full_name: 'A Friend', phone: '+15125555555' })
    expect(res.status).toBe(404)
  })
})
