import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()
const logActivity = jest.fn(async () => undefined)

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/activity.js', () => ({ logActivity }))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const { scanRecurringTasks } = await import('./recurring-task-scanner.js')

const TENANT_ID = 'tenant-1'
const now = new Date()
const TODAY_DOW = now.getDay()

beforeEach(() => {
  store = createStore()
  store.tables['recurring_task_rules'] = []
  store.tables['tasks'] = []
  logActivity.mockClear()
})

describe('scanRecurringTasks', () => {
  it('generates a task for a due weekly rule', async () => {
    store.tables['recurring_task_rules'] = [
      {
        id: 'rule-1',
        tenant_id: TENANT_ID,
        title: 'Weekly follow-up',
        contact_id: null,
        assigned_to_user_id: null,
        priority: 'medium',
        frequency: 'weekly',
        day_of_week: TODAY_DOW,
        day_of_month: null,
        enabled: true,
        last_generated_at: null,
        deleted_at: null,
      },
    ]

    await scanRecurringTasks()

    expect(store.tables['tasks']).toHaveLength(1)
    expect(store.tables['tasks']?.[0]?.['recurring_rule_id']).toBe('rule-1')
    const rule = store.tables['recurring_task_rules']?.[0]
    expect(rule?.['last_generated_at']).toBeTruthy()
    expect(logActivity).toHaveBeenCalledTimes(1)
  })

  it('skips a rule not due today', async () => {
    store.tables['recurring_task_rules'] = [
      {
        id: 'rule-1',
        tenant_id: TENANT_ID,
        title: 'Weekly follow-up',
        priority: 'medium',
        frequency: 'weekly',
        day_of_week: (TODAY_DOW + 1) % 7,
        day_of_month: null,
        enabled: true,
        last_generated_at: null,
        deleted_at: null,
      },
    ]

    await scanRecurringTasks()

    expect(store.tables['tasks']).toHaveLength(0)
  })
})
