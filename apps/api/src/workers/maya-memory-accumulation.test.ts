/**
 * Integration test — two consecutive calls from the same phone number.
 * Uses real mergeFacts() logic; mocks only Supabase and Gemini.
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'
import type { MayaMemoryJobData } from './maya-memory-extractor.js'

// ── Mutable store ─────────────────────────────────────────────────────────────
let store: MockStore = createStore()

// ── Supabase mock ─────────────────────────────────────────────────────────────
jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

// ── Gemini mock ───────────────────────────────────────────────────────────────
const mockGenerateContent = jest.fn()
jest.unstable_mockModule('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
}))

// ── BullMQ mock ───────────────────────────────────────────────────────────────
let capturedProcessor: ((job: { data: unknown; id?: string }) => Promise<void>) | null = null

jest.unstable_mockModule('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ close: jest.fn() })),
  Worker: jest
    .fn()
    .mockImplementation(
      (_name: unknown, processor: (job: { data: unknown }) => Promise<void>, _opts: unknown) => {
        capturedProcessor = processor
        return { on: jest.fn(), close: jest.fn() }
      }
    ),
}))

jest.unstable_mockModule('../lib/bullmq-connection.js', () => ({
  createBullMQConnection: () => ({}),
}))

// ── Env setup ─────────────────────────────────────────────────────────────────
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['GEMINI_API_KEY'] = 'mock-gemini-key'

// ── Dynamic imports ───────────────────────────────────────────────────────────
const { createMayaMemoryExtractor } = await import('./maya-memory-extractor.js')
createMayaMemoryExtractor()

// ── Test constants ────────────────────────────────────────────────────────────
const TENANT_ID = 'aaaaaaaa-0000-0000-0000-acc0test0001'
const PHONE = '+15125550101'

const SESSION_1 = 'session-acc-0000-0000-0000-000000000001'
const SESSION_2 = 'session-acc-0000-0000-0000-000000000002'

// ── Helper ────────────────────────────────────────────────────────────────────
async function runProcessor(data: MayaMemoryJobData): Promise<void> {
  if (!capturedProcessor)
    throw new Error('processor not captured — was createMayaMemoryExtractor called?')
  await capturedProcessor({ data, id: 'test-job-id' })
}

// ── Setup ─────────────────────────────────────────────────────────────────────
beforeEach(() => {
  store = createStore()
  mockGenerateContent.mockReset()
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

// ── Test ──────────────────────────────────────────────────────────────────────
describe('caller memory accumulation across two calls', () => {
  it('merges facts across two consecutive calls from the same phone', async () => {
    // ── Call 1 ─────────────────────────────────────────────────────────────────
    store.tables['voice_sessions'] = [
      {
        id: SESSION_1,
        tenant_id: TENANT_ID,
        transcript: 'Hi, I would like to book a morning appointment.',
        outcome: 'booked',
        tool_calls_made: null,
      },
    ]
    store.tables['caller_memory'] = [] // no prior memory
    store.tables['contacts'] = []

    const call1Facts = JSON.stringify({
      name: 'Maria',
      topics: ['appointment'],
      preferences: ['mornings'],
      sentiment: 'positive',
      pending_needs: [],
      language: 'en',
      preferred_name: null,
      last_appointment_type: null,
      last_appointment_date: null,
    })

    mockGenerateContent
      .mockResolvedValueOnce({ text: call1Facts })
      .mockResolvedValueOnce({ text: 'Caller Maria. Prefers morning appointments.' })

    await runProcessor({ tenantId: TENANT_ID, sessionId: SESSION_1, phone: PHONE })

    // Capture what was written after Call 1
    const memoriesAfterCall1 = (store.tables['caller_memory'] ?? []) as Row[]
    expect(memoriesAfterCall1).toHaveLength(1)
    const call1Memory = memoriesAfterCall1[0]!
    expect(call1Memory['call_count']).toBe(1)

    // ── Call 2 ─────────────────────────────────────────────────────────────────
    // Add the second voice session and reset contacts
    store.tables['voice_sessions'] = [
      ...store.tables['voice_sessions'],
      {
        id: SESSION_2,
        tenant_id: TENANT_ID,
        transcript: 'Hi again, asking about pricing and I prefer Dr. Lee.',
        outcome: 'completed',
        tool_calls_made: null,
      },
    ]

    // caller_memory already has call1Memory — processor should find and merge it
    mockGenerateContent.mockReset()
    const call2Facts = JSON.stringify({
      name: 'Maria',
      topics: ['pricing', 'appointment'],
      preferences: ['Dr. Lee'],
      sentiment: 'neutral',
      pending_needs: [],
      language: 'en',
      preferred_name: null,
      last_appointment_type: null,
      last_appointment_date: null,
    })

    mockGenerateContent.mockResolvedValueOnce({ text: call2Facts }).mockResolvedValueOnce({
      text: 'Returning caller Maria. Asked about pricing and prefers Dr. Lee.',
    })

    await runProcessor({ tenantId: TENANT_ID, sessionId: SESSION_2, phone: PHONE })

    // After Call 2, the store has 2 rows (mock upsert = insert).
    // The second row is the merged result from Call 2.
    const memoriesAfterCall2 = (store.tables['caller_memory'] ?? []) as Row[]
    expect(memoriesAfterCall2).toHaveLength(2)
    const mergedMemory = memoriesAfterCall2[1]!

    // ── Assertions ────────────────────────────────────────────────────────────
    expect(mergedMemory['call_count']).toBe(2)
    expect(mergedMemory['phone']).toBe(PHONE)
    expect(mergedMemory['tenant_id']).toBe(TENANT_ID)

    const facts = mergedMemory['facts'] as Record<string, unknown>

    // name preserved
    expect(facts['name']).toBe('Maria')

    // sentiment from Call 2 wins
    expect(facts['sentiment']).toBe('neutral')

    // topics: union — 'appointment' appears only once, 'pricing' added
    const topics = facts['topics'] as string[]
    const appointmentCount = topics.filter((t) => t.toLowerCase() === 'appointment').length
    expect(appointmentCount).toBe(1)
    expect(topics).toContain('pricing')

    // preferences: both entries present
    const prefs = facts['preferences'] as string[]
    expect(prefs).toContain('mornings')
    expect(prefs).toContain('Dr. Lee')

    // summary reflects Call 2
    expect(String(mergedMemory['summary'] ?? '')).toContain('Dr. Lee')
  })
})
