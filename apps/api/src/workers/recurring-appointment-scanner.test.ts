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

const { scanRecurringAppointments } = await import('./recurring-appointment-scanner.js')

const TENANT_ID = 'tenant-1'
const CONTACT_ID = 'contact-1'
const now = new Date()
const TODAY_DOW = now.getDay()
const TODAY_DOM = now.getDate()

beforeEach(() => {
  store = createStore()
  store.tables['recurring_appointment_rules'] = []
  store.tables['appointments'] = []
  logActivity.mockClear()
})

describe('scanRecurringAppointments', () => {
  it('generates an appointment for a due weekly rule and stamps last_generated_at', async () => {
    store.tables['recurring_appointment_rules'] = [
      {
        id: 'rule-1',
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        title: 'Weekly checkup',
        description: null,
        location_id: null,
        assigned_staff_id: null,
        duration_minutes: 30,
        frequency: 'weekly',
        day_of_week: TODAY_DOW,
        day_of_month: null,
        start_time: '09:00',
        enabled: true,
        last_generated_at: null,
        deleted_at: null,
      },
    ]

    await scanRecurringAppointments()

    expect(store.tables['appointments']).toHaveLength(1)
    const appt = store.tables['appointments']?.[0]
    expect(appt?.['recurring_rule_id']).toBe('rule-1')
    expect(appt?.['contact_id']).toBe(CONTACT_ID)
    expect(appt?.['title']).toBe('Weekly checkup')

    const rule = store.tables['recurring_appointment_rules']?.[0]
    expect(rule?.['last_generated_at']).toBeTruthy()
    expect(logActivity).toHaveBeenCalledTimes(1)
  })

  it('skips a rule whose day does not match today', async () => {
    const otherDow = (TODAY_DOW + 1) % 7
    store.tables['recurring_appointment_rules'] = [
      {
        id: 'rule-1',
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        title: 'Weekly checkup',
        duration_minutes: 30,
        frequency: 'weekly',
        day_of_week: otherDow,
        day_of_month: null,
        start_time: '09:00',
        enabled: true,
        last_generated_at: null,
        deleted_at: null,
      },
    ]

    await scanRecurringAppointments()

    expect(store.tables['appointments']).toHaveLength(0)
  })

  it('skips a due-by-day rule generated too recently (elapsed-time guard)', async () => {
    store.tables['recurring_appointment_rules'] = [
      {
        id: 'rule-1',
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        title: 'Weekly checkup',
        duration_minutes: 30,
        frequency: 'weekly',
        day_of_week: TODAY_DOW,
        day_of_month: null,
        start_time: '09:00',
        enabled: true,
        last_generated_at: new Date().toISOString(), // generated moments ago
        deleted_at: null,
      },
    ]

    await scanRecurringAppointments()

    expect(store.tables['appointments']).toHaveLength(0)
  })

  it('generates for a due monthly rule', async () => {
    store.tables['recurring_appointment_rules'] = [
      {
        id: 'rule-1',
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        title: 'Monthly review',
        duration_minutes: 60,
        frequency: 'monthly',
        day_of_week: null,
        day_of_month: TODAY_DOM,
        start_time: '14:00',
        enabled: true,
        last_generated_at: null,
        deleted_at: null,
      },
    ]

    await scanRecurringAppointments()

    expect(store.tables['appointments']).toHaveLength(1)
  })

  it('ignores a disabled rule even if the day matches', async () => {
    store.tables['recurring_appointment_rules'] = [
      {
        id: 'rule-1',
        tenant_id: TENANT_ID,
        contact_id: CONTACT_ID,
        title: 'Weekly checkup',
        duration_minutes: 30,
        frequency: 'weekly',
        day_of_week: TODAY_DOW,
        day_of_month: null,
        start_time: '09:00',
        enabled: false,
        last_generated_at: null,
        deleted_at: null,
      },
    ]

    await scanRecurringAppointments()

    expect(store.tables['appointments']).toHaveLength(0)
  })
})
