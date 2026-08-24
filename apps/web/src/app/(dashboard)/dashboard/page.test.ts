import type { ReactElement } from 'react'

// Server Component — no auth/DB backend to hit in a unit test, so the
// modules it imports via the '@/*' alias are mocked as virtual (jest has
// no moduleNameMapper for '@/*'; virtual mocks don't need the real path to
// resolve). DashboardClient is mocked too so importing it never pulls in
// its full client-side tree (@hello-pangea/dnd, nested dashboard widgets)
// — this test only checks the data page.tsx computes, not how it renders.
//
// @nuatis/shared is mocked rather than imported for real: its package.json
// "exports" map has no "require" condition (ESM-only dist build), which
// apps/web's CJS-mode Jest can't resolve — a pre-existing gap unrelated to
// this fix. Mocking sidesteps it; a fixed window (not the real tz math)
// keeps the fixture data simple and deterministic.
const mockAuth = jest.fn()
const mockCreateAdminClient = jest.fn()

const WINDOW_START = '2026-08-24T05:00:00.000Z' // midnight America/Chicago (CDT)
const WINDOW_END = '2026-08-25T05:00:00.000Z'

jest.mock('@/lib/auth/authjs', () => ({ auth: mockAuth }), { virtual: true })
jest.mock('@/lib/supabase/server', () => ({ createAdminClient: mockCreateAdminClient }), {
  virtual: true,
})
jest.mock(
  '@nuatis/shared',
  () => ({
    getFirstName: (name: string | null | undefined) => name ?? 'there',
    resolveTenantTimezone: jest.fn().mockResolvedValue('America/Chicago'),
    tenantDayBoundsUTC: () => ({ startUTC: WINDOW_START, endUTC: WINDOW_END }),
  }),
  { virtual: true }
)
jest.mock('./DashboardClient', () => ({
  __esModule: true,
  default: () => null,
}))

const TENANT_ID = 'tenant-dash-01'

interface Row {
  [key: string]: unknown
}

/** Minimal fluent Supabase-query stand-in: filters an in-memory row array as
 *  each builder method is called, resolving (via `then`) to the same
 *  {data, count, error} shape the real client returns. Faithful enough for
 *  eq/neq/not(is null)/gte/lt/maybeSingle — the only methods this page uses. */
function createQuery(rows: Row[]) {
  let filtered = rows
  const builder = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      filtered = filtered.filter((r) => r[col] === val)
      return builder
    },
    neq: (col: string, val: unknown) => {
      filtered = filtered.filter((r) => r[col] !== val)
      return builder
    },
    not: (col: string, _op: string, _val: unknown) => {
      filtered = filtered.filter((r) => r[col] !== null && r[col] !== undefined)
      return builder
    },
    gte: (col: string, val: string) => {
      filtered = filtered.filter((r) => String(r[col]) >= val)
      return builder
    },
    lt: (col: string, val: string) => {
      filtered = filtered.filter((r) => String(r[col]) < val)
      return builder
    },
    maybeSingle: async () => ({ data: filtered[0] ?? null, error: null }),
    then: (resolve: (v: { data: Row[]; count: number; error: null }) => void) =>
      resolve({ data: filtered, count: filtered.length, error: null }),
  }
  return builder
}

function makeSupabase(tables: Record<string, Row[]>) {
  return { from: (table: string) => createQuery(tables[table] ?? []) }
}

beforeEach(() => {
  mockAuth.mockReset()
  mockCreateAdminClient.mockReset()
})

describe('DashboardPage — Calls Handled stat', () => {
  it('counts voice_sessions in the tenant-local window, excluding abandoned', async () => {
    mockAuth.mockResolvedValue({ user: { tenantId: TENANT_ID, name: 'Sid Test' } })

    const insideWindow = new Date(new Date(WINDOW_START).getTime() + 60 * 60 * 1000).toISOString() // +1h
    const beforeWindow = new Date(new Date(WINDOW_START).getTime() - 60 * 60 * 1000).toISOString() // -1h

    mockCreateAdminClient.mockReturnValue(
      makeSupabase({
        contacts: [],
        appointments: [],
        voice_sessions: [
          { tenant_id: TENANT_ID, outcome: 'booking_made', started_at: insideWindow },
          { tenant_id: TENANT_ID, outcome: 'escalated', started_at: insideWindow },
          { tenant_id: TENANT_ID, outcome: 'inquiry_answered', started_at: insideWindow },
          { tenant_id: TENANT_ID, outcome: 'abandoned', started_at: insideWindow },
          // Outside the tenant-local window — must not be counted even
          // though its outcome would otherwise qualify.
          { tenant_id: TENANT_ID, outcome: 'booking_made', started_at: beforeWindow },
        ],
      })
    )

    const { default: DashboardPage } = await import('./page')
    const element = (await DashboardPage()) as ReactElement
    const stats = (element.props as { stats: Array<{ label: string; value: string }> }).stats
    const callsHandled = stats.find((s) => s.label === 'Calls Handled')

    expect(callsHandled?.value).toBe('3')
  })
})
