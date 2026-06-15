import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'

// ── Mock supabase + heavy dynamic imports pulled in by admin /stats ──────────
let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../voice/telnyx-handler.js', () => ({
  getActiveConnectionCount: () => 0,
}))
jest.unstable_mockModule('../workers/index.js', () => ({
  getWorkerStatus: () => ({}),
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const ADMIN_KEY = 'test-admin-key-123'
const TENANT_ID = 'tenant-misc-1'

const [
  { default: express },
  { default: request },
  { default: adminRouter },
  { requireModule },
  { smsSendTenantLimiter },
] = await Promise.all([
  import('express'),
  import('supertest'),
  import('../routes/admin.js'),
  import('../lib/auth.js'),
  import('../middleware/rate-limit.js'),
])

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = []
  store.tables['voice_sessions'] = []
})

// ── C1: requireModule fail-closed ─────────────────────────────────────────────
describe('requireModule', () => {
  function makeModuleApp() {
    const app = express()
    app.use((req, _res, next) => {
      ;(req as unknown as Record<string, unknown>)['tenantId'] = TENANT_ID
      next()
    })
    app.get('/guarded', requireModule('campaigns'), (_req, res) => {
      res.json({ ok: true })
    })
    return app
  }

  afterEach(() => {
    process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
    process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
  })

  it('fails closed with 503 when Supabase env is missing', async () => {
    delete process.env['SUPABASE_URL']

    const res = await request(makeModuleApp()).get('/guarded')

    expect(res.status).toBe(503)
    expect(res.body.error).toBe('Module check unavailable')
  })

  it('allows through when the module is enabled', async () => {
    store.tables['tenants'] = [{ id: TENANT_ID, modules: { campaigns: true } }]

    const res = await request(makeModuleApp()).get('/guarded')

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('denies with 403 when the module is explicitly disabled', async () => {
    store.tables['tenants'] = [{ id: TENANT_ID, modules: { campaigns: false } }]

    const res = await request(makeModuleApp()).get('/guarded')

    expect(res.status).toBe(403)
  })
})

// ── C2: admin key timing-safe compare ─────────────────────────────────────────
describe('admin key check', () => {
  function makeAdminApp() {
    const app = express()
    app.use('/admin', adminRouter)
    return app
  }

  afterEach(() => {
    delete process.env['ADMIN_API_KEY']
  })

  it('returns 503 when ADMIN_API_KEY is not configured', async () => {
    delete process.env['ADMIN_API_KEY']
    const res = await request(makeAdminApp()).get('/admin/stats')
    expect(res.status).toBe(503)
  })

  it('rejects a wrong key with 401', async () => {
    process.env['ADMIN_API_KEY'] = ADMIN_KEY
    const res = await request(makeAdminApp())
      .get('/admin/stats')
      .set('x-admin-key', 'wrong-key-padded-x')
    expect(res.status).toBe(401)
  })

  it('rejects a wrong-length key with 401', async () => {
    process.env['ADMIN_API_KEY'] = ADMIN_KEY
    const res = await request(makeAdminApp()).get('/admin/stats').set('x-admin-key', 'short')
    expect(res.status).toBe(401)
  })

  it('rejects a missing key header with 401', async () => {
    process.env['ADMIN_API_KEY'] = ADMIN_KEY
    const res = await request(makeAdminApp()).get('/admin/stats')
    expect(res.status).toBe(401)
  })

  it('accepts the correct key', async () => {
    process.env['ADMIN_API_KEY'] = ADMIN_KEY
    const res = await request(makeAdminApp()).get('/admin/stats').set('x-admin-key', ADMIN_KEY)
    expect(res.status).toBe(200)
    expect(typeof res.body.uptime_seconds).toBe('number')
  })
})

// ── B: per-tenant SMS send limiter ────────────────────────────────────────────
describe('smsSendTenantLimiter', () => {
  function makeLimitedApp(tenantId: string) {
    const app = express()
    app.use((req, _res, next) => {
      ;(req as unknown as Record<string, unknown>)['tenantId'] = tenantId
      next()
    })
    app.post('/send', smsSendTenantLimiter, (_req, res) => {
      res.json({ sent: true })
    })
    return app
  }

  const originalNodeEnv = process.env['NODE_ENV']

  afterEach(() => {
    process.env['NODE_ENV'] = originalNodeEnv
  })

  it('is skipped in the test env', async () => {
    const res = await request(makeLimitedApp('tenant-skip')).post('/send')
    expect(res.status).toBe(200)
  })

  it('returns 429 for a tenant over the cap, keyed by tenant not IP', async () => {
    // The skip() guard reads NODE_ENV per request, so flipping it here
    // activates the limiter for these requests only.
    process.env['NODE_ENV'] = 'production'

    const appA = makeLimitedApp('tenant-burst')
    let lastStatus = 0
    for (let i = 0; i < 101; i++) {
      const res = await request(appA).post('/send')
      lastStatus = res.status
    }
    expect(lastStatus).toBe(429)

    // Same IP (supertest localhost), different tenant — separate bucket.
    const appB = makeLimitedApp('tenant-quiet')
    const other = await request(appB).post('/send')
    expect(other.status).toBe(200)
  })
})
