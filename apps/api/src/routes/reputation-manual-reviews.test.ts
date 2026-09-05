import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from './__test-support__/supabase-mock.js'

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['REDIS_URL'] = 'redis://localhost:6379'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000rev0001'
const OTHER_TENANT_ID = 'bbbbbbbb-0000-0000-0000-00000rev0002'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET

async function makeToken(tenantId = TENANT_ID): Promise<string> {
  return mintTestToken({ sub: 'user-1', tenantId, role: 'owner' }, { secret: SECRET })
}

const [{ default: express }, { default: request }, { default: reputationRouter }] =
  await Promise.all([import('express'), import('supertest'), import('./reputation.js')])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/reputation', reputationRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['reviews'] = []
})

describe('POST /api/reputation/reviews/manual', () => {
  it('creates a manual review with a synthetic google_review_id', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/reputation/reviews/manual')
      .set('Authorization', `Bearer ${token}`)
      .send({ source: 'yelp', reviewer_name: 'Jane D.', rating: 5, comment: 'Great service!' })

    expect(res.status).toBe(201)
    expect(res.body.source).toBe('yelp')
    expect(res.body.reviewer_name).toBe('Jane D.')
    expect(res.body.status).toBe('new')
    expect(res.body.google_review_id).toMatch(/^manual-/)
  })

  it('defaults source to manual when not specified', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/reputation/reviews/manual')
      .set('Authorization', `Bearer ${token}`)
      .send({ rating: 4 })

    expect(res.status).toBe(201)
    expect(res.body.source).toBe('manual')
  })

  it('400s on an invalid source', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/reputation/reviews/manual')
      .set('Authorization', `Bearer ${token}`)
      .send({ source: 'google', rating: 5 })

    expect(res.status).toBe(400)
  })

  it('400s on a rating outside 1-5', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/reputation/reviews/manual')
      .set('Authorization', `Bearer ${token}`)
      .send({ rating: 6 })

    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/reputation/reviews/:id', () => {
  it('deletes a manual review', async () => {
    store.tables['reviews'] = [
      {
        id: 'rev-1',
        tenant_id: TENANT_ID,
        google_review_id: 'manual-abc',
        source: 'manual',
        rating: 5,
      },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .delete('/api/reputation/reviews/rev-1')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect((store.tables['reviews'] as Row[]).length).toBe(0)
  })

  it('refuses to delete a real google-sourced review', async () => {
    store.tables['reviews'] = [
      {
        id: 'rev-google',
        tenant_id: TENANT_ID,
        google_review_id: 'g-123',
        source: 'google',
        rating: 5,
      },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .delete('/api/reputation/reviews/rev-google')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
    expect((store.tables['reviews'] as Row[]).length).toBe(1)
  })

  it('404s for another tenant’s review', async () => {
    store.tables['reviews'] = [
      {
        id: 'rev-other',
        tenant_id: OTHER_TENANT_ID,
        google_review_id: 'manual-xyz',
        source: 'manual',
        rating: 3,
      },
    ]
    const token = await makeToken(TENANT_ID)
    const res = await request(makeApp())
      .delete('/api/reputation/reviews/rev-other')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(404)
  })
})
