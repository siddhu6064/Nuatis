import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

// ── Env ───────────────────────────────────────────────────────────────────────
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

// ── Mutable store — reset in beforeEach ──────────────────────────────────────
let store: MockStore = createStore()

// ── Supabase mock ─────────────────────────────────────────────────────────────
jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

// ── sendSms mock ──────────────────────────────────────────────────────────────
const mockSendSms = jest
  .fn<() => Promise<{ success: boolean }>>()
  .mockResolvedValue({ success: true })

jest.unstable_mockModule('../lib/sms.js', () => ({
  sendSms: mockSendSms,
}))

// ── sendEmail mock ────────────────────────────────────────────────────────────
const mockSendEmail = jest.fn<() => Promise<boolean>>().mockResolvedValue(true)

jest.unstable_mockModule('../lib/email-client.js', () => ({
  sendEmail: mockSendEmail,
}))

// ── shouldSuppressEmail mock — default: not suppressed ───────────────────────
const mockShouldSuppressEmail = jest.fn<() => boolean>().mockReturnValue(false)

jest.unstable_mockModule('../lib/email-risk.js', () => ({
  shouldSuppressEmail: mockShouldSuppressEmail,
}))

// ── BullMQ mock — capture the processor fn ───────────────────────────────────
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

// ── Dynamic imports (after all mocks) ────────────────────────────────────────
const { createCampaignSenderWorker } = await import('./campaign-sender.js')

// Instantiate once — captures the processor via the mocked Worker constructor
createCampaignSenderWorker()

// ── Helper ────────────────────────────────────────────────────────────────────
async function runSend(data: { campaignId: string; tenantId: string }): Promise<void> {
  if (!capturedProcessor)
    throw new Error('processor not captured — was createCampaignSenderWorker called?')
  await capturedProcessor({ data })
}

// ── Fixtures ──────────────────────────────────────────────────────────────────
const TENANT_ID = 'tenant-1'
const CAMPAIGN_ID = 'camp-p13-sender-1'

function makeScheduledCampaign(channels: string[] = ['sms']): Row {
  return {
    id: CAMPAIGN_ID,
    tenant_id: TENANT_ID,
    status: 'scheduled',
    objective: 'reactivate_lapsed',
    channels,
    segment_id: null,
    contact_count: null,
  }
}

function makeApprovedMessage(
  channel = 'sms',
  body = 'Hi {first_name}, your appointment is ready!'
): Row {
  return {
    id: `msg-${channel}`,
    campaign_id: CAMPAIGN_ID,
    channel,
    subject: channel === 'email' ? 'Hello from Test Biz' : null,
    body,
    approved: true,
  }
}

function makeContact(
  id: string,
  fullName: string | null,
  smsOptIn: boolean | null,
  phone = '+15125550001'
): Row {
  return {
    id,
    tenant_id: TENANT_ID,
    full_name: fullName,
    phone,
    email: `${id}@example.com`,
    sms_opt_in: smsOptIn,
    email_status: null,
    email_risk_score: null,
    is_archived: false,
  }
}

// ── beforeEach: fresh store ───────────────────────────────────────────────────
beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [{ id: TENANT_ID, name: 'Test Biz' }]
  store.tables['locations'] = []
  store.tables['campaigns'] = []
  store.tables['campaign_messages'] = []
  store.tables['campaign_sends'] = []
  store.tables['contacts'] = []

  mockSendSms.mockClear()
  mockSendSms.mockResolvedValue({ success: true })
  mockSendEmail.mockClear()
  mockSendEmail.mockResolvedValue(true)
  mockShouldSuppressEmail.mockClear()
  mockShouldSuppressEmail.mockReturnValue(false)

  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('campaign-sender worker — P13', () => {
  // ── Test 1: Refuses to send with unapproved messages ───────────────────────
  it('throws an "unapproved" error and does not call sendSms before the approval gate', async () => {
    store.tables['campaigns'] = [makeScheduledCampaign()]
    store.tables['campaign_messages'] = [{ ...makeApprovedMessage(), approved: false }]
    store.tables['contacts'] = [makeContact('c-1', 'John Smith', true)]

    await expect(runSend({ campaignId: CAMPAIGN_ID, tenantId: TENANT_ID })).rejects.toThrow(
      /unapproved/i
    )

    expect(mockSendSms).not.toHaveBeenCalled()

    // Status must NOT have advanced to 'running' — error thrown before Step 3
    const camps = store.tables['campaigns'] as Row[]
    const camp = camps.find((c) => c['id'] === CAMPAIGN_ID)
    expect(camp?.['status']).toBe('scheduled')
  })

  // ── Test 2: Skips contacts with sms_opt_in !== true ────────────────────────
  it('inserts opted_out rows for non-opted-in contacts and sends only to the opted-in one', async () => {
    store.tables['campaigns'] = [makeScheduledCampaign(['sms'])]
    store.tables['campaign_messages'] = [makeApprovedMessage('sms')]
    store.tables['contacts'] = [
      makeContact('c-A', 'John Smith', true, '+15125550001'),
      makeContact('c-B', 'Jane Doe', false, '+15125550002'),
      makeContact('c-C', 'Bob Jones', null, '+15125550003'),
    ]

    await runSend({ campaignId: CAMPAIGN_ID, tenantId: TENANT_ID })

    // sendSms called exactly once — only Contact A
    expect(mockSendSms).toHaveBeenCalledTimes(1)

    const sends = store.tables['campaign_sends'] as Row[]
    expect(sends.length).toBe(3)

    const sentRows = sends.filter((s) => s['status'] === 'sent')
    const optedOutRows = sends.filter((s) => s['status'] === 'opted_out')
    expect(sentRows.length).toBe(1)
    expect(optedOutRows.length).toBe(2)
    expect(sentRows[0]?.['contact_id']).toBe('c-A')
  })

  // ── Test 3: Personalisation replaces {first_name} from full_name split ──────
  it('personalises the SMS body with the first word of full_name', async () => {
    store.tables['campaigns'] = [makeScheduledCampaign(['sms'])]
    store.tables['campaign_messages'] = [makeApprovedMessage('sms')]
    store.tables['contacts'] = [makeContact('c-1', 'Maria Garcia', true)]

    await runSend({ campaignId: CAMPAIGN_ID, tenantId: TENANT_ID })

    expect(mockSendSms).toHaveBeenCalledTimes(1)
    // Argument index 2 is the message body (from, to, body, options)
    const sentBody = (mockSendSms.mock.calls[0] as unknown[])[2] as string
    expect(sentBody).toContain('Maria')
    expect(sentBody).not.toContain('{first_name}')
    expect(sentBody).not.toContain('Maria Garcia')
  })

  // ── Test 4: Personalisation falls back to 'there' when full_name is null ───
  it("uses 'there' as the first name when contact full_name is null", async () => {
    store.tables['campaigns'] = [makeScheduledCampaign(['sms'])]
    store.tables['campaign_messages'] = [makeApprovedMessage('sms')]
    store.tables['contacts'] = [makeContact('c-1', null, true)]

    await runSend({ campaignId: CAMPAIGN_ID, tenantId: TENANT_ID })

    expect(mockSendSms).toHaveBeenCalledTimes(1)
    const sentBody = (mockSendSms.mock.calls[0] as unknown[])[2] as string
    expect(sentBody).toContain('Hi there,')
  })

  // ── Test 5: Per-contact send errors do not crash the worker ─────────────────
  it('continues delivery after a per-contact sendSms failure and completes the campaign', async () => {
    store.tables['campaigns'] = [makeScheduledCampaign(['sms'])]
    store.tables['campaign_messages'] = [makeApprovedMessage('sms')]
    store.tables['contacts'] = [
      makeContact('c-1', 'Alice A', true, '+15125550001'),
      makeContact('c-2', 'Bob B', true, '+15125550002'),
      makeContact('c-3', 'Carol C', true, '+15125550003'),
    ]

    // Contact 2 fails; contacts 1 and 3 succeed
    mockSendSms
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('Telnyx network error'))
      .mockResolvedValueOnce({ success: true })

    // Worker must NOT throw — per-contact errors are isolated
    await expect(runSend({ campaignId: CAMPAIGN_ID, tenantId: TENANT_ID })).resolves.not.toThrow()

    // All three contacts were attempted
    expect(mockSendSms).toHaveBeenCalledTimes(3)

    // Check individual campaign_sends statuses
    const sends = store.tables['campaign_sends'] as Row[]
    const c1Send = sends.find((s) => s['contact_id'] === 'c-1')
    const c2Send = sends.find((s) => s['contact_id'] === 'c-2')
    const c3Send = sends.find((s) => s['contact_id'] === 'c-3')

    expect(c1Send?.['status']).toBe('sent')
    expect(c2Send?.['status']).toBe('failed')
    expect(c3Send?.['status']).toBe('sent')

    // Campaign ends as 'complete' — partial failure is not a fatal error
    const camps = store.tables['campaigns'] as Row[]
    const camp = camps.find((c) => c['id'] === CAMPAIGN_ID)
    expect(camp?.['status']).toBe('complete')
  })
})
