import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['REDIS_URL'] = 'redis://localhost:6379'
process.env['AUTH_SECRET'] = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

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
jest.unstable_mockModule('./redis.js', () => ({ default: mockRedis }))

const {
  startImpersonationSession,
  redeemImpersonationExchangeCode,
  endImpersonationSession,
  impersonationAuditMiddleware,
} = await import('./impersonation.js')
const { getServiceClient } = await import('./supabase.js')
const { mintTestToken } = await import('../routes/__test-support__/jwt.js')

const TENANT_ID = 'target-tenant-1'

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [
    {
      id: TENANT_ID,
      vertical: 'sales_crm',
      name: 'Target Co',
      subscription_status: 'active',
      modules: {},
    },
  ]
  store.tables['users'] = [
    {
      id: 'target-owner-1',
      authjs_user_id: 'authjs-owner-1',
      tenant_id: TENANT_ID,
      role: 'owner',
      full_name: 'Target Owner',
      email: 'owner@target.test',
      is_active: true,
    },
  ]
  redisStore.clear()
})

describe('startImpersonationSession', () => {
  it('creates a session row and returns an exchange code', async () => {
    const supabase = getServiceClient()
    const result = await startImpersonationSession(supabase, {
      platformUserId: 'platform-1',
      platformUserEmail: 'support@nuatis.com',
      targetTenantId: TENANT_ID,
      reason: 'ticket #1',
    })

    expect('exchangeCode' in result).toBe(true)
    const sessions = store.tables['impersonation_sessions'] as Row[]
    expect(sessions).toHaveLength(1)
    expect(sessions[0]?.['platform_user_email']).toBe('support@nuatis.com')
    expect(sessions[0]?.['target_app_user_id']).toBe('target-owner-1')
  })

  it('errors when the tenant has no active owner', async () => {
    store.tables['users'] = []
    const supabase = getServiceClient()
    const result = await startImpersonationSession(supabase, {
      platformUserId: 'platform-1',
      platformUserEmail: 'support@nuatis.com',
      targetTenantId: TENANT_ID,
      reason: 'ticket #1',
    })
    expect('error' in result).toBe(true)
  })

  it('errors for an unknown tenant', async () => {
    const supabase = getServiceClient()
    const result = await startImpersonationSession(supabase, {
      platformUserId: 'platform-1',
      platformUserEmail: 'support@nuatis.com',
      targetTenantId: 'nope',
      reason: 'ticket #1',
    })
    expect('error' in result).toBe(true)
  })
})

describe('redeemImpersonationExchangeCode', () => {
  it('redeems a valid code exactly once', async () => {
    const supabase = getServiceClient()
    const started = await startImpersonationSession(supabase, {
      platformUserId: 'platform-1',
      platformUserEmail: 'support@nuatis.com',
      targetTenantId: TENANT_ID,
      reason: 'ticket #1',
    })
    if (!('exchangeCode' in started)) throw new Error('setup failed')

    const claims = await redeemImpersonationExchangeCode(started.exchangeCode)
    expect(claims?.appUserId).toBe('target-owner-1')
    expect(claims?.impersonation.platformUserEmail).toBe('support@nuatis.com')

    const second = await redeemImpersonationExchangeCode(started.exchangeCode)
    expect(second).toBeNull()
  })

  it('returns null for an unknown code', async () => {
    const claims = await redeemImpersonationExchangeCode('bogus')
    expect(claims).toBeNull()
  })
})

describe('endImpersonationSession', () => {
  it('marks a session ended only for the platform user who started it', async () => {
    store.tables['impersonation_sessions'] = [
      { id: 'sess-1', platform_user_id: 'platform-1', target_tenant_id: TENANT_ID, ended_at: null },
    ]
    const supabase = getServiceClient()
    const wrongUser = await endImpersonationSession(supabase, 'sess-1', 'platform-2')
    expect(wrongUser).toBe(false)

    const rightUser = await endImpersonationSession(supabase, 'sess-1', 'platform-1')
    expect(rightUser).toBe(true)
    expect((store.tables['impersonation_sessions'] as Row[])[0]?.['ended_at']).not.toBeNull()
  })
})

describe('impersonationAuditMiddleware', () => {
  it('logs a mutating request carrying an impersonation claim', async () => {
    const token = await mintTestToken({
      sub: 'target-owner-1',
      tenantId: TENANT_ID,
      role: 'owner',
      impersonation: { sessionId: 'sess-1', platformUserId: 'platform-1' },
    })

    const req = {
      method: 'POST',
      originalUrl: '/api/contacts',
      headers: { authorization: `Bearer ${token}` },
    } as unknown as import('express').Request
    const next = jest.fn()

    await impersonationAuditMiddleware(req, {} as import('express').Response, next)
    await new Promise((r) => setTimeout(r, 10))

    expect(next).toHaveBeenCalledTimes(1)
    const actions = store.tables['impersonation_actions'] as Row[]
    expect(actions).toHaveLength(1)
    expect(actions[0]?.['session_id']).toBe('sess-1')
    expect(actions[0]?.['method']).toBe('POST')
  })

  it('does nothing for a GET request even with the claim present', async () => {
    const token = await mintTestToken({
      sub: 'target-owner-1',
      tenantId: TENANT_ID,
      role: 'owner',
      impersonation: { sessionId: 'sess-1', platformUserId: 'platform-1' },
    })
    const req = {
      method: 'GET',
      originalUrl: '/api/contacts',
      headers: { authorization: `Bearer ${token}` },
    } as unknown as import('express').Request
    const next = jest.fn()

    await impersonationAuditMiddleware(req, {} as import('express').Response, next)
    await new Promise((r) => setTimeout(r, 10))

    expect(next).toHaveBeenCalledTimes(1)
    expect((store.tables['impersonation_actions'] as Row[] | undefined) ?? []).toHaveLength(0)
  })

  it('does nothing for a normal (non-impersonated) mutating request', async () => {
    const token = await mintTestToken({ sub: 'user-1', tenantId: TENANT_ID, role: 'owner' })
    const req = {
      method: 'POST',
      originalUrl: '/api/contacts',
      headers: { authorization: `Bearer ${token}` },
    } as unknown as import('express').Request
    const next = jest.fn()

    await impersonationAuditMiddleware(req, {} as import('express').Response, next)
    await new Promise((r) => setTimeout(r, 10))

    expect(next).toHaveBeenCalledTimes(1)
    expect((store.tables['impersonation_actions'] as Row[] | undefined) ?? []).toHaveLength(0)
  })

  it('fails open (still calls next) on a garbage token', async () => {
    const req = {
      method: 'POST',
      originalUrl: '/api/contacts',
      headers: { authorization: 'Bearer not-a-real-token' },
    } as unknown as import('express').Request
    const next = jest.fn()

    await impersonationAuditMiddleware(req, {} as import('express').Response, next)
    expect(next).toHaveBeenCalledTimes(1)
  })
})
