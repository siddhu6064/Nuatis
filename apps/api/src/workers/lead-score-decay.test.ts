import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

/**
 * NOTE ON SCOPE
 * The lead-score-decay queue's processor (processDecay) only *enqueues*
 * per-contact compute jobs with trigger='decay'. The actual score write
 * happens in processCompute, which calls computeLeadScore to get the new
 * value. These tests exercise processCompute with trigger='decay' — the
 * functional processor for decay jobs — using a mocked computeLeadScore
 * to control the returned score.
 */

let store: MockStore = createStore()
const computeLeadScore = jest.fn<
  (tenantId: string, contactId: string) => Promise<{ score: number; grade: string }>
>(async () => ({ score: 30, grade: 'C' }))
const logActivity = jest.fn(async () => undefined)

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/lead-scoring.js', () => ({ computeLeadScore }))
jest.unstable_mockModule('../lib/activity.js', () => ({ logActivity }))
jest.unstable_mockModule('../lib/lead-score-queue.js', () => ({
  getLeadScoreQueue: () => ({ add: async () => undefined }),
  enqueueScoreCompute: () => undefined,
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-000000lsd001'
const { processCompute } = await import('./lead-score-worker.js')

beforeEach(() => {
  store = createStore()
  store.tables['contacts'] = []
  computeLeadScore.mockReset()
  logActivity.mockClear()
})

describe('lead-score-decay processor (via processCompute trigger=decay)', () => {
  it('decays score for contact with no recent activity', async () => {
    const contactId = randomUUID()
    store.tables['contacts']!.push({
      id: contactId,
      tenant_id: TENANT_ID,
      lead_score: 50,
      lead_grade: 'B',
    })
    computeLeadScore.mockResolvedValueOnce({ score: 30, grade: 'C' })

    await processCompute({ tenantId: TENANT_ID, contactId, trigger: 'decay' })

    const row = (store.tables['contacts'] as Row[]).find((r) => r['id'] === contactId)
    expect(Number(row?.['lead_score'])).toBeLessThan(50)
    expect(Number(row?.['lead_score'])).toBe(30)
    expect(logActivity).toHaveBeenCalledTimes(1)
  })

  it('does not decay score below 0 (floor)', async () => {
    const contactId = randomUUID()
    store.tables['contacts']!.push({
      id: contactId,
      tenant_id: TENANT_ID,
      lead_score: 2,
      lead_grade: 'F',
    })
    // computeLeadScore is responsible for flooring; model that behavior here.
    computeLeadScore.mockResolvedValueOnce({ score: 0, grade: 'F' })

    await processCompute({ tenantId: TENANT_ID, contactId, trigger: 'decay' })

    const row = (store.tables['contacts'] as Row[]).find((r) => r['id'] === contactId)
    expect(Number(row?.['lead_score'])).toBe(0)
    expect(Number(row?.['lead_score'])).toBeGreaterThanOrEqual(0)
  })

  it('does not log activity for recent contact whose score did not move', async () => {
    const contactId = randomUUID()
    store.tables['contacts']!.push({
      id: contactId,
      tenant_id: TENANT_ID,
      lead_score: 80,
      lead_grade: 'A',
    })
    // "Recent activity" means computeLeadScore returns the same score.
    computeLeadScore.mockResolvedValueOnce({ score: 80, grade: 'A' })

    await processCompute({ tenantId: TENANT_ID, contactId, trigger: 'decay' })

    const row = (store.tables['contacts'] as Row[]).find((r) => r['id'] === contactId)
    expect(Number(row?.['lead_score'])).toBe(80)
    expect(logActivity).not.toHaveBeenCalled()
  })
})
