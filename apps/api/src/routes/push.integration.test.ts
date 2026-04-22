import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { SignJWT } from 'jose'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from './__test-support__/supabase-mock.js'

let store: MockStore = createStore()
const sendPushNotification = jest.fn(async () => undefined)

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/push-client.js', () => ({ sendPushNotification }))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000ph00001'
const USER_ID = 'user-ph-001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  const secretBytes = new TextEncoder().encode(SECRET)
  return new SignJWT({ sub: USER_ID, tenantId: TENANT_ID, role: 'owner', vertical: 'dental' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(secretBytes)
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: pushRouter } = await import('./push.js')
const { default: pushMobileRouter } = await import('./push-mobile.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/push', pushRouter)
  app.use('/api/push/mobile', pushMobileRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['push_subscriptions'] = []
  store.tables['mobile_push_tokens'] = []
  sendPushNotification.mockClear()
})

describe('POST /api/push/subscribe', () => {
  it('subscribes and returns 200', async () => {
    const token = await makeToken()

    const res = await request(makeApp())
      .post('/api/push/subscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({
        subscription: {
          endpoint: 'https://fcm.push/sub1',
          keys: { p256dh: 'key1', auth: 'auth1' },
        },
      })

    expect(res.status).toBe(200)
    const rows = store.tables['push_subscriptions'] as Row[]
    expect(rows.length).toBe(1)
    expect(rows[0]!['endpoint']).toBe('https://fcm.push/sub1')
  })
})

describe('POST /api/push/unsubscribe', () => {
  it('removes subscription and returns 200', async () => {
    ;(store.tables['push_subscriptions'] as Row[]).push({
      id: 'sub-1',
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      endpoint: 'https://fcm.push/removeMe',
      p256dh: 'k',
      auth: 'a',
    })
    const token = await makeToken()

    const res = await request(makeApp())
      .post('/api/push/unsubscribe')
      .set('Authorization', `Bearer ${token}`)
      .send({ endpoint: 'https://fcm.push/removeMe' })

    expect(res.status).toBe(200)
    const rows = store.tables['push_subscriptions'] as Row[]
    expect(rows.length).toBe(0)
  })
})

describe('POST /api/push/mobile/register', () => {
  it('registers expo token and returns 200', async () => {
    const token = await makeToken()

    const res = await request(makeApp())
      .post('/api/push/mobile/register')
      .set('Authorization', `Bearer ${token}`)
      .send({ token: 'ExponentPushToken[test]', platform: 'ios' })

    expect(res.status).toBe(200)
    const rows = store.tables['mobile_push_tokens'] as Row[]
    expect(rows.length).toBe(1)
    expect(rows[0]!['expo_token']).toBe('ExponentPushToken[test]')
  })

  it('returns 400 when platform is invalid', async () => {
    const token = await makeToken()

    const res = await request(makeApp())
      .post('/api/push/mobile/register')
      .set('Authorization', `Bearer ${token}`)
      .send({ token: 'ExponentPushToken[test]', platform: 'windows' })

    expect(res.status).toBe(400)
  })
})
