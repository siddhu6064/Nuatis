import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()
jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const PLATFORM_TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000plat001'
const OTHER_TENANT_ID = 'bbbbbbbb-0000-0000-0000-00000plat002'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['PLATFORM_TENANT_ID'] = PLATFORM_TENANT_ID

async function makePlatformToken(): Promise<string> {
  return mintTestToken(
    { sub: 'nuatis-1', appUserId: 'platform-user-1', tenantId: PLATFORM_TENANT_ID, role: 'owner' },
    { secret: SECRET }
  )
}
async function makeOtherTenantToken(): Promise<string> {
  return mintTestToken({ sub: 'u', tenantId: OTHER_TENANT_ID, role: 'owner' }, { secret: SECRET })
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: oncallRouter } = await import('./admin-console-oncall.js')

function makeApp() {
  const app = express()
  app.use('/api/admin-console/oncall', express.json(), oncallRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['platform_oncall_shifts'] = []
  store.tables['users'] = [{ id: 'user-dana', tenant_id: PLATFORM_TENANT_ID, full_name: 'Dana' }]
})

describe('rota routes', () => {
  it('creates a shift', async () => {
    const res = await request(makeApp())
      .post('/api/admin-console/oncall')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({
        user_id: 'user-dana',
        starts_at: '2026-09-15T09:00:00Z',
        ends_at: '2026-09-15T17:00:00Z',
      })

    expect(res.status).toBe(201)
    expect(store.tables['platform_oncall_shifts']).toHaveLength(1)
  })

  it('refuses a shift that ends before it starts', async () => {
    const res = await request(makeApp())
      .post('/api/admin-console/oncall')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({
        user_id: 'user-dana',
        starts_at: '2026-09-15T17:00:00Z',
        ends_at: '2026-09-15T09:00:00Z',
      })

    expect(res.status).toBe(400)
  })

  it('refuses a zero-length shift', async () => {
    const res = await request(makeApp())
      .post('/api/admin-console/oncall')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({
        user_id: 'user-dana',
        starts_at: '2026-09-15T09:00:00Z',
        ends_at: '2026-09-15T09:00:00Z',
      })

    expect(res.status).toBe(400)
  })

  it('refuses an unparseable date rather than storing it', async () => {
    const res = await request(makeApp())
      .post('/api/admin-console/oncall')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ user_id: 'user-dana', starts_at: 'tomorrow', ends_at: 'later' })

    expect(res.status).toBe(400)
    expect(store.tables['platform_oncall_shifts']).toHaveLength(0)
  })

  it('refuses a user outside the platform tenant', async () => {
    // Putting a merchant's account on the Nuatis rota would assign them
    // incidents they can never see.
    store.tables['users'] = [{ id: 'user-outsider', tenant_id: OTHER_TENANT_ID }]
    const res = await request(makeApp())
      .post('/api/admin-console/oncall')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({
        user_id: 'user-outsider',
        starts_at: '2026-09-15T09:00:00Z',
        ends_at: '2026-09-15T17:00:00Z',
      })

    expect(res.status).toBe(400)
  })

  it('reports who is on call right now', async () => {
    store.tables['platform_oncall_shifts'] = [
      {
        id: 's1',
        user_id: 'user-dana',
        starts_at: '2000-01-01T00:00:00Z',
        ends_at: '2099-01-01T00:00:00Z',
        is_override: false,
      },
    ]
    const res = await request(makeApp())
      .get('/api/admin-console/oncall/now')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)

    expect(res.body.user_id).toBe('user-dana')
    expect(res.body.user.full_name).toBe('Dana')
  })

  it('says so plainly when nobody is on call', async () => {
    const res = await request(makeApp())
      .get('/api/admin-console/oncall/now')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.user_id).toBeNull()
    expect(res.body.user).toBeNull()
  })

  it('lists shifts', async () => {
    store.tables['platform_oncall_shifts'] = [
      {
        id: 's1',
        user_id: 'user-dana',
        starts_at: '2026-09-15T09:00:00Z',
        ends_at: '2026-09-15T17:00:00Z',
        is_override: false,
      },
    ]
    const res = await request(makeApp())
      .get('/api/admin-console/oncall')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.shifts).toHaveLength(1)
  })

  it('deletes a shift', async () => {
    store.tables['platform_oncall_shifts'] = [
      {
        id: 's1',
        user_id: 'user-dana',
        starts_at: '2026-09-15T09:00:00Z',
        ends_at: '2026-09-15T17:00:00Z',
        is_override: false,
      },
    ]
    const res = await request(makeApp())
      .delete('/api/admin-console/oncall/s1')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)

    expect(res.status).toBe(200)
    expect(store.tables['platform_oncall_shifts']).toHaveLength(0)
  })

  it('refuses a non-platform tenant', async () => {
    const res = await request(makeApp())
      .post('/api/admin-console/oncall')
      .set('Authorization', `Bearer ${await makeOtherTenantToken()}`)
      .send({
        user_id: 'user-dana',
        starts_at: '2026-09-15T09:00:00Z',
        ends_at: '2026-09-15T17:00:00Z',
      })

    expect(res.status).toBe(403)
  })
})
