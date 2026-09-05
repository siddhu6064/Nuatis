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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000us00001'
const OWNER_ID = 'user-owner-001'
const STAFF_ID = 'user-staff-001'
const OTHER_USER_ID = 'user-other-001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeOwnerToken(): Promise<string> {
  return mintTestToken(
    { sub: OWNER_ID, appUserId: OWNER_ID, tenantId: TENANT_ID, role: 'owner' },
    { secret: SECRET }
  )
}

async function makeStaffToken(): Promise<string> {
  return mintTestToken(
    { sub: STAFF_ID, appUserId: STAFF_ID, tenantId: TENANT_ID, role: 'staff' },
    { secret: SECRET }
  )
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: usersRouter } = await import('./users.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/users', usersRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['users'] = [
    {
      id: OWNER_ID,
      tenant_id: TENANT_ID,
      full_name: 'Owner',
      is_active: true,
      monthly_expense_limit_cents: null,
    },
    {
      id: OTHER_USER_ID,
      tenant_id: TENANT_ID,
      full_name: 'Team Member',
      is_active: true,
      monthly_expense_limit_cents: null,
    },
  ]
})

describe('GET /api/users', () => {
  it('includes monthly_expense_limit_cents', async () => {
    const token = await makeOwnerToken()
    const res = await request(makeApp()).get('/api/users').set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body[0]).toHaveProperty('monthly_expense_limit_cents')
  })
})

describe('PUT /api/users/:id/expense-limit', () => {
  it('sets a monthly limit as owner', async () => {
    const token = await makeOwnerToken()
    const res = await request(makeApp())
      .put(`/api/users/${OTHER_USER_ID}/expense-limit`)
      .set('Authorization', `Bearer ${token}`)
      .send({ monthly_expense_limit_cents: 50000 })

    expect(res.status).toBe(200)
    expect(res.body.monthly_expense_limit_cents).toBe(50000)
  })

  it('clears a limit by passing null', async () => {
    store.tables['users'] = [
      {
        id: OTHER_USER_ID,
        tenant_id: TENANT_ID,
        full_name: 'Team Member',
        is_active: true,
        monthly_expense_limit_cents: 50000,
      },
    ]
    const token = await makeOwnerToken()
    const res = await request(makeApp())
      .put(`/api/users/${OTHER_USER_ID}/expense-limit`)
      .set('Authorization', `Bearer ${token}`)
      .send({ monthly_expense_limit_cents: null })

    expect(res.status).toBe(200)
    expect(res.body.monthly_expense_limit_cents).toBe(null)
  })

  it('400s a negative limit', async () => {
    const token = await makeOwnerToken()
    const res = await request(makeApp())
      .put(`/api/users/${OTHER_USER_ID}/expense-limit`)
      .set('Authorization', `Bearer ${token}`)
      .send({ monthly_expense_limit_cents: -100 })

    expect(res.status).toBe(400)
  })

  it('403s a non-owner/admin role', async () => {
    const token = await makeStaffToken()
    const res = await request(makeApp())
      .put(`/api/users/${OTHER_USER_ID}/expense-limit`)
      .set('Authorization', `Bearer ${token}`)
      .send({ monthly_expense_limit_cents: 50000 })

    expect(res.status).toBe(403)
  })

  it('404s a user in another tenant', async () => {
    store.tables['users'] = [
      { id: OTHER_USER_ID, tenant_id: 'other-tenant', full_name: 'Team Member', is_active: true },
    ]
    const token = await makeOwnerToken()
    const res = await request(makeApp())
      .put(`/api/users/${OTHER_USER_ID}/expense-limit`)
      .set('Authorization', `Bearer ${token}`)
      .send({ monthly_expense_limit_cents: 50000 })

    expect(res.status).toBe(404)
  })
})

describe('PUT /api/users/:id/role', () => {
  beforeEach(() => {
    store.tables['users'] = [
      { id: OWNER_ID, tenant_id: TENANT_ID, full_name: 'Owner', role: 'owner', is_active: true },
      {
        id: OTHER_USER_ID,
        tenant_id: TENANT_ID,
        full_name: 'Team Member',
        role: 'staff',
        is_active: true,
      },
    ]
  })

  it('promotes a staff member to manager', async () => {
    const token = await makeOwnerToken()
    const res = await request(makeApp())
      .put(`/api/users/${OTHER_USER_ID}/role`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'manager' })

    expect(res.status).toBe(200)
    expect(res.body.role).toBe('manager')
  })

  it('rejects an invalid role', async () => {
    const token = await makeOwnerToken()
    const res = await request(makeApp())
      .put(`/api/users/${OTHER_USER_ID}/role`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'superadmin' })

    expect(res.status).toBe(400)
  })

  it('refuses to assign owner via this route', async () => {
    const token = await makeOwnerToken()
    const res = await request(makeApp())
      .put(`/api/users/${OTHER_USER_ID}/role`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'owner' })

    expect(res.status).toBe(400)
  })

  it('refuses to change the owner’s own role', async () => {
    const token = await makeOwnerToken()
    const res = await request(makeApp())
      .put(`/api/users/${OWNER_ID}/role`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'admin' })

    expect(res.status).toBe(400)
  })

  it('403s a non-owner/admin role', async () => {
    const token = await makeStaffToken()
    const res = await request(makeApp())
      .put(`/api/users/${OTHER_USER_ID}/role`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'manager' })

    expect(res.status).toBe(403)
  })

  it('404s a user in another tenant', async () => {
    store.tables['users'] = [
      {
        id: OTHER_USER_ID,
        tenant_id: 'other-tenant',
        full_name: 'Team Member',
        role: 'staff',
        is_active: true,
      },
    ]
    const token = await makeOwnerToken()
    const res = await request(makeApp())
      .put(`/api/users/${OTHER_USER_ID}/role`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'manager' })

    expect(res.status).toBe(404)
  })
})
