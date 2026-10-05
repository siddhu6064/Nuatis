import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()
jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const { whoIsOnCallAt } = await import('./oncall.js')

const AT = new Date('2026-09-15T12:00:00.000Z')

function shift(overrides: Record<string, unknown> = {}) {
  return {
    id: `s-${Math.random().toString(36).slice(2, 8)}`,
    user_id: 'user-dana',
    starts_at: '2026-09-15T09:00:00.000Z',
    ends_at: '2026-09-15T17:00:00.000Z',
    is_override: false,
    ...overrides,
  }
}

beforeEach(() => {
  store = createStore()
  store.tables['platform_oncall_shifts'] = []
})

describe('whoIsOnCallAt', () => {
  it('returns the person whose shift covers the instant', async () => {
    store.tables['platform_oncall_shifts'] = [shift()]
    expect(await whoIsOnCallAt(AT)).toBe('user-dana')
  })

  it('returns null when nobody is on call', async () => {
    // Deliberately not "fall back to anyone". A wrong name on an incident is
    // worse than an empty field: it looks owned, so nobody picks it up.
    expect(await whoIsOnCallAt(AT)).toBeNull()
  })

  it('treats the shift as half-open — the end instant belongs to the next shift', async () => {
    store.tables['platform_oncall_shifts'] = [
      shift({
        user_id: 'user-early',
        starts_at: '2026-09-15T04:00:00.000Z',
        ends_at: '2026-09-15T12:00:00.000Z',
      }),
    ]
    expect(await whoIsOnCallAt(AT)).toBeNull()
  })

  it('includes the start instant', async () => {
    store.tables['platform_oncall_shifts'] = [
      shift({ starts_at: '2026-09-15T12:00:00.000Z', ends_at: '2026-09-15T20:00:00.000Z' }),
    ]
    expect(await whoIsOnCallAt(AT)).toBe('user-dana')
  })

  it('lets an override win over a regular shift covering the same instant', async () => {
    // Someone swapped out at short notice. The original shift stays on the
    // rota rather than being deleted, so the history still reads correctly.
    store.tables['platform_oncall_shifts'] = [
      shift({ user_id: 'user-dana' }),
      shift({ user_id: 'user-sam', is_override: true }),
    ]
    expect(await whoIsOnCallAt(AT)).toBe('user-sam')
  })

  it('picks the override even when it was added before the regular shift', async () => {
    // Order of rows must not decide who is on call.
    store.tables['platform_oncall_shifts'] = [
      shift({ user_id: 'user-sam', is_override: true }),
      shift({ user_id: 'user-dana' }),
    ]
    expect(await whoIsOnCallAt(AT)).toBe('user-sam')
  })

  it('ignores a shift that has not started yet', async () => {
    store.tables['platform_oncall_shifts'] = [
      shift({ starts_at: '2026-09-15T18:00:00.000Z', ends_at: '2026-09-16T02:00:00.000Z' }),
    ]
    expect(await whoIsOnCallAt(AT)).toBeNull()
  })

  it('does not throw when the rota is unreadable', async () => {
    // Declaring an incident must not fail because the rota query failed.
    await expect(whoIsOnCallAt(AT)).resolves.toBeNull()
  })
})
