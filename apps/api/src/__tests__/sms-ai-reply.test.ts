import { jest, describe, test, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'

// ── Module-level mocks (must precede all dynamic imports) ─────────────────────

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const mockGenerateContent = jest.fn()
jest.unstable_mockModule('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
}))

const mockSendSms = jest.fn()
jest.unstable_mockModule('../lib/sms.js', () => ({
  sendSms: mockSendSms,
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['GEMINI_API_KEY'] = 'mock-gemini-key'

// ── Dynamic imports (after all unstable_mockModule calls) ─────────────────────

const { handleAiSmsReply } = await import('../lib/sms-ai-reply.js')

// ── Constants ─────────────────────────────────────────────────────────────────

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000smsai001'
const CONTACT_ID = 'cccccccc-0000-0000-0000-000smsai001'

const FROM_NUMBER = '+15125550002' // customer's number
const TO_NUMBER = '+15125550001' // our number

// ── Helpers ───────────────────────────────────────────────────────────────────

function seedBaseData() {
  store.tables['contacts'] = [{ id: CONTACT_ID, full_name: 'Alice', tenant_id: TENANT_ID }]
  store.tables['locations'] = [
    {
      tenant_id: TENANT_ID,
      business_profile: {},
      vertical: 'dental',
      telnyx_number: TO_NUMBER,
    },
  ]
  store.tables['tenants'] = [{ id: TENANT_ID, name: 'Test Dental' }]
  store.tables['sms_messages'] = [
    {
      direction: 'inbound',
      body: 'hi',
      created_at: '2024-01-01T00:00:00Z',
      tenant_id: TENANT_ID,
      contact_id: CONTACT_ID,
    },
  ]
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handleAiSmsReply', () => {
  beforeEach(() => {
    store = createStore()
    mockGenerateContent.mockReset()
    mockSendSms.mockReset()
    process.env['GEMINI_API_KEY'] = 'mock-gemini-key'

    // Default mock return values
    mockSendSms.mockResolvedValue({ success: true })
    mockGenerateContent.mockResolvedValue({ text: 'Hello — test team' })

    seedBaseData()
  })

  // ── Test 1: Normal message → Gemini called + SMS sent ─────────────────────

  test('normal message: Gemini called and sendSms called with AI response', async () => {
    const aiText = 'Hello response — test team'
    mockGenerateContent.mockResolvedValue({ text: aiText })

    await handleAiSmsReply(TENANT_ID, CONTACT_ID, 'Hello!', FROM_NUMBER, TO_NUMBER)

    expect(mockGenerateContent).toHaveBeenCalledTimes(1)
    expect(mockSendSms).toHaveBeenCalledTimes(1)
    expect(mockSendSms).toHaveBeenCalledWith(
      TO_NUMBER,
      FROM_NUMBER,
      aiText,
      expect.objectContaining({ tenantId: TENANT_ID, contactId: CONTACT_ID })
    )
  })

  // ── Test 2: Gemini returns empty → no SMS sent ─────────────────────────────

  test('Gemini returns empty string: sendSms is NOT called', async () => {
    mockGenerateContent.mockResolvedValue({ text: '' })

    await handleAiSmsReply(TENANT_ID, CONTACT_ID, 'Hello!', FROM_NUMBER, TO_NUMBER)

    expect(mockGenerateContent).toHaveBeenCalledTimes(1)
    expect(mockSendSms).not.toHaveBeenCalled()
  })

  // ── Test 3: AI error → no outbound SMS, error swallowed ───────────────────

  test('Gemini throws: resolves without throwing and sendSms is NOT called', async () => {
    mockGenerateContent.mockRejectedValue(new Error('Gemini API failure'))

    await expect(
      handleAiSmsReply(TENANT_ID, CONTACT_ID, 'Hello!', FROM_NUMBER, TO_NUMBER)
    ).resolves.toBeUndefined()

    expect(mockSendSms).not.toHaveBeenCalled()
  })

  // ── Test 4: Conversation history limited to last 5 messages ───────────────

  test('only last 5 of 10 history messages are included in prompt', async () => {
    // Seed 10 messages — alternating inbound/outbound
    store.tables['sms_messages'] = Array.from({ length: 10 }, (_, i) => ({
      direction: i % 2 === 0 ? 'inbound' : 'outbound',
      body: `message ${i + 1}`,
      created_at: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      tenant_id: TENANT_ID,
      contact_id: CONTACT_ID,
    }))

    await handleAiSmsReply(TENANT_ID, CONTACT_ID, 'Latest message', FROM_NUMBER, TO_NUMBER)

    expect(mockGenerateContent).toHaveBeenCalledTimes(1)

    const callArg = mockGenerateContent.mock.calls[0]?.[0] as {
      contents: Array<{ parts: Array<{ text: string }> }>
    }
    const promptText: string = callArg.contents[0]!.parts[0]!.text

    // Count "Customer:" and "Us:" occurrences in the prompt
    const customerLines = (promptText.match(/\bCustomer:/g) ?? []).length
    const usLines = (promptText.match(/\bUs:/g) ?? []).length
    const totalHistoryLines = customerLines + usLines

    // The prompt may also include "Customer just replied:" which has "Customer"
    // but not "Customer:" — our regex uses \bCustomer: so it matches only history lines
    expect(totalHistoryLines).toBeLessThanOrEqual(5)
    expect(totalHistoryLines).toBeGreaterThan(0)
  })

  // ── Test 5: Missing GEMINI_API_KEY → returns early without sendSms ─────────

  test('missing GEMINI_API_KEY: returns early without calling sendSms', async () => {
    delete process.env['GEMINI_API_KEY']

    await handleAiSmsReply(TENANT_ID, CONTACT_ID, 'Hello!', FROM_NUMBER, TO_NUMBER)

    expect(mockGenerateContent).not.toHaveBeenCalled()
    expect(mockSendSms).not.toHaveBeenCalled()
  })
})
