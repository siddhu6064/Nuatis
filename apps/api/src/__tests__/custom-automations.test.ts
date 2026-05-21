import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

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

jest.unstable_mockModule('../lib/automation-ai-builder.js', () => ({
  generateAutomationConfig: async () => ({
    name: 'Test Automation',
    description: 'Follow up with inactive contacts',
    trigger_type: 'no_response',
    trigger_config: { days: 3 },
    action_type: 'send_sms',
    action_config: { message: 'Hi, just checking in!' },
    confidence: 0.9,
  }),
}))

// Dynamic imports AFTER mocks
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
  store.tables['custom_automations'] = []
})

describe('POST /api/custom-automations/generate', () => {
  it('returns generated automation config from AI builder', async () => {
    const res = await request(makeApp())
      .post('/api/custom-automations/generate')
      .set('Content-Type', 'application/json')
      .send({ prompt: 'Send SMS to contacts who have not responded in 3 days' })

    expect(res.status).toBe(200)
    expect(res.body.automation.trigger_type).toBe('no_response')
    expect(res.body.automation.action_type).toBe('send_sms')
    expect(res.body.automation.confidence).toBeGreaterThanOrEqual(0)
  })
})

describe('POST /api/custom-automations/generate — missing prompt', () => {
  it('returns 400 when prompt is missing', async () => {
    const res = await request(makeApp())
      .post('/api/custom-automations/generate')
      .set('Content-Type', 'application/json')
      .send({})

    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/prompt/)
  })
})

describe('POST /api/custom-automations', () => {
  it('creates automation with status=draft', async () => {
    const res = await request(makeApp())
      .post('/api/custom-automations')
      .set('Content-Type', 'application/json')
      .send({
        name: 'No Response Follow-Up',
        natural_language_prompt: 'Send SMS to contacts who have not responded in 3 days',
        trigger_type: 'no_response',
        trigger_config: { days: 3 },
        action_type: 'send_sms',
        action_config: { message: 'Hi, just checking in!' },
      })

    expect(res.status).toBe(201)
    expect(res.body.status).toBe('draft')
    expect(res.body.tenant_id).toBe('tenant-1')
    // Confirm stored
    const rows = store.tables['custom_automations'] as Row[]
    expect(rows.length).toBe(1)
    expect(rows[0]!.name).toBe('No Response Follow-Up')
  })
})

describe('POST /api/custom-automations — invalid trigger_type', () => {
  it('returns 400 for unknown trigger_type', async () => {
    const res = await request(makeApp())
      .post('/api/custom-automations')
      .set('Content-Type', 'application/json')
      .send({
        name: 'Test',
        natural_language_prompt: 'Test prompt',
        trigger_type: 'unknown_trigger',
        action_type: 'send_sms',
      })

    expect(res.status).toBe(400)
    expect(res.body.error).toBeTruthy()
  })
})

describe('POST /api/custom-automations/:id/activate', () => {
  it('changes automation status from draft to active', async () => {
    // Seed a draft automation
    const autoId = 'auto-1'
    ;(store.tables['custom_automations'] as Row[]).push({
      id: autoId,
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
    })

    const res = await request(makeApp()).post(`/api/custom-automations/${autoId}/activate`)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('active')
  })
})

describe('DELETE /api/custom-automations/:id', () => {
  it('deletes automation and returns ok', async () => {
    const autoId = 'auto-2'
    ;(store.tables['custom_automations'] as Row[]).push({
      id: autoId,
      tenant_id: 'tenant-1',
      name: 'To Delete',
      status: 'draft',
      trigger_type: 'birthday',
      trigger_config: {},
      action_type: 'create_task',
      action_config: {},
      natural_language_prompt: 'test',
      run_count: 0,
      last_run_at: null,
    })

    const res = await request(makeApp()).delete(`/api/custom-automations/${autoId}`)

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    // Verify removed from store
    const rows = store.tables['custom_automations'] as Row[]
    expect(rows.length).toBe(0)
  })
})
