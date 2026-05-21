/* eslint-disable @typescript-eslint/no-explicit-any */
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'

// ── Mutable state shared with mock factories via closure ─────────────────────
// (re-assigned in beforeEach so each test gets a clean slate)
;(globalThis as any).__capturedSystemInstruction = ''
;(globalThis as any).__mockMemoryResult = Promise.resolve({ data: null, error: null })

// ── @google/genai mock ────────────────────────────────────────────────────────
jest.unstable_mockModule('@google/genai', () => ({
  GoogleGenAI: class MockGoogleGenAI {
    live = {
      connect: async (opts: any) => {
        ;(globalThis as any).__capturedSystemInstruction =
          opts?.config?.systemInstruction?.parts?.[0]?.text ?? ''
        return {
          sendToolResponse: () => {},
          sendClientContent: () => {},
          sendRealtimeInput: () => {},
          close: () => {},
        }
      },
    }
  },
  Modality: { AUDIO: 'AUDIO' },
  StartSensitivity: { START_SENSITIVITY_HIGH: 'HIGH' },
  EndSensitivity: { END_SENSITIVITY_HIGH: 'HIGH' },
  ActivityHandling: { START_OF_ACTIVITY_INTERRUPTS: 'INTERRUPTS' },
}))

// ── Supabase mock — chain mirrors gemini-live.ts memory query ────────────────
// from('caller_memory').select(...).eq(...).eq(...).maybeSingle()
jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: () => (globalThis as any).__mockMemoryResult,
          }),
        }),
      }),
    }),
  }),
}))

// ── Stub out dependencies that would need network / disk ─────────────────────
jest.unstable_mockModule('../services/embeddings.js', () => ({
  getAllKnowledgeEntries: () => Promise.resolve([]),
}))

jest.unstable_mockModule('./business-knowledge.js', () => ({
  buildBusinessKnowledgeBlock: () => '',
  buildKbFilesBlock: () => '',
  buildKbUrlsBlock: () => '',
}))

jest.unstable_mockModule('./tool-handlers.js', () => ({
  FUNCTION_DECLARATIONS: [],
  executeToolCall: () => Promise.resolve({}),
}))

jest.unstable_mockModule('../lib/sentry.js', () => ({
  Sentry: { captureException: () => {} },
}))

process.env['GEMINI_API_KEY'] = 'test-gemini-key'
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

// Dynamic import — must come AFTER all unstable_mockModule calls
const { createGeminiLiveSession } = await import('./gemini-live.js')

// ── Helpers ───────────────────────────────────────────────────────────────────
function capturedPrompt(): string {
  return (globalThis as any).__capturedSystemInstruction as string
}

// ── Setup / teardown ──────────────────────────────────────────────────────────
beforeEach(() => {
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  ;(globalThis as any).__capturedSystemInstruction = ''
  ;(globalThis as any).__mockMemoryResult = Promise.resolve({ data: null, error: null })
})

afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createGeminiLiveSession — memory block injection', () => {
  it('injects CALLER CONTEXT block when memory exists for the caller', async () => {
    ;(globalThis as any).__mockMemoryResult = Promise.resolve({
      data: {
        summary: 'Returning caller John. Prefers mornings.',
        call_count: 3,
        facts: {},
      },
      error: null,
    })

    const session = await createGeminiLiveSession(
      'tenant-1',
      'sales_crm',
      'Test Business',
      undefined,
      undefined,
      undefined,
      null,
      undefined,
      null,
      null,
      null,
      '+15125551234'
    )

    expect(session).toBeDefined()
    const prompt = capturedPrompt()
    expect(prompt).toContain('Returning caller John')
    expect(prompt).toContain('CALLER CONTEXT')
    // Memory block must appear before the core prompt body
    const memoryIdx = prompt.indexOf('CALLER CONTEXT')
    const coreIdx = prompt.indexOf('You are Maya')
    expect(memoryIdx).toBeLessThan(coreIdx)
  })

  it('omits CALLER CONTEXT when no memory exists (first-time caller)', async () => {
    ;(globalThis as any).__mockMemoryResult = Promise.resolve({ data: null, error: null })

    const session = await createGeminiLiveSession(
      'tenant-1',
      'sales_crm',
      'Test Business',
      undefined,
      undefined,
      undefined,
      null,
      undefined,
      null,
      null,
      null,
      '+15125559999'
    )

    expect(session).toBeDefined()
    const prompt = capturedPrompt()
    expect(prompt).not.toContain('CALLER CONTEXT')
    expect(prompt.length).toBeGreaterThan(0)
  })

  it('resolves without CALLER CONTEXT when memory lookup times out', async () => {
    jest.useFakeTimers()
    // A promise that never resolves — simulates a hung DB query
    ;(globalThis as any).__mockMemoryResult = new Promise(() => {})

    const sessionPromise = createGeminiLiveSession(
      'tenant-1',
      'sales_crm',
      'Test Business',
      undefined,
      undefined,
      undefined,
      null,
      undefined,
      null,
      null,
      null,
      '+15125550000'
    )

    // Advance past the 2000ms race timeout inside createGeminiLiveSession
    await jest.advanceTimersByTimeAsync(2100)

    const session = await sessionPromise

    expect(session).toBeDefined()
    expect(capturedPrompt()).not.toContain('CALLER CONTEXT')
  })
})
