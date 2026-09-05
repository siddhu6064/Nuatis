import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from './__test-support__/supabase-mock.js'
import { seedEntitledTenant } from './__test-support__/tenant-fixture.js'

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

jest.unstable_mockModule('../lib/auth.js', () => ({
  requireAuth: (
    _req: { tenantId: string; userId: string; role: string },
    _res: unknown,
    next: () => void
  ) => {
    _req.tenantId = 'tenant-1'
    _req.userId = 'user-1'
    _req.role = 'admin'
    next()
  },
}))

const [{ default: express }, { default: request }, { default: customAutomationsRouter }] =
  await Promise.all([
    import('express'),
    import('supertest'),
    import('../routes/custom-automations.js'),
  ])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/custom-automations', customAutomationsRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  seedEntitledTenant(store, 'tenant-1')
  store.tables['custom_automations'] = [
    {
      id: 'auto-1',
      tenant_id: 'tenant-1',
      name: 'Test',
      status: 'draft',
      trigger_type: 'no_response',
      trigger_config: {},
      action_type: 'send_sms',
      action_config: {},
      natural_language_prompt: 'test',
      run_count: 0,
      last_run_at: null,
    },
    {
      id: 'auto-other-tenant',
      tenant_id: 'tenant-2',
      name: 'Foreign',
      status: 'draft',
      trigger_type: 'no_response',
      trigger_config: {},
      action_type: 'send_sms',
      action_config: {},
      natural_language_prompt: 'test',
      run_count: 0,
      last_run_at: null,
    },
  ]
  store.tables['custom_automation_steps'] = []
})

describe('PUT /api/custom-automations/:id/steps', () => {
  it('replaces the step list and assigns sequential step_order', async () => {
    const res = await request(makeApp())
      .put('/api/custom-automations/auto-1/steps')
      .send({
        steps: [
          { action_type: 'add_tag', action_config: { tag: 'nurtured' }, delay_days: 2 },
          { action_type: 'send_sms', action_config: { message: 'Hi again' }, delay_days: 5 },
        ],
      })

    expect(res.status).toBe(200)
    expect(res.body.steps).toHaveLength(2)
    expect(res.body.steps.map((s: Row) => s['step_order'])).toEqual([1, 2])
  })

  it('400s a step with an invalid action_type', async () => {
    const res = await request(makeApp())
      .put('/api/custom-automations/auto-1/steps')
      .send({ steps: [{ action_type: 'launch_missiles', action_config: {} }] })

    expect(res.status).toBe(400)
  })

  it('400s a step with an invalid condition_op', async () => {
    const res = await request(makeApp())
      .put('/api/custom-automations/auto-1/steps')
      .send({
        steps: [
          {
            action_type: 'add_tag',
            action_config: { tag: 'x' },
            condition_field: 'tags',
            condition_op: 'flibbertigibbet',
          },
        ],
      })

    expect(res.status).toBe(400)
  })

  it('clearing to an empty steps array removes all steps', async () => {
    store.tables['custom_automation_steps'] = [
      {
        id: 's1',
        automation_id: 'auto-1',
        tenant_id: 'tenant-1',
        step_order: 1,
        action_type: 'add_tag',
        action_config: {},
      },
    ]
    const res = await request(makeApp())
      .put('/api/custom-automations/auto-1/steps')
      .send({ steps: [] })

    expect(res.status).toBe(200)
    expect(res.body.steps).toEqual([])
    expect((store.tables['custom_automation_steps'] as Row[]).length).toBe(0)
  })

  it('404s an automation in another tenant', async () => {
    const res = await request(makeApp())
      .put('/api/custom-automations/auto-other-tenant/steps')
      .send({ steps: [{ action_type: 'add_tag', action_config: { tag: 'x' } }] })

    expect(res.status).toBe(404)
  })
})

describe('GET /api/custom-automations/:id/steps', () => {
  it('lists steps ordered by step_order', async () => {
    store.tables['custom_automation_steps'] = [
      {
        id: 's2',
        automation_id: 'auto-1',
        tenant_id: 'tenant-1',
        step_order: 2,
        action_type: 'send_sms',
        action_config: {},
      },
      {
        id: 's1',
        automation_id: 'auto-1',
        tenant_id: 'tenant-1',
        step_order: 1,
        action_type: 'add_tag',
        action_config: {},
      },
    ]
    const res = await request(makeApp()).get('/api/custom-automations/auto-1/steps')

    expect(res.status).toBe(200)
    expect(res.body.steps.map((s: Row) => s['id'])).toEqual(['s1', 's2'])
  })

  it('404s an automation in another tenant', async () => {
    const res = await request(makeApp()).get('/api/custom-automations/auto-other-tenant/steps')

    expect(res.status).toBe(404)
  })
})
