import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const getYelpReviews = jest.fn(async () => [
  {
    id: 'r1',
    rating: 5,
    text: 'Great!',
    time_created: '2026-01-01T00:00:00Z',
    user: { name: 'Alice' },
  },
  {
    id: 'r2',
    rating: 3,
    text: 'Okay',
    time_created: '2026-01-02T00:00:00Z',
    user: { name: 'Bob' },
  },
])
jest.unstable_mockModule('./yelp-client.js', () => ({ getYelpReviews }))

const { syncYelpReviews } = await import('./yelp-sync.js')

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000ysy0001'

beforeEach(() => {
  store = createStore()
  store.tables['yelp_connections'] = [
    { tenant_id: TENANT_ID, yelp_business_id: 'biz-1', business_name: 'Test Biz' },
  ]
  store.tables['reviews'] = []
  getYelpReviews.mockClear()
})

describe('syncYelpReviews', () => {
  it('returns synced:0 when no connection exists', async () => {
    store.tables['yelp_connections'] = []
    const result = await syncYelpReviews(TENANT_ID)
    expect(result).toEqual({ synced: 0 })
    expect(getYelpReviews).not.toHaveBeenCalled()
  })

  it('inserts new reviews with the yelp- prefix and source', async () => {
    const result = await syncYelpReviews(TENANT_ID)
    expect(result).toEqual({ synced: 2 })
    const rows = store.tables['reviews'] as Row[]
    expect(rows).toHaveLength(2)
    expect(rows[0]?.['google_review_id']).toBe('yelp-r1')
    expect(rows[0]?.['source']).toBe('yelp')
    expect(rows[0]?.['status']).toBe('new')
  })

  it('does not re-insert or overwrite an already-imported review (insert-only)', async () => {
    store.tables['reviews'] = [
      {
        tenant_id: TENANT_ID,
        google_review_id: 'yelp-r1',
        source: 'yelp',
        rating: 5,
        status: 'replied',
        reply_text: 'Thanks!',
      },
    ]
    const result = await syncYelpReviews(TENANT_ID)
    expect(result).toEqual({ synced: 1 }) // only r2 is new
    const rows = store.tables['reviews'] as Row[]
    const r1 = rows.find((r) => r['google_review_id'] === 'yelp-r1')
    expect(r1?.['status']).toBe('replied') // untouched, not reset to 'new'
  })
})
