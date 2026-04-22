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

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000pv00001'
const USER_ID = 'user-pv-001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(role: string = 'owner'): Promise<string> {
  const secretBytes = new TextEncoder().encode(SECRET)
  return new SignJWT({ sub: USER_ID, tenantId: TENANT_ID, role, vertical: 'dental' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secretBytes)
}

const [{ default: express }, { default: request }, { default: provisioningRouter }] =
  await Promise.all([import('express'), import('supertest'), import('./provisioning.js')])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/provisioning', provisioningRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = []
  store.tables['locations'] = []
  store.tables['voice_sessions'] = []
})

describe('GET /api/provisioning/onboarding-status', () => {
  it('returns onboarding status object with expected keys', async () => {
    store.tables['tenants']!.push({
      id: TENANT_ID,
      vertical: 'dental',
      onboarding_completed: false,
      onboarding_step: 2,
      product: 'suite',
    })
    store.tables['locations']!.push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      is_primary: true,
      telnyx_number: '+15125550000',
      google_refresh_token: null,
    })

    const token = await makeToken('owner')
    const res = await request(makeApp())
      .get('/api/provisioning/onboarding-status')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.tenant_created).toBeDefined()
    expect(res.body.phone_provisioned).toBeDefined()
    expect(res.body.onboarding_completed).toBeDefined()
    expect(res.body.product).toBeDefined()
  })
})

describe('POST /api/provisioning/complete-step', () => {
  it('advances onboarding_step and returns step + completed', async () => {
    store.tables['tenants']!.push({ id: TENANT_ID, onboarding_step: 1 })
    const token = await makeToken('owner')

    const res = await request(makeApp())
      .post('/api/provisioning/complete-step')
      .set('Authorization', `Bearer ${token}`)
      .send({ step: 1 })

    expect(res.status).toBe(200)
    expect(res.body.step).toBe(2)
    expect(res.body.completed).toBe(false)
  })

  it('returns 400 when step is out of range', async () => {
    const token = await makeToken('owner')

    const res = await request(makeApp())
      .post('/api/provisioning/complete-step')
      .set('Authorization', `Bearer ${token}`)
      .send({ step: 0 })

    expect(res.status).toBe(400)
  })
})

describe('POST /api/provisioning/upgrade-to-suite', () => {
  it('returns 403 when caller is not owner — fix verified', async () => {
    store.tables['tenants']!.push({ id: TENANT_ID, product: 'maya_only' })
    const token = await makeToken('member')

    const res = await request(makeApp())
      .post('/api/provisioning/upgrade-to-suite')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(403)
  })

  it('upgrades to suite and writes complete modules object including companies + deals — fix verified', async () => {
    store.tables['tenants']!.push({ id: TENANT_ID, product: 'maya_only', modules: { maya: true } })
    const token = await makeToken('owner')

    const res = await request(makeApp())
      .post('/api/provisioning/upgrade-to-suite')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.upgraded).toBe(true)
    expect(res.body.product).toBe('suite')

    const row = (store.tables['tenants'] as Row[]).find((r) => r['id'] === TENANT_ID)
    const modules = row?.['modules'] as Record<string, boolean>
    expect(modules.companies).toBe(true)
    expect(modules.deals).toBe(true)
    expect(modules.appointments).toBe(true)
    expect(modules.pipeline).toBe(true)
    expect(modules.automation).toBe(true)
  })
})
