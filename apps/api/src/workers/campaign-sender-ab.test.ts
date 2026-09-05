import { jest, describe, it, expect, beforeEach } from '@jest/globals'
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

const mockSendSms = jest
  .fn<() => Promise<{ success: boolean }>>()
  .mockResolvedValue({ success: true })
jest.unstable_mockModule('../lib/sms.js', () => ({ sendSms: mockSendSms }))

const mockSendEmail = jest.fn<() => Promise<boolean>>().mockResolvedValue(true)
jest.unstable_mockModule('../lib/email-client.js', () => ({ sendEmail: mockSendEmail }))

jest.unstable_mockModule('../lib/email-risk.js', () => ({
  shouldSuppressEmail: () => false,
}))
jest.unstable_mockModule('../lib/sms-risk.js', () => ({
  shouldSuppressSms: () => false,
}))

let capturedProcessor: ((job: { data: unknown }) => Promise<void>) | null = null
jest.unstable_mockModule('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn(), close: jest.fn() })),
  Worker: jest
    .fn()
    .mockImplementation((_name: unknown, processor: (job: { data: unknown }) => Promise<void>) => {
      capturedProcessor = processor
      return { on: jest.fn(), close: jest.fn() }
    }),
}))
jest.unstable_mockModule('../lib/bullmq-connection.js', () => ({
  createBullMQConnection: () => ({}),
}))

const { createCampaignSenderWorker } = await import('./campaign-sender.js')
createCampaignSenderWorker()

async function runSend(data: { campaignId: string; tenantId: string }): Promise<void> {
  if (!capturedProcessor) throw new Error('processor not captured')
  await capturedProcessor({ data })
}

const TENANT_ID = 'tenant-ab-1'
const CAMPAIGN_ID = 'camp-ab-1'

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [{ id: TENANT_ID, name: 'Test Biz' }]
  store.tables['locations'] = []
  store.tables['campaigns'] = [
    {
      id: CAMPAIGN_ID,
      tenant_id: TENANT_ID,
      status: 'scheduled',
      objective: 'reactivate_lapsed',
      channels: ['sms'],
      segment_id: null,
      contact_count: null,
    },
  ]
  store.tables['campaign_messages'] = [
    {
      id: 'msg-a',
      campaign_id: CAMPAIGN_ID,
      channel: 'sms',
      variant: 'a',
      subject: null,
      body: 'Variant A body',
      approved: true,
    },
    {
      id: 'msg-b',
      campaign_id: CAMPAIGN_ID,
      channel: 'sms',
      variant: 'b',
      subject: null,
      body: 'Variant B body',
      approved: true,
    },
  ]
  store.tables['campaign_sends'] = []
  store.tables['contacts'] = Array.from({ length: 20 }, (_, i) => ({
    id: `contact-${i}`,
    tenant_id: TENANT_ID,
    full_name: `Contact ${i}`,
    phone: `+1512555${String(i).padStart(4, '0')}`,
    email: `contact${i}@example.com`,
    sms_opt_in: true,
    email_status: null,
    email_risk_score: null,
    is_archived: false,
  }))

  mockSendSms.mockClear()
  mockSendSms.mockResolvedValue({ success: true })
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('campaign-sender worker — A/B variant split', () => {
  it('splits contacts across both variants and records the matching variant + body on each send', async () => {
    await runSend({ campaignId: CAMPAIGN_ID, tenantId: TENANT_ID })

    const sends = store.tables['campaign_sends'] as Row[]
    expect(sends).toHaveLength(20)

    const variantsSeen = new Set(sends.map((s) => s['variant']))
    expect(variantsSeen.has('a')).toBe(true)
    expect(variantsSeen.has('b')).toBe(true)

    const bodyByVariant: Record<string, string> = { a: 'Variant A body', b: 'Variant B body' }
    for (const call of mockSendSms.mock.calls) {
      const [, , body] = call as unknown as [string, string, string]
      const send = sends.find((s) => body.startsWith(bodyByVariant[s['variant'] as string]!))
      expect(send).toBeDefined()
    }
  })

  it('assigns the same variant to the same contact on a re-send (deterministic)', async () => {
    await runSend({ campaignId: CAMPAIGN_ID, tenantId: TENANT_ID })
    const firstPass = new Map(
      (store.tables['campaign_sends'] as Row[]).map((s) => [s['contact_id'], s['variant']])
    )

    // Reset campaign back to scheduled and re-run to compare variant assignment
    store.tables['campaigns'] = [
      { ...(store.tables['campaigns'] as Row[])[0]!, status: 'scheduled' },
    ]
    store.tables['campaign_sends'] = []
    await runSend({ campaignId: CAMPAIGN_ID, tenantId: TENANT_ID })
    const secondPass = new Map(
      (store.tables['campaign_sends'] as Row[]).map((s) => [s['contact_id'], s['variant']])
    )

    for (const [contactId, variant] of firstPass) {
      expect(secondPass.get(contactId)).toBe(variant)
    }
  })

  it('a single-variant campaign (no b) always sends variant a, unaffected by the split', async () => {
    store.tables['campaign_messages'] = [
      {
        id: 'msg-a-only',
        campaign_id: CAMPAIGN_ID,
        channel: 'sms',
        variant: 'a',
        subject: null,
        body: 'Only body',
        approved: true,
      },
    ]

    await runSend({ campaignId: CAMPAIGN_ID, tenantId: TENANT_ID })

    const sends = store.tables['campaign_sends'] as Row[]
    expect(sends).toHaveLength(20)
    expect(sends.every((s) => s['variant'] === 'a')).toBe(true)
  })
})
