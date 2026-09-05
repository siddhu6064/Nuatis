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

const { getAvailableSlotsForDate, isSlotAvailable } = await import('./booking-availability.js')

const TENANT_ID = 'tenant-ba-001'

// A Monday, so DEFAULT_HOURS resolves to 9am-5pm.
const DATE = '2026-06-01'

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [{ id: TENANT_ID, booking_buffer_minutes: 0, booking_advance_days: 60 }]
  store.tables['appointments'] = []
})

const nativeCreds = {
  provider: 'native' as const,
  tenantId: TENANT_ID,
  refreshToken: '',
  calendarId: '',
  timezone: 'America/Chicago',
}

describe('getAvailableSlotsForDate — native provider, staff scoping', () => {
  it('excludes a slot only for the staff member who is already booked in it', async () => {
    ;(store.tables['appointments'] as Row[]).push({
      id: 'appt-1',
      tenant_id: TENANT_ID,
      assigned_staff_id: 'staff-A',
      status: 'scheduled',
      start_time: '2026-06-01T15:00:00.000Z', // 10am America/Chicago
      end_time: '2026-06-01T16:00:00.000Z',
    })

    const forStaffA = await getAvailableSlotsForDate(nativeCreds, DATE, 60, 0, 'staff-A')
    expect(forStaffA.slots.some((s) => s.start === '10:00')).toBe(false)

    const forStaffB = await getAvailableSlotsForDate(nativeCreds, DATE, 60, 0, 'staff-B')
    expect(forStaffB.slots.some((s) => s.start === '10:00')).toBe(true)

    // No staffId — tenant-wide check still sees every appointment as busy.
    const tenantWide = await getAvailableSlotsForDate(nativeCreds, DATE, 60, 0)
    expect(tenantWide.slots.some((s) => s.start === '10:00')).toBe(false)
  })
})

describe('isSlotAvailable — native provider, staff scoping', () => {
  it('is unavailable for the booked staff member but available for another', async () => {
    ;(store.tables['appointments'] as Row[]).push({
      id: 'appt-1',
      tenant_id: TENANT_ID,
      assigned_staff_id: 'staff-A',
      status: 'scheduled',
      start_time: '2026-06-01T15:00:00.000Z',
      end_time: '2026-06-01T16:00:00.000Z',
    })

    expect(await isSlotAvailable(nativeCreds, DATE, '10:00', 60, 'staff-A')).toBe(false)
    expect(await isSlotAvailable(nativeCreds, DATE, '10:00', 60, 'staff-B')).toBe(true)
  })
})
