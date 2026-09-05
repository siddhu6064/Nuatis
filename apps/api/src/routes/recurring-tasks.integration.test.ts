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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000rt00001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken({ sub: 'user-1', tenantId: TENANT_ID, role: 'owner' }, { secret: SECRET })
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: recurringTasksRouter } = await import('./recurring-tasks.js')

function makeApp() {
  const app = express()
  app.use('/api/recurring-tasks', express.json(), recurringTasksRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['recurring_task_rules'] = []
})

describe('POST /api/recurring-tasks', () => {
  it('creates a weekly rule', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/recurring-tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Weekly check-in', frequency: 'weekly', day_of_week: 1 })

    expect(res.status).toBe(201)
    expect(res.body.enabled).toBe(true)
  })

  it('400s a monthly rule without day_of_month', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/recurring-tasks')
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'X', frequency: 'monthly' })
    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/recurring-tasks/:id', () => {
  it('soft-deletes', async () => {
    store.tables['recurring_task_rules'] = [
      { id: 'rule-1', tenant_id: TENANT_ID, title: 'X', enabled: true, deleted_at: null },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .delete('/api/recurring-tasks/rule-1')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(store.tables['recurring_task_rules']?.[0]?.['deleted_at']).toBeTruthy()
  })

  it('404s a rule in another tenant', async () => {
    store.tables['recurring_task_rules'] = [
      { id: 'rule-1', tenant_id: 'other-tenant', title: 'X', enabled: true },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .delete('/api/recurring-tasks/rule-1')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(404)
  })
})
