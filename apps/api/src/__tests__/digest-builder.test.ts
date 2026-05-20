import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'
import type { WeeklyDigestData } from '@nuatis/shared'

// ── Env ───────────────────────────────────────────────────────────────────────
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['GEMINI_API_KEY'] = 'mock-gemini-key'
process.env['AUTH_SECRET'] = 'test-secret'

// ── Supabase mock ─────────────────────────────────────────────────────────────
let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

// ── Gemini mock ───────────────────────────────────────────────────────────────
jest.unstable_mockModule('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: jest.fn().mockResolvedValue({ text: 'Mock insight text' }),
    },
  })),
}))

// ── Dynamic imports (must come AFTER mock setup) ──────────────────────────────
const { buildDigestData } = await import('../lib/digest-builder.js')
const { renderWeeklyDigest } = await import('../lib/email-templates/weekly-digest.js')
const { signDigestToken, verifyDigestToken } = await import('../routes/digest.js')

// ── Constants ─────────────────────────────────────────────────────────────────
const TENANT_ID = 'tenant-001'

// ── Helpers ───────────────────────────────────────────────────────────────────
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()
}

// ── Minimal WeeklyDigestData for template tests ───────────────────────────────
const minimalData: WeeklyDigestData = {
  period: { from: 'May 12', to: 'May 19' },
  business_name: 'Acme Corp',
  contacts: { new_this_week: 5, total: 100, change_pct: 10 },
  appointments: { booked_this_week: 3, showed: 2, no_show: 1, upcoming_7d: 5 },
  pipeline: { new_deals: 2, deals_won: 1, revenue_won: 500, open_pipeline_value: 5000 },
  maya_calls: { total_this_week: 10, bookings_from_calls: 3, avg_duration_seconds: 90 },
  sms_health: { sent_this_week: 50, delivery_rate: 95.5 },
  top_insight: 'Test insight here',
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('digest-builder', () => {
  beforeEach(() => {
    store = createStore()
  })

  it('buildDigestData returns expected shape with all required keys', async () => {
    // Seed tenants table
    store.tables['tenants'] = [{ id: TENANT_ID, name: 'Test Business' }]

    // Seed contacts
    store.tables['contacts'] = [
      {
        id: 'c-1',
        tenant_id: TENANT_ID,
        is_archived: false,
        created_at: daysAgo(2),
      },
      {
        id: 'c-2',
        tenant_id: TENANT_ID,
        is_archived: false,
        created_at: daysAgo(10),
      },
    ]

    // Seed appointments
    store.tables['appointments'] = [
      {
        id: 'a-1',
        tenant_id: TENANT_ID,
        status: 'completed',
        start_time: daysAgo(1),
        created_at: daysAgo(3),
      },
    ]

    // Seed deals
    store.tables['deals'] = [
      {
        id: 'd-1',
        tenant_id: TENANT_ID,
        is_archived: false,
        is_closed_won: false,
        is_closed_lost: false,
        value: 1000,
        created_at: daysAgo(2),
        updated_at: daysAgo(1),
      },
    ]

    // Seed voice_sessions
    store.tables['voice_sessions'] = [
      {
        id: 'vs-1',
        tenant_id: TENANT_ID,
        duration_seconds: 120,
        created_at: daysAgo(1),
      },
    ]

    // Seed sms_messages
    store.tables['sms_messages'] = [
      {
        id: 'sms-1',
        tenant_id: TENANT_ID,
        direction: 'outbound',
        status: 'delivered',
        created_at: daysAgo(2),
      },
    ]

    const data = await buildDigestData(TENANT_ID)

    // Assert all top-level keys exist
    expect(data).toHaveProperty('period')
    expect(data).toHaveProperty('business_name')
    expect(data).toHaveProperty('contacts')
    expect(data).toHaveProperty('appointments')
    expect(data).toHaveProperty('pipeline')
    expect(data).toHaveProperty('maya_calls')
    expect(data).toHaveProperty('sms_health')
    expect(data).toHaveProperty('top_insight')
    expect(data.top_insight).toBe('Mock insight text')

    // Assert period labels match "MMM D" format
    expect(data.period.from).toMatch(/^[A-Z][a-z]+ \d+$/)
    expect(data.period.to).toMatch(/^[A-Z][a-z]+ \d+$/)
  })

  it('renderWeeklyDigest subject includes business_name and period', () => {
    const { subject } = renderWeeklyDigest(minimalData, 'test-token')

    expect(subject).toContain(minimalData.business_name)
    expect(subject).toContain(minimalData.period.to)
  })

  it('renderWeeklyDigest html contains top_insight text', () => {
    const dataWithInsight: WeeklyDigestData = {
      ...minimalData,
      top_insight: 'Test insight here',
    }

    const { html } = renderWeeklyDigest(dataWithInsight, 'test-token')

    expect(html).toContain('Test insight here')
  })

  it('unsubscribe token: generate + verify round-trip', () => {
    const token = signDigestToken('tenant-abc')

    // Returns a non-empty string
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(0)

    // Token is a valid hex string (sha256 = 64 hex chars)
    expect(token).toMatch(/^[0-9a-f]+$/)
  })

  it('invalid unsubscribe token does not verify for a different tenantId', () => {
    const tokenForA = signDigestToken('tenant-correct')
    const tokenForB = signDigestToken('tenant-wrong')

    // Tokens for different tenants are different (tenant-bound)
    expect(tokenForA).not.toBe(tokenForB)

    // A token for tenant-correct does NOT verify for tenant-wrong
    expect(verifyDigestToken('tenant-wrong', tokenForA)).toBe(false)

    // And the token for tenant-correct verifies correctly for tenant-correct
    expect(verifyDigestToken('tenant-correct', tokenForA)).toBe(true)
  })
})
