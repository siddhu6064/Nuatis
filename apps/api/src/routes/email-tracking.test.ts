import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()
const logActivity = jest.fn(async () => undefined)
const enqueueScoreCompute = jest.fn<() => void>()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/activity.js', () => ({ logActivity }))
jest.unstable_mockModule('../lib/lead-score-queue.js', () => ({ enqueueScoreCompute }))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000et00001'
const CONTACT_ID = 'cccccccc-0000-0000-0000-00000et00001'

const [{ default: express }, { default: request }, { default: trackingRouter }] = await Promise.all(
  [import('express'), import('supertest'), import('./email-tracking.js')]
)

function makeApp() {
  const app = express()
  app.use('/api/email-tracking', trackingRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['email_messages'] = []
  logActivity.mockClear()
  enqueueScoreCompute.mockClear()
})

describe('GET /api/email-tracking/:token', () => {
  it('returns a GIF for valid tracking token and increments open_count (first open)', async () => {
    const msgId = randomUUID()
    ;(store.tables['email_messages'] as Row[]).push({
      id: msgId,
      tenant_id: TENANT_ID,
      contact_id: CONTACT_ID,
      subject: 'Test email',
      tracking_token: 'tok-abc-1234',
      open_count: 0,
      opened_at: null,
    })

    const res = await request(makeApp()).get('/api/email-tracking/tok-abc-1234')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('image/gif')

    const row = (store.tables['email_messages'] as Row[]).find((r) => r['id'] === msgId)
    expect(row?.['open_count']).toBe(1)
    expect(row?.['opened_at']).not.toBeNull()

    expect(logActivity).toHaveBeenCalledTimes(1)
    expect(enqueueScoreCompute).toHaveBeenCalledTimes(1)
    const args = enqueueScoreCompute.mock.calls[0]! as unknown as [string, string, string]
    expect(args[2]).toBe('email_opened')
  })

  it('increments open_count but does NOT re-log activity on subsequent opens', async () => {
    const msgId = randomUUID()
    ;(store.tables['email_messages'] as Row[]).push({
      id: msgId,
      tenant_id: TENANT_ID,
      contact_id: CONTACT_ID,
      subject: 'Already opened',
      tracking_token: 'tok-xyz-5678',
      open_count: 2,
      opened_at: new Date().toISOString(),
    })

    const res = await request(makeApp()).get('/api/email-tracking/tok-xyz-5678')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('image/gif')

    const row = (store.tables['email_messages'] as Row[]).find((r) => r['id'] === msgId)
    expect(row?.['open_count']).toBe(3)

    expect(logActivity).not.toHaveBeenCalled()
    expect(enqueueScoreCompute).not.toHaveBeenCalled()
  })

  it('still returns GIF for unknown tracking token', async () => {
    const res = await request(makeApp()).get('/api/email-tracking/nonexistent-token-abc')

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('image/gif')
  })
})
