import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

// ── Mock supabase ─────────────────────────────────────────────────────────────
let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

// ── Mock requireAuth ──────────────────────────────────────────────────────────
const TENANT_ID = 'tenant-test-1'

jest.unstable_mockModule('../lib/auth.js', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req['tenantId'] = TENANT_ID
    req['userId'] = 'user-1'
    req['role'] = 'admin'
    next()
  },
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const [{ default: express }, { default: request }, { default: reviewRequestsRouter }] =
  await Promise.all([
    import('express'),
    import('supertest'),
    import('../routes/review-requests.js'),
  ])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/review-requests', reviewRequestsRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['review_requests'] = []
})

// ── GET /api/review-requests/track/:id ───────────────────────────────────────
describe('GET /api/review-requests/track/:id', () => {
  it('updates sent→opened and redirects to review_url', async () => {
    const id = randomUUID()
    const reviewUrl = 'https://g.page/r/test-review'
    ;(store.tables['review_requests'] as Row[]).push({
      id,
      tenant_id: TENANT_ID,
      status: 'sent',
      review_url: reviewUrl,
      contact_id: 'contact-1',
    })

    const res = await request(makeApp()).get(`/api/review-requests/track/${id}`)

    // Should redirect to the review_url
    expect(res.status).toBe(302)
    expect(res.headers['location']).toBe(reviewUrl)

    // Row in store should have status updated to 'opened'
    const row = (store.tables['review_requests'] as Row[]).find((r) => r['id'] === id)
    expect(row?.['status']).toBe('opened')
    expect(row?.['opened_at']).toBeTruthy()
  })

  it('progresses sent→opened on first call, opened→clicked on second call', async () => {
    const id = randomUUID()
    const reviewUrl = 'https://g.page/r/test-review-2'
    ;(store.tables['review_requests'] as Row[]).push({
      id,
      tenant_id: TENANT_ID,
      status: 'sent',
      review_url: reviewUrl,
      contact_id: 'contact-2',
    })

    const app = makeApp()

    // First call: sent → opened
    const res1 = await request(app).get(`/api/review-requests/track/${id}`)
    expect(res1.status).toBe(302)
    const row = (store.tables['review_requests'] as Row[]).find((r) => r['id'] === id)
    expect(row?.['status']).toBe('opened')

    // Second call: opened → clicked
    const res2 = await request(app).get(`/api/review-requests/track/${id}`)
    expect(res2.status).toBe(302)
    const rowAfter = (store.tables['review_requests'] as Row[]).find((r) => r['id'] === id)
    expect(rowAfter?.['status']).toBe('clicked')
    expect(rowAfter?.['clicked_at']).toBeTruthy()
  })

  it('redirects to fallback URL when id is not found', async () => {
    const res = await request(makeApp()).get('/api/review-requests/track/nonexistent-id-00000000')

    expect(res.status).toBe(302)
    expect(res.headers['location']).toBe('https://g.page/r')
  })
})

// ── GET /api/review-requests/stats ───────────────────────────────────────────
describe('GET /api/review-requests/stats', () => {
  it('returns correct open_rate, click_rate, and completion_rate', async () => {
    const now = new Date().toISOString()

    // 5 'sent', 3 'opened', 1 'clicked', 1 'completed' = 10 total
    ;(store.tables['review_requests'] as Row[]).push(
      ...Array.from({ length: 5 }, () => ({
        id: randomUUID(),
        tenant_id: TENANT_ID,
        status: 'sent',
        channel: 'sms',
        sent_at: now,
      })),
      ...Array.from({ length: 3 }, () => ({
        id: randomUUID(),
        tenant_id: TENANT_ID,
        status: 'opened',
        channel: 'sms',
        sent_at: now,
      })),
      {
        id: randomUUID(),
        tenant_id: TENANT_ID,
        status: 'clicked',
        channel: 'email',
        sent_at: now,
      },
      {
        id: randomUUID(),
        tenant_id: TENANT_ID,
        status: 'completed',
        channel: 'email',
        sent_at: now,
      }
    )

    const res = await request(makeApp()).get('/api/review-requests/stats')

    expect(res.status).toBe(200)
    // total_sent = 10 (all rows with status in [sent, opened, clicked, completed])
    expect(res.body.total_sent).toBe(10)
    // total_opened = opened + clicked + completed = 3 + 1 + 1 = 5
    expect(res.body.total_opened).toBe(5)
    // total_clicked = clicked + completed = 1 + 1 = 2
    expect(res.body.total_clicked).toBe(2)
    // total_completed = 1
    expect(res.body.total_completed).toBe(1)
    // open_rate = round(5/10 * 100) = 50
    expect(res.body.open_rate).toBe(50)
    // click_rate = round(2/10 * 100) = 20
    expect(res.body.click_rate).toBe(20)
    // completion_rate = round(1/10 * 100) = 10
    expect(res.body.completion_rate).toBe(10)
  })
})
