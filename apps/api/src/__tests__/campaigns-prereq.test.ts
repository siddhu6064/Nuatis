import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'

// ── Env ───────────────────────────────────────────────────────────────────────
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

// ── Supabase mock ─────────────────────────────────────────────────────────────
let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

// ── Dynamic import (after mocks) ──────────────────────────────────────────────
const { getPrereqChecks } = await import('../routes/campaigns-prereq.js')

// ── Helpers ───────────────────────────────────────────────────────────────────
const TENANT = 'tenant-1'
const NOW = new Date().toISOString()

function makeEmailRows(deliveredCount: number, sentCount: number, bouncedHardCount: number) {
  const rows = []
  for (let i = 0; i < deliveredCount; i++) {
    rows.push({ id: `d-${i}`, tenant_id: TENANT, event_type: 'delivered', created_at: NOW })
  }
  for (let i = 0; i < sentCount; i++) {
    rows.push({ id: `s-${i}`, tenant_id: TENANT, event_type: 'sent', created_at: NOW })
  }
  for (let i = 0; i < bouncedHardCount; i++) {
    rows.push({ id: `b-${i}`, tenant_id: TENANT, event_type: 'bounced_hard', created_at: NOW })
  }
  return rows
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('getPrereqChecks', () => {
  beforeEach(() => {
    store = createStore()
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  // ── Test 1: All checks pass → ready: true ─────────────────────────────────

  it('returns ready:true when all checks pass', async () => {
    store.tables['smart_lists'] = [
      { id: 'sl-1', tenant_id: TENANT },
      { id: 'sl-2', tenant_id: TENANT },
      { id: 'sl-3', tenant_id: TENANT },
    ]
    store.tables['contacts'] = Array.from({ length: 15 }, (_, i) => ({
      id: `c-${i}`,
      tenant_id: TENANT,
    }))
    store.tables['tenants'] = [{ id: TENANT, brand_voice: 'We are a friendly, modern brand.' }]
    store.tables['email_events'] = makeEmailRows(100, 100, 0)
    store.tables['sms_messages'] = Array.from({ length: 5 }, (_, i) => ({
      id: `sms-${i}`,
      tenant_id: TENANT,
      direction: 'outbound',
      created_at: NOW,
    }))

    const result = await getPrereqChecks(TENANT)

    expect(result.ready).toBe(true)
    for (const check of result.checks) {
      expect(check.status).toBe('pass')
    }
  })

  // ── Test 2: No smart lists → ready: false, smart_lists 'fail' ─────────────

  it('returns ready:false and smart_lists fail when there are no smart lists', async () => {
    store.tables['smart_lists'] = []
    store.tables['contacts'] = Array.from({ length: 20 }, (_, i) => ({
      id: `c-${i}`,
      tenant_id: TENANT,
    }))
    store.tables['tenants'] = [{ id: TENANT, brand_voice: 'Some voice' }]
    store.tables['email_events'] = makeEmailRows(100, 100, 0)
    store.tables['sms_messages'] = [
      { id: 'sms-1', tenant_id: TENANT, direction: 'outbound', created_at: NOW },
    ]

    const result = await getPrereqChecks(TENANT)

    expect(result.ready).toBe(false)
    const smartListsCheck = result.checks.find((c) => c.key === 'smart_lists')
    expect(smartListsCheck?.status).toBe('fail')
  })

  // ── Test 3: contacts count 5 → contacts 'warning', ready false ────────────

  it('returns ready:false and contacts warning when contacts count is between 1 and 9', async () => {
    store.tables['smart_lists'] = [
      { id: 'sl-1', tenant_id: TENANT },
      { id: 'sl-2', tenant_id: TENANT },
    ]
    store.tables['contacts'] = Array.from({ length: 5 }, (_, i) => ({
      id: `c-${i}`,
      tenant_id: TENANT,
    }))
    store.tables['tenants'] = [{ id: TENANT, brand_voice: 'Some voice' }]
    store.tables['email_events'] = makeEmailRows(100, 100, 0)
    store.tables['sms_messages'] = [
      { id: 'sms-1', tenant_id: TENANT, direction: 'outbound', created_at: NOW },
    ]

    const result = await getPrereqChecks(TENANT)

    expect(result.ready).toBe(false)
    const contactsCheck = result.checks.find((c) => c.key === 'contacts')
    expect(contactsCheck?.status).toBe('warning')
  })

  // ── Test 4: Hard bounce rate >5% → email_health 'fail', ready false ────────

  it('returns ready:false and email_health fail when hard bounce rate exceeds 5%', async () => {
    store.tables['smart_lists'] = [
      { id: 'sl-1', tenant_id: TENANT },
      { id: 'sl-2', tenant_id: TENANT },
    ]
    store.tables['contacts'] = Array.from({ length: 15 }, (_, i) => ({
      id: `c-${i}`,
      tenant_id: TENANT,
    }))
    store.tables['tenants'] = [{ id: TENANT, brand_voice: 'Some voice' }]
    // 90 delivered / 100 sent / 10 bounced_hard → bounce rate = 10% > 5%
    store.tables['email_events'] = makeEmailRows(90, 100, 10)
    store.tables['sms_messages'] = [
      { id: 'sms-1', tenant_id: TENANT, direction: 'outbound', created_at: NOW },
    ]

    const result = await getPrereqChecks(TENANT)

    const emailHealthCheck = result.checks.find((c) => c.key === 'email_health')
    expect(emailHealthCheck?.status).toBe('fail')
    expect(result.ready).toBe(false)
  })

  // ── Test 5: brand_voice null → brand_voice 'warning', ready still true ─────

  it('returns ready:true with brand_voice warning when brand_voice is null', async () => {
    store.tables['smart_lists'] = [{ id: 'sl-1', tenant_id: TENANT }]
    store.tables['contacts'] = Array.from({ length: 10 }, (_, i) => ({
      id: `c-${i}`,
      tenant_id: TENANT,
    }))
    // brand_voice is null — should produce a warning but not block readiness
    store.tables['tenants'] = [{ id: TENANT, brand_voice: null }]
    // 98 delivered / 100 sent / 0 bounced → delivery rate 98% ≥ 95% → 'pass'
    store.tables['email_events'] = makeEmailRows(98, 100, 0)
    store.tables['sms_messages'] = [
      { id: 'sms-1', tenant_id: TENANT, direction: 'outbound', created_at: NOW },
    ]

    const result = await getPrereqChecks(TENANT)

    const brandVoiceCheck = result.checks.find((c) => c.key === 'brand_voice')
    expect(brandVoiceCheck?.status).toBe('warning')
    expect(result.ready).toBe(true)
  })
})
