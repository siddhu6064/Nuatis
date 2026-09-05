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

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/notifications.js', () => ({ notifyOwner }))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000sa0001'
const STAFF_ID = 'bbbbbbbb-0000-0000-0000-000000sa0001'
const { scan } = await import('./stale-approval-scanner.js')

const hoursAgo = (h: number) => new Date(Date.now() - h * 3600000).toISOString()

beforeEach(() => {
  store = createStore()
  store.tables['time_off_requests'] = []
  store.tables['staff_members'] = [{ id: STAFF_ID, name: 'Jordan Lee' }]
  store.tables['expenses'] = []
  notifyOwner.mockClear()
})

describe('stale-approval-scanner: time off requests', () => {
  it('nudges the owner when a request has been pending past 48h', async () => {
    store.tables['time_off_requests']!.push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      staff_id: STAFF_ID,
      start_date: '2026-10-01',
      end_date: '2026-10-03',
      status: 'pending',
      created_at: hoursAgo(72),
      last_reminder_sent_at: null,
    })

    await scan()

    expect(notifyOwner).toHaveBeenCalledTimes(1)
    const [tenantId, eventKey, payload] = notifyOwner.mock.calls[0]!
    expect(tenantId).toBe(TENANT_ID)
    expect(eventKey).toBe('time_off_requested')
    expect((payload as { pushBody: string }).pushBody).toContain('Jordan Lee')

    const row = (store.tables['time_off_requests'] as Row[])[0]!
    expect(row['last_reminder_sent_at']).not.toBeNull()
  })

  it('does not nudge a request younger than 48h', async () => {
    store.tables['time_off_requests']!.push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      staff_id: STAFF_ID,
      start_date: '2026-10-01',
      end_date: '2026-10-03',
      status: 'pending',
      created_at: hoursAgo(2),
      last_reminder_sent_at: null,
    })

    await scan()

    expect(notifyOwner).not.toHaveBeenCalled()
  })

  it('respects the 24h cooldown on the reminder itself', async () => {
    store.tables['time_off_requests']!.push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      staff_id: STAFF_ID,
      start_date: '2026-10-01',
      end_date: '2026-10-03',
      status: 'pending',
      created_at: hoursAgo(72),
      last_reminder_sent_at: hoursAgo(2),
    })

    await scan()

    expect(notifyOwner).not.toHaveBeenCalled()
  })

  it('ignores an already-approved request', async () => {
    store.tables['time_off_requests']!.push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      staff_id: STAFF_ID,
      start_date: '2026-10-01',
      end_date: '2026-10-03',
      status: 'approved',
      created_at: hoursAgo(72),
      last_reminder_sent_at: null,
    })

    await scan()

    expect(notifyOwner).not.toHaveBeenCalled()
  })
})

describe('stale-approval-scanner: expense approvals', () => {
  it('nudges the owner when an expense has been pending past 48h', async () => {
    store.tables['expenses']!.push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      expense_number: 'EXP-0042',
      amount: 125.5,
      approval_status: 'pending',
      created_at: hoursAgo(72),
      last_reminder_sent_at: null,
    })

    await scan()

    expect(notifyOwner).toHaveBeenCalledTimes(1)
    const [, eventKey, payload] = notifyOwner.mock.calls[0]!
    expect(eventKey).toBe('expense_pending_approval')
    expect((payload as { pushBody: string }).pushBody).toContain('EXP-0042')

    const row = (store.tables['expenses'] as Row[])[0]!
    expect(row['last_reminder_sent_at']).not.toBeNull()
  })

  it('does not nudge an already-approved expense', async () => {
    store.tables['expenses']!.push({
      id: randomUUID(),
      tenant_id: TENANT_ID,
      expense_number: 'EXP-0043',
      amount: 50,
      approval_status: null,
      created_at: hoursAgo(72),
      last_reminder_sent_at: null,
    })

    await scan()

    expect(notifyOwner).not.toHaveBeenCalled()
  })
})
