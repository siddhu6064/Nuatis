import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from './__test-support__/supabase-mock.js'

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const [{ default: express }, { default: request }, { default: automationWebhookPublicRouter }] =
  await Promise.all([
    import('express'),
    import('supertest'),
    import('./automation-webhook-public.js'),
  ])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/webhooks/automations', automationWebhookPublicRouter)
  return app
}

const TENANT_ID = 'tenant-wh-1'
const TOKEN = 'test-webhook-token-abc123'

function seedAutomation(overrides: Row = {}): void {
  store.tables['custom_automations'] = [
    {
      id: 'auto-1',
      tenant_id: TENANT_ID,
      name: 'Lead capture',
      status: 'active',
      trigger_type: 'inbound_webhook',
      trigger_config: { match_by: 'email', field_mapping: { email: 'lead_email' } },
      action_type: 'add_tag',
      action_config: { tag: 'webhook-lead' },
      run_count: 0,
      last_run_at: null,
      inbound_webhook_token: TOKEN,
      ...overrides,
    },
  ]
}

beforeEach(() => {
  store = createStore()
  store.tables['contacts'] = []
  seedAutomation()
})

describe('POST /webhooks/automations/:token', () => {
  it('404s for an unknown token', async () => {
    const res = await request(makeApp())
      .post('/webhooks/automations/does-not-exist')
      .send({ lead_email: 'a@b.com' })
    expect(res.status).toBe(404)
  })

  it('404s for a paused automation', async () => {
    seedAutomation({ status: 'paused' })
    const res = await request(makeApp())
      .post(`/webhooks/automations/${TOKEN}`)
      .send({ lead_email: 'a@b.com' })
    expect(res.status).toBe(404)
  })

  it('400s when the payload is missing the mapped match field', async () => {
    const res = await request(makeApp())
      .post(`/webhooks/automations/${TOKEN}`)
      .send({ some_other_field: 'x' })
    expect(res.status).toBe(400)
  })

  it('creates a new contact, runs the action, and bumps run_count', async () => {
    const res = await request(makeApp()).post(`/webhooks/automations/${TOKEN}`).send({
      lead_email: 'newlead@example.com',
    })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    const contacts = store.tables['contacts'] as Row[]
    expect(contacts).toHaveLength(1)
    expect(contacts[0]?.['email']).toBe('newlead@example.com')
    expect(contacts[0]?.['source']).toBe('inbound_webhook')
    expect(contacts[0]?.['tags']).toEqual(['webhook-lead'])

    const automations = store.tables['custom_automations'] as Row[]
    expect(automations[0]?.['run_count']).toBe(1)
    expect(automations[0]?.['last_run_at']).toBeTruthy()
  })

  it('matches an existing contact instead of creating a duplicate', async () => {
    store.tables['contacts'] = [
      {
        id: 'contact-existing',
        tenant_id: TENANT_ID,
        email: 'existing@example.com',
        full_name: 'Existing Person',
        tags: [],
      },
    ]

    const res = await request(makeApp())
      .post(`/webhooks/automations/${TOKEN}`)
      .send({ lead_email: 'existing@example.com' })

    expect(res.status).toBe(200)
    const contacts = store.tables['contacts'] as Row[]
    expect(contacts).toHaveLength(1)
    expect(contacts[0]?.['tags']).toEqual(['webhook-lead'])
  })

  it('maps first_name/last_name into the new contact full_name', async () => {
    seedAutomation({
      trigger_config: {
        match_by: 'email',
        field_mapping: { email: 'lead_email', first_name: 'fname', last_name: 'lname' },
      },
    })

    const res = await request(makeApp()).post(`/webhooks/automations/${TOKEN}`).send({
      lead_email: 'jane@example.com',
      fname: 'Jane',
      lname: 'Doe',
    })

    expect(res.status).toBe(200)
    const contacts = store.tables['contacts'] as Row[]
    expect(contacts[0]?.['full_name']).toBe('Jane Doe')
  })
})
