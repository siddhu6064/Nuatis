import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'

// ── Env ───────────────────────────────────────────────────────────────────────
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

// ── Mocks ─────────────────────────────────────────────────────────────────────
let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

// ── Dynamic imports ───────────────────────────────────────────────────────────
const { shouldSuppressEmail, getRiskLabel, updateEmailRiskScore } =
  await import('../lib/email-risk.js')

// ── Constants ─────────────────────────────────────────────────────────────────
const CONTACT_ID = 'contact-test-001'
const TENANT_ID = 'tenant-test-001'

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('email-risk', () => {
  beforeEach(() => {
    store = createStore()
  })

  // ── shouldSuppressEmail ──────────────────────────────────────────────────

  it('shouldSuppressEmail returns true for hard_bounce status', () => {
    expect(shouldSuppressEmail({ email_status: 'hard_bounce', email_risk_score: 0 })).toBe(true)
  })

  it('shouldSuppressEmail returns true for email_risk_score >= 90', () => {
    expect(shouldSuppressEmail({ email_status: 'ok', email_risk_score: 90 })).toBe(true)
  })

  it('shouldSuppressEmail returns false for ok status + score 0', () => {
    expect(shouldSuppressEmail({ email_status: 'ok', email_risk_score: 0 })).toBe(false)
  })

  // ── getRiskLabel ──────────────────────────────────────────────────────────

  it('getRiskLabel returns correct label for scores 0, 50, 95', () => {
    expect(getRiskLabel(0)).toBe('healthy')
    expect(getRiskLabel(50)).toBe('at_risk')
    expect(getRiskLabel(95)).toBe('suppressed')
  })

  // ── updateEmailRiskScore ──────────────────────────────────────────────────

  it('updateEmailRiskScore: hard bounce sets score=100 + status=hard_bounce', async () => {
    store.tables['contacts'] = [
      {
        id: CONTACT_ID,
        tenant_id: TENANT_ID,
        email_risk_score: 0,
        email_status: 'ok',
      },
    ]

    await updateEmailRiskScore(CONTACT_ID, TENANT_ID, 'bounced_hard')

    const contact = store.tables['contacts']?.[0]
    expect(contact?.['email_risk_score']).toBe(100)
    expect(contact?.['email_status']).toBe('hard_bounce')
  })

  it('updateEmailRiskScore: soft bounce increments score by 25', async () => {
    store.tables['contacts'] = [
      {
        id: CONTACT_ID,
        tenant_id: TENANT_ID,
        email_risk_score: 20,
        email_status: 'ok',
      },
    ]

    await updateEmailRiskScore(CONTACT_ID, TENANT_ID, 'bounced_soft')

    const contact = store.tables['contacts']?.[0]
    expect(contact?.['email_risk_score']).toBe(45)
    expect(contact?.['email_status']).toBe('soft_bounce')
  })

  it('updateEmailRiskScore: delivered decrements score by 5', async () => {
    store.tables['contacts'] = [
      {
        id: CONTACT_ID,
        tenant_id: TENANT_ID,
        email_risk_score: 30,
        email_status: 'soft_bounce',
      },
    ]

    await updateEmailRiskScore(CONTACT_ID, TENANT_ID, 'delivered')

    const contact = store.tables['contacts']?.[0]
    expect(contact?.['email_risk_score']).toBe(25)
    expect(contact?.['email_status']).toBe('soft_bounce')
  })
})
