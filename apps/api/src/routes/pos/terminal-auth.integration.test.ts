import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { jwtVerify } from 'jose'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../__test-support__/supabase-mock.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000trm0001'
const LOCATION_ID = 'bbbbbbbb-0000-0000-0000-00000loc0001'
const OTHER_LOCATION_ID = 'bbbbbbbb-0000-0000-0000-00000loc0002'
const SECRET = 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const { hashPin } = await import('../../lib/pos-pin.js')
const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: terminalRouter } = await import('./terminal-auth.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/pos/terminal', terminalRouter)
  return app
}

// hashPin is a real scrypt call, so the fixture must be awaited.
beforeEach(async () => {
  store = createStore()
  store.tables['staff_members'] = [
    {
      id: 'staff-1',
      tenant_id: TENANT_ID,
      name: 'Dana Cashier',
      pos_pin_hash: await hashPin('4821'),
      pos_location_ids: [LOCATION_ID],
      is_active: true,
    },
  ]
})

describe('POST /api/pos/terminal/sign-in', () => {
  it('mints a token for a correct PIN', async () => {
    const res = await request(makeApp())
      .post('/api/pos/terminal/sign-in')
      .send({ tenant_id: TENANT_ID, location_id: LOCATION_ID, pin: '4821' })

    expect(res.status).toBe(200)
    expect(res.body.staff.name).toBe('Dana Cashier')
    expect(typeof res.body.token).toBe('string')
  })

  it('stamps portalScope=pos and the location on the token', async () => {
    const res = await request(makeApp())
      .post('/api/pos/terminal/sign-in')
      .send({ tenant_id: TENANT_ID, location_id: LOCATION_ID, pin: '4821' })

    const { payload } = await jwtVerify(
      res.body.token as string,
      new TextEncoder().encode(SECRET),
      { audience: 'nuatis-api' }
    )
    expect(payload['portalScope']).toBe('pos')
    expect(payload['locationId']).toBe(LOCATION_ID)
    expect(payload['tenantId']).toBe(TENANT_ID)
    expect(payload['staffId']).toBe('staff-1')
  })

  it('never returns the pin hash to the caller', async () => {
    const res = await request(makeApp())
      .post('/api/pos/terminal/sign-in')
      .send({ tenant_id: TENANT_ID, location_id: LOCATION_ID, pin: '4821' })

    expect(JSON.stringify(res.body)).not.toContain('scrypt$')
  })

  it('rejects a wrong PIN', async () => {
    const res = await request(makeApp())
      .post('/api/pos/terminal/sign-in')
      .send({ tenant_id: TENANT_ID, location_id: LOCATION_ID, pin: '0000' })

    expect(res.status).toBe(401)
  })

  it('rejects a staff member not assigned to the requested location', async () => {
    const res = await request(makeApp())
      .post('/api/pos/terminal/sign-in')
      .send({ tenant_id: TENANT_ID, location_id: OTHER_LOCATION_ID, pin: '4821' })

    expect(res.status).toBe(401)
  })

  it('rejects an inactive staff member', async () => {
    store.tables['staff_members']![0]!['is_active'] = false

    const res = await request(makeApp())
      .post('/api/pos/terminal/sign-in')
      .send({ tenant_id: TENANT_ID, location_id: LOCATION_ID, pin: '4821' })

    expect(res.status).toBe(401)
  })

  it('rejects a staff member with no PIN set', async () => {
    store.tables['staff_members']![0]!['pos_pin_hash'] = null

    const res = await request(makeApp())
      .post('/api/pos/terminal/sign-in')
      .send({ tenant_id: TENANT_ID, location_id: LOCATION_ID, pin: '4821' })

    expect(res.status).toBe(401)
  })

  it('does not authenticate a matching PIN belonging to another tenant', async () => {
    store.tables['staff_members']![0]!['tenant_id'] = 'some-other-tenant'

    const res = await request(makeApp())
      .post('/api/pos/terminal/sign-in')
      .send({ tenant_id: TENANT_ID, location_id: LOCATION_ID, pin: '4821' })

    expect(res.status).toBe(401)
  })

  it('returns the same error shape for a wrong PIN and an unknown tenant', async () => {
    const wrongPin = await request(makeApp())
      .post('/api/pos/terminal/sign-in')
      .send({ tenant_id: TENANT_ID, location_id: LOCATION_ID, pin: '0000' })
    const unknownTenant = await request(makeApp())
      .post('/api/pos/terminal/sign-in')
      .send({ tenant_id: 'no-such-tenant', location_id: LOCATION_ID, pin: '4821' })

    expect(wrongPin.status).toBe(unknownTenant.status)
    expect(wrongPin.body).toEqual(unknownTenant.body)
  })

  it('requires tenant_id, location_id, and pin', async () => {
    const res = await request(makeApp()).post('/api/pos/terminal/sign-in').send({ pin: '4821' })
    expect(res.status).toBe(400)
  })

  it('picks the right staff member when several share a location', async () => {
    store.tables['staff_members']!.push({
      id: 'staff-2',
      tenant_id: TENANT_ID,
      name: 'Rowan Cashier',
      pos_pin_hash: await hashPin('1234'),
      pos_location_ids: [LOCATION_ID],
      is_active: true,
    })

    const res = await request(makeApp())
      .post('/api/pos/terminal/sign-in')
      .send({ tenant_id: TENANT_ID, location_id: LOCATION_ID, pin: '1234' })

    expect(res.status).toBe(200)
    expect(res.body.staff.id).toBe('staff-2')
  })
})
