import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'
import type { MayaMemoryJobData } from './maya-memory-extractor.js'

// ── Mutable store — reset in beforeEach ──────────────────────────────────────
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

// ── BullMQ mock — capture the processor fn ───────────────────────────────────
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

// ── Dynamic imports (after all mocks) ────────────────────────────────────────
const { createMayaMemoryExtractor } = await import('./maya-memory-extractor.js')

// Initialize once — sets capturedProcessor via the mocked Worker constructor
createMayaMemoryExtractor()

// ── Test constants ────────────────────────────────────────────────────────────
const TENANT_ID = 'aaaaaaaa-0000-0000-0000-mem0test0001'
const SESSION_ID = 'ssssssss-0000-0000-0000-mem0test0001'
const PHONE = '+15125550042'

const VALID_FACTS_JSON = JSON.stringify({
  name: 'John',
  topics: ['crown booking'],
  sentiment: 'positive',
  pending_needs: [],
  preferences: [],
  language: 'en',
  preferred_name: null,
  last_appointment_type: 'crown',
  last_appointment_date: null,
})

const SUMMARY_TEXT = 'Returning caller John. Called about crown booking.'

// ── Helper ────────────────────────────────────────────────────────────────────
async function runProcessor(data: MayaMemoryJobData): Promise<void> {
  if (!capturedProcessor)
    throw new Error('processor not captured — was createMayaMemoryExtractor called?')
  await capturedProcessor({ data, id: 'test-job-id' })
}

function seedSession(transcript: string | null, outcome = 'booked'): void {
  store.tables['voice_sessions'] = [
    {
      id: SESSION_ID,
      tenant_id: TENANT_ID,
      transcript,
      outcome,
      tool_calls_made: null,
    },
  ]
}

// ── Tests ─────────────────────────────────────────────────────────────────────
beforeEach(() => {
  store = createStore()
  mockGenerateContent.mockReset()
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

describe('maya-memory-extractor processor', () => {
  it('happy path: extracts facts, generates summary, upserts caller_memory', async () => {
    seedSession('Hi I need to book a crown')
    store.tables['caller_memory'] = [] // no existing memory
    store.tables['contacts'] = []

    // First Gemini call → facts JSON; second call → summary
    mockGenerateContent
      .mockResolvedValueOnce({ text: VALID_FACTS_JSON })
      .mockResolvedValueOnce({ text: SUMMARY_TEXT })

    await runProcessor({ tenantId: TENANT_ID, sessionId: SESSION_ID, phone: PHONE })

    const memories = (store.tables['caller_memory'] ?? []) as Row[]
    expect(memories.length).toBe(1)

    const upserted = memories[0]!
    expect(upserted['phone']).toBe(PHONE)
    expect(upserted['tenant_id']).toBe(TENANT_ID)
    expect(upserted['call_count']).toBe(1)
    expect(String(upserted['summary'] ?? '')).toContain('John')

    // Facts should include the extracted name
    const facts = upserted['facts'] as Record<string, unknown>
    expect(facts['name']).toBe('John')
    expect(facts['topics'] as string[]).toContain('crown booking')
  })

  it('no transcript: exits early without calling Gemini or upserting', async () => {
    seedSession(null, 'missed')
    store.tables['caller_memory'] = []

    await runProcessor({ tenantId: TENANT_ID, sessionId: SESSION_ID, phone: PHONE })

    expect(mockGenerateContent).not.toHaveBeenCalled()
    const memories = (store.tables['caller_memory'] ?? []) as Row[]
    expect(memories.length).toBe(0)
  })

  it('invalid Gemini JSON: worker does not throw and upsert is skipped', async () => {
    seedSession('Some caller transcript')
    store.tables['caller_memory'] = []
    store.tables['contacts'] = []

    mockGenerateContent.mockResolvedValueOnce({ text: 'NOT VALID JSON {{{' })

    await expect(
      runProcessor({ tenantId: TENANT_ID, sessionId: SESSION_ID, phone: PHONE })
    ).resolves.not.toThrow()

    const memories = (store.tables['caller_memory'] ?? []) as Row[]
    expect(memories.length).toBe(0)
  })
})
