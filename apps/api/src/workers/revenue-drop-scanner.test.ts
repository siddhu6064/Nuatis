import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()
const notifyOwner = jest.fn(async () => undefined)
const logActivity = jest.fn(async () => undefined)

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/notifications.js', () => ({ notifyOwner }))
jest.unstable_mockModule('../lib/activity.js', () => ({ logActivity }))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000rd0001'
const { scan } = await import('./revenue-drop-scanner.js')

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString()
}

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = []
  store.tables['quote_payments'] = []
  notifyOwner.mockClear()
  logActivity.mockClear()
})

describe('revenue-drop-scanner processor', () => {
  it('alerts when this week is down 40%+ vs a prior week over the $200 floor', async () => {
    store.tables['tenants']!.push({
      id: TENANT_ID,
      modules: { crm: true },
      revenue_alert_last_sent_at: null,
    })
    store.tables['quote_payments'] = [
      { id: randomUUID(), tenant_id: TENANT_ID, amount: 500, recorded_at: daysAgo(10) },
      { id: randomUUID(), tenant_id: TENANT_ID, amount: 100, recorded_at: daysAgo(3) },
    ]

    await scan()

    expect(notifyOwner).toHaveBeenCalledTimes(1)
    const [, eventKey] = notifyOwner.mock.calls[0]!
    expect(eventKey).toBe('revenue_drop_alert')
    const tenant = (store.tables['tenants'] as Row[])[0]!
    expect(tenant['revenue_alert_last_sent_at']).toBeTruthy()
  })

  it('does not alert when the prior week is under the $200 noise floor', async () => {
    store.tables['tenants']!.push({
      id: TENANT_ID,
      modules: { crm: true },
      revenue_alert_last_sent_at: null,
    })
    store.tables['quote_payments'] = [
      { id: randomUUID(), tenant_id: TENANT_ID, amount: 50, recorded_at: daysAgo(10) },
    ]

    await scan()

    expect(notifyOwner).not.toHaveBeenCalled()
  })

  it('does not alert when revenue held steady or grew', async () => {
    store.tables['tenants']!.push({
      id: TENANT_ID,
      modules: { crm: true },
      revenue_alert_last_sent_at: null,
    })
    store.tables['quote_payments'] = [
      { id: randomUUID(), tenant_id: TENANT_ID, amount: 500, recorded_at: daysAgo(10) },
      { id: randomUUID(), tenant_id: TENANT_ID, amount: 600, recorded_at: daysAgo(3) },
    ]

    await scan()

    expect(notifyOwner).not.toHaveBeenCalled()
  })

  it('does not alert within the 7-day cooldown', async () => {
    store.tables['tenants']!.push({
      id: TENANT_ID,
      modules: { crm: true },
      revenue_alert_last_sent_at: daysAgo(2),
    })
    store.tables['quote_payments'] = [
      { id: randomUUID(), tenant_id: TENANT_ID, amount: 500, recorded_at: daysAgo(10) },
      { id: randomUUID(), tenant_id: TENANT_ID, amount: 100, recorded_at: daysAgo(3) },
    ]

    await scan()

    expect(notifyOwner).not.toHaveBeenCalled()
  })

  it('does not alert for a tenant with modules.crm=false', async () => {
    store.tables['tenants']!.push({
      id: TENANT_ID,
      modules: { crm: false },
      revenue_alert_last_sent_at: null,
    })
    store.tables['quote_payments'] = [
      { id: randomUUID(), tenant_id: TENANT_ID, amount: 500, recorded_at: daysAgo(10) },
      { id: randomUUID(), tenant_id: TENANT_ID, amount: 100, recorded_at: daysAgo(3) },
    ]

    await scan()

    expect(notifyOwner).not.toHaveBeenCalled()
  })
})
