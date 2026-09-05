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
  store.tables['custom_automations'] = []
})

describe('POST /api/custom-automations — inbound_webhook trigger', () => {
  it('creates a webhook-triggered automation with a generated token, no prompt required', async () => {
    const res = await request(makeApp())
      .post('/api/custom-automations')
      .send({
        name: 'Zapier lead capture',
        trigger_type: 'inbound_webhook',
        trigger_config: { match_by: 'email', field_mapping: { email: 'lead_email' } },
        action_type: 'add_tag',
        action_config: { tag: 'zapier' },
      })

    expect(res.status).toBe(201)
    expect(typeof res.body.inbound_webhook_token).toBe('string')
    expect(res.body.inbound_webhook_token.length).toBeGreaterThan(10)
  })

  it('rejects a missing match_by', async () => {
    const res = await request(makeApp())
      .post('/api/custom-automations')
      .send({
        name: 'Bad',
        trigger_type: 'inbound_webhook',
        trigger_config: { field_mapping: { email: 'lead_email' } },
        action_type: 'add_tag',
        action_config: { tag: 'x' },
      })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('match_by')
  })

  it('rejects a field_mapping missing the match_by field', async () => {
    const res = await request(makeApp())
      .post('/api/custom-automations')
      .send({
        name: 'Bad',
        trigger_type: 'inbound_webhook',
        trigger_config: { match_by: 'phone', field_mapping: { email: 'lead_email' } },
        action_type: 'add_tag',
        action_config: { tag: 'x' },
      })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('match_by field')
  })

  it('rejects an unknown field_mapping key', async () => {
    const res = await request(makeApp())
      .post('/api/custom-automations')
      .send({
        name: 'Bad',
        trigger_type: 'inbound_webhook',
        trigger_config: { match_by: 'email', field_mapping: { company: 'company_name' } },
        action_type: 'add_tag',
        action_config: { tag: 'x' },
      })
    expect(res.status).toBe(400)
  })

  it('still requires natural_language_prompt for non-webhook triggers', async () => {
    const res = await request(makeApp())
      .post('/api/custom-automations')
      .send({
        name: 'Normal',
        trigger_type: 'no_response',
        action_type: 'add_tag',
        action_config: { tag: 'x' },
      })
    expect(res.status).toBe(400)
    expect(res.body.error).toContain('natural_language_prompt')
  })

  it('PATCH re-validates trigger_config for an existing webhook automation', async () => {
    ;(store.tables['custom_automations'] as Row[]).push({
      id: 'auto-wh-1',
      tenant_id: 'tenant-1',
      name: 'Webhook automation',
      status: 'draft',
      trigger_type: 'inbound_webhook',
      trigger_config: { match_by: 'email', field_mapping: { email: 'e' } },
      action_type: 'add_tag',
      action_config: { tag: 'x' },
      natural_language_prompt: 'Triggered by an inbound webhook (manually configured)',
      run_count: 0,
      last_run_at: null,
      inbound_webhook_token: 'tok123',
    })

    const res = await request(makeApp())
      .patch('/api/custom-automations/auto-wh-1')
      .send({ trigger_config: { field_mapping: { email: 'e' } } })

    expect(res.status).toBe(400)
    expect(res.body.error).toContain('match_by')
  })
})
