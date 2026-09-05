import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'
import { seedEntitledTenant } from '../routes/__test-support__/tenant-fixture.js'

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['GEMINI_API_KEY'] = 'test-gemini-key'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

jest.unstable_mockModule('../lib/auth.js', () => ({
  requireAuth: (
    req: { tenantId: string; userId: string; role: string },
    _res: unknown,
    next: () => void
  ) => {
    req.tenantId = 'tenant-1'
    req.userId = 'user-1'
    req.role = 'admin'
    next()
  },
  requireModule: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))

jest.unstable_mockModule('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn(), close: jest.fn() })),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn() })),
}))
jest.unstable_mockModule('../lib/bullmq-connection.js', () => ({
  createBullMQConnection: jest.fn().mockReturnValue({}),
}))

jest.unstable_mockModule('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: jest
        .fn<() => Promise<{ text: string }>>()
        .mockResolvedValue({ text: JSON.stringify({ body: 'Generated body {first_name}!' }) }),
    },
  })),
}))

const [{ default: express }, { default: request }, { default: campaignsRouter }] =
  await Promise.all([import('express'), import('supertest'), import('../routes/campaigns.js')])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/campaigns', campaignsRouter)
  return app
}

const CAMPAIGN_ID = 'camp-ab-route-1'

beforeEach(() => {
  store = createStore()
  seedEntitledTenant(store, 'tenant-1')
  store.tables['campaigns'] = [
    {
      id: CAMPAIGN_ID,
      tenant_id: 'tenant-1',
      status: 'draft',
      objective: 'reactivate_lapsed',
      channels: ['sms'],
      segment_id: null,
      contact_count: null,
    },
  ]
  store.tables['campaign_messages'] = []
  store.tables['campaign_sends'] = []
})

describe('POST /api/campaigns/:id/generate — A/B variants', () => {
  it('generating variant b does not overwrite an approved variant a', async () => {
    store.tables['campaign_messages'] = [
      {
        id: 'msg-a',
        campaign_id: CAMPAIGN_ID,
        channel: 'sms',
        variant: 'a',
        subject: null,
        body: 'Approved A copy',
        approved: true,
      },
    ]

    const res = await request(makeApp())
      .post(`/api/campaigns/${CAMPAIGN_ID}/generate`)
      .send({ variant: 'b' })

    expect(res.status).toBe(200)
    const messages = res.body.messages as Row[]
    const a = messages.find((m) => m['variant'] === 'a')
    const b = messages.find((m) => m['variant'] === 'b')
    expect(a?.['body']).toBe('Approved A copy')
    expect(a?.['approved']).toBe(true)
    expect(b).toBeDefined()
    expect(b?.['approved']).toBe(false)
  })

  it('defaults to variant a when no variant is specified', async () => {
    const res = await request(makeApp()).post(`/api/campaigns/${CAMPAIGN_ID}/generate`).send({})

    expect(res.status).toBe(200)
    const messages = res.body.messages as Row[]
    expect(messages).toHaveLength(1)
    expect(messages[0]?.['variant']).toBe('a')
  })
})

describe('GET /api/campaigns/:id/performance/summary — A/B breakdown', () => {
  it('reports by_variant and picks a winner once both sides clear the sample floor', async () => {
    const sends: Row[] = []
    for (let i = 0; i < 15; i++) {
      sends.push({
        id: `send-a-${i}`,
        campaign_id: CAMPAIGN_ID,
        contact_id: `c-a-${i}`,
        channel: 'sms',
        variant: 'a',
        status: i < 3 ? 'opened' : 'delivered',
      })
    }
    for (let i = 0; i < 15; i++) {
      sends.push({
        id: `send-b-${i}`,
        campaign_id: CAMPAIGN_ID,
        contact_id: `c-b-${i}`,
        channel: 'sms',
        variant: 'b',
        status: i < 9 ? 'opened' : 'delivered',
      })
    }
    store.tables['campaign_sends'] = sends

    const res = await request(makeApp()).get(`/api/campaigns/${CAMPAIGN_ID}/performance/summary`)

    expect(res.status).toBe(200)
    const byVariant = res.body.by_variant as { variant: string; open_rate: number }[]
    const a = byVariant.find((v) => v.variant === 'a')!
    const b = byVariant.find((v) => v.variant === 'b')!
    expect(a.open_rate).toBeLessThan(b.open_rate)
    expect(res.body.variant_winner).toBe('b')
  })

  it('does not call a winner below the minimum sample size', async () => {
    store.tables['campaign_sends'] = [
      {
        id: 'send-a-1',
        campaign_id: CAMPAIGN_ID,
        contact_id: 'c-a-1',
        channel: 'sms',
        variant: 'a',
        status: 'opened',
      },
      {
        id: 'send-b-1',
        campaign_id: CAMPAIGN_ID,
        contact_id: 'c-b-1',
        channel: 'sms',
        variant: 'b',
        status: 'delivered',
      },
    ]

    const res = await request(makeApp()).get(`/api/campaigns/${CAMPAIGN_ID}/performance/summary`)

    expect(res.status).toBe(200)
    expect(res.body.variant_winner).toBeNull()
  })
})
