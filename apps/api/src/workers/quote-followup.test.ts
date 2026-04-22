import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
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
process.env['TELNYX_API_KEY'] = 'test-telnyx-key'

const fetchMock = jest.fn<typeof fetch>(async () => {
  return { ok: true, status: 200, text: async () => '' } as unknown as Response
})
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(globalThis as any).fetch = fetchMock

const { processFollowup } = await import('./quote-followup-worker.js')

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000qf00001'

function seedBase(): void {
  store.tables['tenants'] = [{ id: TENANT_ID, name: 'Clinic' }]
  store.tables['locations'] = [
    { id: randomUUID(), tenant_id: TENANT_ID, telnyx_number: '+15550000000', is_primary: true },
  ]
}

beforeEach(() => {
  store = createStore()
  seedBase()
  store.tables['quotes'] = []
  store.tables['quote_views'] = []
  fetchMock.mockClear()
})

describe('processFollowup', () => {
  it('sends follow-up SMS for quote not yet viewed', async () => {
    const quoteId = randomUUID()
    store.tables['quotes']!.push({ id: quoteId, tenant_id: TENANT_ID, status: 'sent' })

    await processFollowup({
      quoteId,
      tenantId: TENANT_ID,
      contactPhone: '+15125550001',
      contactName: 'Jane',
      quoteNumber: 'Q-0001',
      shareToken: 'abc123',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    const body = String(init.body ?? '')
    expect(body).toContain('abc123')
    expect(body).toContain('Jane')
  })

  it('skips when quote has already been viewed', async () => {
    const quoteId = randomUUID()
    store.tables['quotes']!.push({ id: quoteId, tenant_id: TENANT_ID, status: 'sent' })
    store.tables['quote_views']!.push({ id: randomUUID(), quote_id: quoteId })

    await processFollowup({
      quoteId,
      tenantId: TENANT_ID,
      contactPhone: '+15125550001',
      contactName: 'Jane',
      quoteNumber: 'Q-0001',
      shareToken: 'abc123',
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips when quote is in terminal status', async () => {
    const quoteId = randomUUID()
    store.tables['quotes']!.push({ id: quoteId, tenant_id: TENANT_ID, status: 'accepted' })

    await processFollowup({
      quoteId,
      tenantId: TENANT_ID,
      contactPhone: '+15125550001',
      contactName: 'Jane',
      quoteNumber: 'Q-0001',
      shareToken: 'abc123',
    })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
