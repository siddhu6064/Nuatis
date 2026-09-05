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
delete process.env['YELP_API_KEY']
delete process.env['META_APP_ID']
delete process.env['META_APP_SECRET']

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

// The Facebook auth-url/callback routes touch Redis for the OAuth nonce —
// mock it so this test file doesn't depend on a real Redis server being
// reachable (nothing else in this file needs Redis at all).
const redisStore = new Map<string, string>()
const mockRedis = {
  set: jest.fn(async (key: string, value: string) => {
    redisStore.set(key, value)
    return 'OK'
  }),
  get: jest.fn(async (key: string) => redisStore.get(key) ?? null),
  del: jest.fn(async (key: string) => {
    redisStore.delete(key)
    return 1
  }),
}
jest.unstable_mockModule('../lib/redis.js', () => ({ default: mockRedis }))

const searchYelpBusinesses = jest.fn(async () => [
  {
    id: 'yelp-biz-1',
    name: 'Test Biz',
    location: '123 Main St',
    rating: 4.5,
    review_count: 10,
    image_url: null,
  },
])
jest.unstable_mockModule('../lib/yelp-client.js', () => ({ searchYelpBusinesses }))

const syncYelpReviews = jest.fn(async () => ({ synced: 2 }))
jest.unstable_mockModule('../lib/yelp-sync.js', () => ({ syncYelpReviews }))

const isFacebookConfigured = jest.fn(() => false)
const getFacebookAuthUrl = jest.fn(() => 'https://facebook.com/oauth')
const exchangeFacebookCode = jest.fn(async () => ({ access_token: 'fb-token', expires_in: 3600 }))
const getFacebookPages = jest.fn(async () => [
  { id: 'page-1', name: 'Test Page', access_token: 'page-token' },
])
const saveFacebookConnection = jest.fn(async () => undefined)
jest.unstable_mockModule('../lib/facebook-oauth.js', () => ({
  isFacebookConfigured,
  getFacebookAuthUrl,
  exchangeFacebookCode,
  getFacebookPages,
  saveFacebookConnection,
}))

const syncFacebookReviews = jest.fn(async () => ({ synced: 1 }))
jest.unstable_mockModule('../lib/facebook-sync.js', () => ({ syncFacebookReviews }))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000rvf0001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET

async function makeToken(): Promise<string> {
  return mintTestToken({ sub: 'user-1', tenantId: TENANT_ID, role: 'owner' }, { secret: SECRET })
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
  store.tables['yelp_connections'] = []
  store.tables['facebook_connections'] = []
  searchYelpBusinesses.mockClear()
  syncYelpReviews.mockClear()
  isFacebookConfigured.mockClear()
  isFacebookConfigured.mockReturnValue(false)
  getFacebookAuthUrl.mockClear()
  exchangeFacebookCode.mockClear()
  getFacebookPages.mockClear()
  saveFacebookConnection.mockClear()
  syncFacebookReviews.mockClear()
})

describe('GET /api/reputation/yelp/search', () => {
  it('returns matching businesses', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/reputation/yelp/search?term=coffee&location=Austin')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.businesses).toHaveLength(1)
    expect(searchYelpBusinesses).toHaveBeenCalledWith('coffee', 'Austin')
  })

  it('400s when term or location is missing', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/reputation/yelp/search?term=coffee')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(400)
  })
})

describe('POST /api/reputation/yelp/connect', () => {
  it('saves a yelp connection', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/reputation/yelp/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({ businessId: 'yelp-biz-1', businessName: 'Test Biz' })

    expect(res.status).toBe(200)
    const rows = store.tables['yelp_connections'] as Row[]
    expect(rows).toHaveLength(1)
    expect(rows[0]?.['yelp_business_id']).toBe('yelp-biz-1')
  })

  it('400s without a businessId', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/reputation/yelp/connect')
      .set('Authorization', `Bearer ${token}`)
      .send({})
    expect(res.status).toBe(400)
  })
})

describe('GET /api/reputation/yelp/status', () => {
  it('reports connected + business name after connecting', async () => {
    store.tables['yelp_connections'] = [
      { tenant_id: TENANT_ID, yelp_business_id: 'yelp-biz-1', business_name: 'Test Biz' },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/reputation/yelp/status')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.connected).toBe(true)
    expect(res.body.businessName).toBe('Test Biz')
  })
})

describe('DELETE /api/reputation/yelp/disconnect', () => {
  it('removes the connection', async () => {
    store.tables['yelp_connections'] = [
      { tenant_id: TENANT_ID, yelp_business_id: 'yelp-biz-1', business_name: 'Test Biz' },
    ]
    const token = await makeToken()
    const res = await request(makeApp())
      .delete('/api/reputation/yelp/disconnect')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(store.tables['yelp_connections']).toHaveLength(0)
  })
})

describe('POST /api/reputation/yelp/sync', () => {
  it('calls syncYelpReviews and returns the count', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/reputation/yelp/sync')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.synced).toBe(2)
  })
})

describe('GET /api/reputation/facebook/status', () => {
  it('reports not configured when META_APP_ID/SECRET are unset', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/reputation/facebook/status')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(res.body.configured).toBe(false)
    expect(res.body.connected).toBe(false)
  })
})

describe('GET /api/reputation/facebook/auth-url', () => {
  it('503s when Facebook is not configured', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/reputation/facebook/auth-url')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(503)
  })

  it('returns an auth url when configured', async () => {
    isFacebookConfigured.mockReturnValue(true)
    const token = await makeToken()
    const res = await request(makeApp())
      .get('/api/reputation/facebook/auth-url')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.url).toBe('https://facebook.com/oauth')
  })
})

describe('POST /api/reputation/facebook/sync', () => {
  it('503s when Facebook is not configured', async () => {
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/reputation/facebook/sync')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(503)
  })

  it('syncs when configured', async () => {
    isFacebookConfigured.mockReturnValue(true)
    const token = await makeToken()
    const res = await request(makeApp())
      .post('/api/reputation/facebook/sync')
      .set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(200)
    expect(res.body.synced).toBe(1)
  })
})
