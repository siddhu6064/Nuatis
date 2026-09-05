import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

/**
 * Regression coverage for a real bug: `proxy.ts` used to mint every API
 * request's JWT with an empty `sub` claim (session.user.id was never
 * populated), so `authed.userId` was always `''` for every real session —
 * and every `logActivity()` call passing that as `actorId` inserted an empty
 * string into a uuid column, which Postgres rejects (22P02). Guards the
 * defense-in-depth fix: an empty string is coerced to null before it reaches
 * a uuid column, instead of passing straight through.
 */

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const { logActivity } = await import('./activity.js')

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000000ac71'

beforeEach(() => {
  store = createStore()
  store.tables['activity_log'] = []
})

describe('logActivity', () => {
  it('coerces an empty-string actorId/contactId/companyId to null', async () => {
    await logActivity({
      tenantId: TENANT_ID,
      contactId: '',
      companyId: '',
      type: 'system',
      body: 'test',
      actorId: '',
    })

    const rows = store.tables['activity_log'] as Row[]
    expect(rows).toHaveLength(1)
    expect(rows[0]?.['actor_id']).toBeNull()
    expect(rows[0]?.['contact_id']).toBeNull()
    expect(rows[0]?.['company_id']).toBeNull()
  })

  it('writes a real actorId through unchanged', async () => {
    await logActivity({
      tenantId: TENANT_ID,
      type: 'system',
      body: 'test',
      actorId: 'bbbbbbbb-1111-1111-1111-111111111111',
    })

    const rows = store.tables['activity_log'] as Row[]
    expect(rows[0]?.['actor_id']).toBe('bbbbbbbb-1111-1111-1111-111111111111')
  })
})
