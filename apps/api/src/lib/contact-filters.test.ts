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

const TENANT_ID = 'tenant-cf-1'

const { applyContactFilters, applyOpenQuotePostFilter } = await import('./contact-filters.js')
const { createClient } = await import('@supabase/supabase-js')

function getSupabase() {
  return createClient('https://mock.supabase.co', 'mock-service-key')
}

beforeEach(() => {
  store = createStore()
  store.tables['contacts'] = [
    {
      id: 'c-1',
      tenant_id: TENANT_ID,
      full_name: 'Referred Rita',
      source: 'referral',
      is_archived: false,
    },
    {
      id: 'c-2',
      tenant_id: TENANT_ID,
      full_name: 'Walkin Wes',
      source: 'walkin',
      is_archived: false,
    },
  ]
  store.tables['quotes'] = []
})

describe('applyContactFilters', () => {
  it('accepts a comma-joined string (query-param shape)', async () => {
    const supabase = getSupabase()
    let query = supabase.from('contacts').select('*').eq('tenant_id', TENANT_ID)
    ;({ query } = await applyContactFilters(query, { source: 'referral' }, supabase, TENANT_ID))
    const { data } = await query
    expect((data as Row[]).map((r) => r['id'])).toEqual(['c-1'])
  })

  it('accepts a real array (saved smart-list JSONB shape)', async () => {
    const supabase = getSupabase()
    let query = supabase.from('contacts').select('*').eq('tenant_id', TENANT_ID)
    ;({ query } = await applyContactFilters(query, { source: ['referral'] }, supabase, TENANT_ID))
    const { data } = await query
    expect((data as Row[]).map((r) => r['id'])).toEqual(['c-1'])
  })

  it('resolves assigned_to: "me" against the requesting user, not literally', async () => {
    store.tables['contacts'] = [
      {
        id: 'c-1',
        tenant_id: TENANT_ID,
        full_name: 'Mine',
        assigned_to_user_id: 'user-42',
        is_archived: false,
      },
      {
        id: 'c-2',
        tenant_id: TENANT_ID,
        full_name: 'Not Mine',
        assigned_to_user_id: 'user-99',
        is_archived: false,
      },
    ]
    const supabase = getSupabase()
    let query = supabase.from('contacts').select('*').eq('tenant_id', TENANT_ID)
    ;({ query } = await applyContactFilters(
      query,
      { assigned_to: 'me' },
      supabase,
      TENANT_ID,
      'user-42'
    ))
    const { data } = await query
    expect((data as Row[]).map((r) => r['id'])).toEqual(['c-1'])
  })

  it('leaves the query unfiltered when no recognized fields are present', async () => {
    const supabase = getSupabase()
    let query = supabase.from('contacts').select('*').eq('tenant_id', TENANT_ID)
    ;({ query } = await applyContactFilters(query, {}, supabase, TENANT_ID))
    const { data } = await query
    expect((data as Row[]).length).toBe(2)
  })
})

describe('applyOpenQuotePostFilter', () => {
  it('keeps only contacts with a quote on record when has_open_quote is truthy (boolean)', async () => {
    const supabase = getSupabase()
    store.tables['quotes'] = [{ tenant_id: TENANT_ID, contact_id: 'c-1', status: 'sent' }]
    const contacts = [{ id: 'c-1' }, { id: 'c-2' }]
    const result = await applyOpenQuotePostFilter(
      contacts,
      { has_open_quote: true },
      supabase,
      TENANT_ID
    )
    expect(result.map((c) => c.id)).toEqual(['c-1'])
  })

  it('is a no-op when has_open_quote is not set', async () => {
    const supabase = getSupabase()
    const contacts = [{ id: 'c-1' }, { id: 'c-2' }]
    const result = await applyOpenQuotePostFilter(contacts, {}, supabase, TENANT_ID)
    expect(result).toHaveLength(2)
  })
})
