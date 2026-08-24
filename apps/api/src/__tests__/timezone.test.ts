import { describe, it, expect } from '@jest/globals'
import { randomUUID } from 'node:crypto'
// These utilities live in packages/shared (no Jest runner of its own); the api
// jest config maps '@nuatis/shared' to packages/shared/src so this exercises
// the source directly.
import { toTenantLocal, tenantDayBoundsUTC, resolveTenantTimezone } from '@nuatis/shared'
import { createStore, createMockSupabase } from '../routes/__test-support__/supabase-mock.js'

describe('toTenantLocal', () => {
  it('converts a UTC timestamp to tenant-local time, not the raw UTC hour (regression: 17:00 UTC misread as "5 PM")', () => {
    expect(toTenantLocal('2026-08-24T17:00:00Z', 'America/Chicago')).toBe('12:00 PM')
  })

  it('converts correctly in winter (CST, UTC-6)', () => {
    expect(toTenantLocal('2026-01-15T18:00:00Z', 'America/Chicago')).toBe('12:00 PM')
  })

  it('converts correctly just after a spring-forward DST transition (CDT, UTC-5)', () => {
    // 2026-03-08 08:00 UTC is the instant America/Chicago jumps 2am CST -> 3am CDT.
    expect(toTenantLocal('2026-03-08T08:30:00Z', 'America/Chicago')).toBe('3:30 AM')
  })

  it('accepts a Date instance directly', () => {
    expect(toTenantLocal(new Date('2026-08-24T17:00:00Z'), 'America/Chicago')).toBe('12:00 PM')
  })
})

describe('tenantDayBoundsUTC', () => {
  it('returns bounds exactly 24h apart on an ordinary (non-DST) day', () => {
    const { startUTC, endUTC } = tenantDayBoundsUTC(
      'America/Chicago',
      new Date('2026-01-15T18:00:00Z')
    )
    expect(startUTC).toBe('2026-01-15T06:00:00.000Z') // midnight CST = 06:00 UTC
    expect(endUTC).toBe('2026-01-16T06:00:00.000Z')
    expect(new Date(endUTC).getTime() - new Date(startUTC).getTime()).toBe(24 * 60 * 60 * 1000)
  })

  it('returns a 23h window on the spring-forward DST transition day, not a naive 24h', () => {
    const { startUTC, endUTC } = tenantDayBoundsUTC(
      'America/Chicago',
      new Date('2026-03-08T12:00:00Z') // noon CST on transition day
    )
    expect(startUTC).toBe('2026-03-08T06:00:00.000Z') // midnight CST
    expect(endUTC).toBe('2026-03-09T05:00:00.000Z') // midnight CDT (already sprung forward)
    expect(new Date(endUTC).getTime() - new Date(startUTC).getTime()).toBe(23 * 60 * 60 * 1000)
  })

  it('returns a 25h window on the fall-back DST transition day', () => {
    const { startUTC, endUTC } = tenantDayBoundsUTC(
      'America/Chicago',
      new Date('2026-11-01T12:00:00Z')
    )
    expect(new Date(endUTC).getTime() - new Date(startUTC).getTime()).toBe(25 * 60 * 60 * 1000)
  })
})

describe('resolveTenantTimezone', () => {
  const TENANT_ID = randomUUID()

  it('uses the tenant primary location timezone when present', async () => {
    const store = createStore()
    store.tables['locations'] = [
      { id: randomUUID(), tenant_id: TENANT_ID, is_primary: true, timezone: 'America/New_York' },
    ]
    store.tables['tenants'] = [{ id: TENANT_ID, timezone: 'America/Chicago' }]
    const supabase = createMockSupabase(store)

    expect(await resolveTenantTimezone(supabase, TENANT_ID)).toBe('America/New_York')
  })

  it('falls back to tenants.timezone when the location has no timezone set', async () => {
    const store = createStore()
    store.tables['locations'] = [
      { id: randomUUID(), tenant_id: TENANT_ID, is_primary: true, timezone: null },
    ]
    store.tables['tenants'] = [{ id: TENANT_ID, timezone: 'America/Denver' }]
    const supabase = createMockSupabase(store)

    expect(await resolveTenantTimezone(supabase, TENANT_ID)).toBe('America/Denver')
  })

  it('falls back to America/Chicago when neither location nor tenant has a timezone', async () => {
    const store = createStore()
    store.tables['locations'] = []
    store.tables['tenants'] = [{ id: TENANT_ID }]
    const supabase = createMockSupabase(store)

    expect(await resolveTenantTimezone(supabase, TENANT_ID)).toBe('America/Chicago')
  })

  it('looks up a specific location by id when locationId is given', async () => {
    const store = createStore()
    const otherLocationId = randomUUID()
    store.tables['locations'] = [
      { id: randomUUID(), tenant_id: TENANT_ID, is_primary: true, timezone: 'America/Chicago' },
      { id: otherLocationId, tenant_id: TENANT_ID, is_primary: false, timezone: 'America/Phoenix' },
    ]
    const supabase = createMockSupabase(store)

    expect(await resolveTenantTimezone(supabase, TENANT_ID, otherLocationId)).toBe(
      'America/Phoenix'
    )
  })
})
