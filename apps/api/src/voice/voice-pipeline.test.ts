/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'

// ── Farewell phrase list (mirrored from gemini-live.ts for isolated testing) ─

const FAREWELL_PHRASES = [
  'bye',
  'goodbye',
  'have a great day',
  'have a good day',
  'thank you, bye',
  'thanks, bye',
  'talk to you soon',
  'take care',
  'సెలవు',
  'బై',
  'ధన్యవాదాలు',
  'వీడ్కోలు',
  'अलविदा',
  'बाय',
  'धन्यवाद',
  'नमस्ते',
  'adiós',
  'adios',
  'hasta luego',
  'hasta pronto',
]

function testContainsFarewell(text: string): boolean {
  const lower = text.toLowerCase()
  return FAREWELL_PHRASES.some((phrase) => lower.includes(phrase))
}

// ── ESM-compatible mocks (jest.unstable_mockModule + dynamic imports) ────────

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () =>
            Promise.resolve(
              (globalThis as any).__supabaseMockResult ?? { data: null, error: null }
            ),
        }),
      }),
    }),
  }),
}))

jest.unstable_mockModule('./gemini-live.js', () => ({
  createGeminiLiveSession: () => Promise.resolve((globalThis as any).__mockGeminiSession),
}))

jest.unstable_mockModule('./call-logger.js', () => ({
  logCall: () => {},
}))

jest.unstable_mockModule('../lib/ops-copilot-client.js', () => ({
  publishActivityEvent: () => Promise.resolve(),
}))

// Dynamic imports — must come AFTER unstable_mockModule calls
const {
  pcmuToLinear16,
  linear16ToPcmu,
  getTenantConfig,
  prewarmGemini,
  rekeyPrewarmedSession,
  prewarmedSessions,
} = await import('./telnyx-handler.js')

const { VERTICALS } = await import('@nuatis/shared')

// ── Setup / teardown ─────────────────────────────────────────────────────────

let mockGeminiSession: Record<string, jest.Mock>

beforeEach(() => {
  jest.clearAllMocks()
  prewarmedSessions.clear()

  mockGeminiSession = {
    send: jest.fn(),
    onAudio: jest.fn(),
    onTurnComplete: jest.fn(),
    onSetupComplete: jest.fn().mockImplementation((cb: any) => cb()),
    sendGreeting: jest.fn(),
    sendText: jest.fn(),
    close: jest.fn(),
    onClose: jest.fn(),
  }
  ;(globalThis as any).__mockGeminiSession = mockGeminiSession
  ;(globalThis as any).__supabaseMockResult = { data: null, error: null }

  process.env['SUPABASE_URL'] = 'https://test.supabase.co'
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'test-key'
  process.env['GEMINI_API_KEY'] = 'test-gemini-key'
  process.env['TELNYX_TENANT_MAP'] = '+15551234567:tenant-abc'
})

afterEach(() => {
  delete process.env['SUPABASE_URL']
  delete process.env['SUPABASE_SERVICE_ROLE_KEY']
  delete process.env['GEMINI_API_KEY']
  delete process.env['TELNYX_TENANT_MAP']
  delete (globalThis as any).__mockGeminiSession
  delete (globalThis as any).__supabaseMockResult
})

// ── Test Group 1: Tenant Config Resolution ───────────────────────────────────

describe('Tenant Config Resolution', () => {
  it('resolves tenant config by phone number', async () => {
    ;(globalThis as any).__supabaseMockResult = {
      data: { name: 'Acme Dental', vertical: 'dental' },
      error: null,
    }

    const config = await getTenantConfig('tenant-abc')

    expect(config).toEqual({
      businessName: 'Acme Dental',
      vertical: 'dental',
      product: 'suite',
    })
  })

  it('falls back gracefully when tenant not found', async () => {
    ;(globalThis as any).__supabaseMockResult = {
      data: null,
      error: { message: 'not found' },
    }

    const config = await getTenantConfig('nonexistent-id')

    expect(config).toEqual({
      businessName: 'the business',
      vertical: 'sales_crm',
      product: 'suite',
    })
  })
})

// ── Test Group 2: Gemini Session Setup ───────────────────────────────────────

describe('Gemini Session Setup', () => {
  it('builds system prompt with business name and vertical template', () => {
    const salesTemplate = VERTICALS['sales_crm']?.system_prompt_template ?? ''
    expect(salesTemplate).toContain('{{business_name}}')

    const interpolated = salesTemplate.replace(/\{\{business_name\}\}/g, 'Acme Corp')
    expect(interpolated).toContain('Acme Corp')
    expect(interpolated).not.toContain('{{business_name}}')
  })

  it('uses fallback prompt when business name is null', () => {
    const template = '{{business_name}} welcomes you'

    // Simulate the fallback logic from gemini-live.ts:
    //   businessName ?? 'our office'
    const nullName: string | undefined = undefined
    const result = template.replace(/\{\{business_name\}\}/g, nullName ?? 'our office')
    expect(result).toBe('our office welcomes you')

    const emptyName = ''
    const result2 = template.replace(/\{\{business_name\}\}/g, emptyName || 'our office')
    expect(result2).toBe('our office welcomes you')
  })
})

// ── Test Group 3: Audio Codec Pipeline ───────────────────────────────────────

describe('Audio Codec Pipeline', () => {
  it('pcmuToLinear16 → linear16ToPcmu round-trip preserves buffer length', () => {
    const pcmu = Buffer.alloc(160, 0x7f)
    const pcm16 = pcmuToLinear16(pcmu)
    expect(pcm16.byteLength).toBe(640)

    const pcm24Mock = Buffer.alloc(960, 0)
    const roundTripped = linear16ToPcmu(pcm24Mock)
    expect(roundTripped.byteLength).toBe(160)
  })

  it('handles empty audio buffer without crash', () => {
    const emptyPcmu = pcmuToLinear16(Buffer.alloc(0))
    expect(emptyPcmu.byteLength).toBe(0)
    expect(Buffer.isBuffer(emptyPcmu)).toBe(true)

    const emptyPcm = linear16ToPcmu(Buffer.alloc(0))
    expect(emptyPcm.byteLength).toBe(0)
    expect(Buffer.isBuffer(emptyPcm)).toBe(true)
  })
})

// ── Test Group 4: Pre-warm Lifecycle ─────────────────────────────────────────

describe('Pre-warm Lifecycle', () => {
  beforeEach(() => {
    jest.useFakeTimers()
    ;(globalThis as any).__supabaseMockResult = {
      data: { name: 'Test Biz', vertical: 'sales_crm' },
      error: null,
    }
  })

  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('prewarm session is stored and retrievable by callControlId', async () => {
    await prewarmGemini('call-ctrl-001', '+15551234567')

    expect(prewarmedSessions.has('call-ctrl-001')).toBe(true)
    const entry = prewarmedSessions.get('call-ctrl-001')!
    expect(entry.session).toBe(mockGeminiSession)
    expect(entry.callControlId).toBe('call-ctrl-001')
  })

  it('rekeyPrewarmedSession moves session from callControlId to streamId', async () => {
    await prewarmGemini('call-ctrl-002', '+15551234567')
    expect(prewarmedSessions.has('call-ctrl-002')).toBe(true)

    rekeyPrewarmedSession('call-ctrl-002', 'stream-xyz')

    expect(prewarmedSessions.has('call-ctrl-002')).toBe(false)
    expect(prewarmedSessions.has('stream-xyz')).toBe(true)
    const entry = prewarmedSessions.get('stream-xyz')!
    expect(entry.session).toBe(mockGeminiSession)
  })

  it('unclaimed session is cleaned up after timeout', async () => {
    await prewarmGemini('call-ctrl-003', '+15551234567')
    expect(prewarmedSessions.has('call-ctrl-003')).toBe(true)

    jest.advanceTimersByTime(31_000)

    expect(prewarmedSessions.has('call-ctrl-003')).toBe(false)
    expect(mockGeminiSession.close).toHaveBeenCalled()
  })
})

// ── Test Group 5: Farewell Detection ─────────────────────────────────────────

describe('Farewell Detection', () => {
  it('detects farewell phrases in transcript', () => {
    expect(testContainsFarewell('goodbye')).toBe(true)
    expect(testContainsFarewell('Goodbye!')).toBe(true)
    expect(testContainsFarewell('Okay, take care!')).toBe(true)
    expect(testContainsFarewell('thanks, bye')).toBe(true)
    expect(testContainsFarewell('Thank you, bye')).toBe(true)
    expect(testContainsFarewell('have a great day')).toBe(true)
    expect(testContainsFarewell('talk to you soon')).toBe(true)
  })

  it('does not trigger on non-farewell phrases', () => {
    expect(testContainsFarewell('I need help')).toBe(false)
    expect(testContainsFarewell('what time is my appointment')).toBe(false)
    expect(testContainsFarewell('can you schedule a meeting')).toBe(false)
    expect(testContainsFarewell('hello, how are you')).toBe(false)
    expect(testContainsFarewell('I have a question about my bill')).toBe(false)
  })
})
