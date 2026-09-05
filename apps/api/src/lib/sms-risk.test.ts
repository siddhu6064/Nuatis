import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const { updateSmsRiskScore, shouldSuppressSms, getRiskLabel } = await import('./sms-risk.js')

const TENANT_ID = 'tenant-sr-1'
const CONTACT_ID = 'contact-sr-1'

beforeEach(() => {
  store = createStore()
  store.tables['contacts'] = [
    { id: CONTACT_ID, tenant_id: TENANT_ID, sms_risk_score: 0, sms_status: 'ok' },
  ]
})

describe('updateSmsRiskScore', () => {
  it('does nothing for a "sent" event', async () => {
    await updateSmsRiskScore(CONTACT_ID, TENANT_ID, 'sent')
    const contact = (store.tables['contacts'] as Row[])[0]
    expect(contact?.['sms_risk_score']).toBe(0)
    expect(contact?.['sms_status']).toBe('ok')
  })

  it('sets suppressed + score 100 on opted_out', async () => {
    await updateSmsRiskScore(CONTACT_ID, TENANT_ID, 'opted_out')
    const contact = (store.tables['contacts'] as Row[])[0]
    expect(contact?.['sms_risk_score']).toBe(100)
    expect(contact?.['sms_status']).toBe('suppressed')
  })

  it('raises score on failed, tips into suppressed once it crosses threshold', async () => {
    await updateSmsRiskScore(CONTACT_ID, TENANT_ID, 'failed')
    let contact = (store.tables['contacts'] as Row[])[0]
    expect(contact?.['sms_risk_score']).toBe(25)
    expect(contact?.['sms_status']).toBe('at_risk')

    await updateSmsRiskScore(CONTACT_ID, TENANT_ID, 'failed')
    await updateSmsRiskScore(CONTACT_ID, TENANT_ID, 'failed')
    contact = (store.tables['contacts'] as Row[])[0]
    expect(contact?.['sms_risk_score']).toBe(75)
    await updateSmsRiskScore(CONTACT_ID, TENANT_ID, 'failed')
    contact = (store.tables['contacts'] as Row[])[0]
    expect(contact?.['sms_risk_score']).toBe(100)
    expect(contact?.['sms_status']).toBe('suppressed')
  })

  it('decays score toward 0 on delivered and clears at_risk back to ok', async () => {
    store.tables['contacts'] = [
      { id: CONTACT_ID, tenant_id: TENANT_ID, sms_risk_score: 5, sms_status: 'at_risk' },
    ]
    await updateSmsRiskScore(CONTACT_ID, TENANT_ID, 'delivered')
    const contact = (store.tables['contacts'] as Row[])[0]
    expect(contact?.['sms_risk_score']).toBe(0)
    expect(contact?.['sms_status']).toBe('ok')
  })
})

describe('shouldSuppressSms', () => {
  it('is false for a healthy contact', () => {
    expect(shouldSuppressSms({ sms_status: 'ok', sms_risk_score: 0 })).toBe(false)
  })
  it('is true when status is suppressed', () => {
    expect(shouldSuppressSms({ sms_status: 'suppressed', sms_risk_score: 0 })).toBe(true)
  })
  it('is true when score crosses the threshold regardless of status', () => {
    expect(shouldSuppressSms({ sms_status: 'at_risk', sms_risk_score: 90 })).toBe(true)
  })
})

describe('getRiskLabel', () => {
  it('buckets scores into healthy/at_risk/suppressed', () => {
    expect(getRiskLabel(0)).toBe('healthy')
    expect(getRiskLabel(50)).toBe('at_risk')
    expect(getRiskLabel(90)).toBe('suppressed')
  })
})
