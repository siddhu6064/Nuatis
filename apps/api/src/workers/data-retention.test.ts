import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
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

const { scan } = await import('./data-retention-worker.js')

beforeEach(() => {
  store = createStore()
  store.tables['audit_log'] = []
  store.tables['voice_sessions'] = []
  store.tables['push_subscriptions'] = []
})

describe('data-retention scanner', () => {
  it('deletes audit_log rows older than 365 days', async () => {
    const oldRowId = randomUUID()
    const keepRowId = randomUUID()
    store.tables['audit_log']!.push(
      { id: oldRowId, created_at: new Date(Date.now() - 366 * 86400000).toISOString() },
      { id: keepRowId, created_at: new Date(Date.now() - 364 * 86400000).toISOString() }
    )

    await scan()

    const remaining = store.tables['audit_log'] as Row[]
    expect(remaining.find((r) => r['id'] === oldRowId)).toBeUndefined()
    expect(remaining.find((r) => r['id'] === keepRowId)).toBeDefined()
  })

  it('deletes voice_sessions rows older than 180 days', async () => {
    const oldId = randomUUID()
    const keepId = randomUUID()
    store.tables['voice_sessions']!.push(
      { id: oldId, created_at: new Date(Date.now() - 181 * 86400000).toISOString() },
      { id: keepId, created_at: new Date(Date.now() - 179 * 86400000).toISOString() }
    )

    await scan()

    const remaining = store.tables['voice_sessions'] as Row[]
    expect(remaining.find((r) => r['id'] === oldId)).toBeUndefined()
    expect(remaining.find((r) => r['id'] === keepId)).toBeDefined()
  })

  it('deletes push_subscriptions rows older than 90 days', async () => {
    const oldId = randomUUID()
    const keepId = randomUUID()
    store.tables['push_subscriptions']!.push(
      { id: oldId, created_at: new Date(Date.now() - 91 * 86400000).toISOString() },
      { id: keepId, created_at: new Date(Date.now() - 89 * 86400000).toISOString() }
    )

    await scan()

    const remaining = store.tables['push_subscriptions'] as Row[]
    expect(remaining.find((r) => r['id'] === oldId)).toBeUndefined()
    expect(remaining.find((r) => r['id'] === keepId)).toBeDefined()
  })
})
