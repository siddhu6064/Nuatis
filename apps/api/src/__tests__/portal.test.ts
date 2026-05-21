import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

// ── Env vars ──────────────────────────────────────────────────────────────────
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['RESEND_API_KEY'] = 'test-resend-key'

// ── Shared mock store ─────────────────────────────────────────────────────────
let store: MockStore = createStore()

// ── Supabase mock ─────────────────────────────────────────────────────────────
jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

// ── Auth mock ─────────────────────────────────────────────────────────────────
jest.unstable_mockModule('../lib/auth.js', () => ({
  requireAuth: (
    _req: { tenantId: string; userId: string; role: string },
    _res: unknown,
    next: () => void
  ) => {
    _req.tenantId = 'tenant-1'
    _req.userId = 'user-1'
    _req.role = 'admin'
    next()
  },
  requireModule: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))

// ── Resend mock ───────────────────────────────────────────────────────────────
const mockEmailSend = jest
  .fn<() => Promise<{ data: { id: string } | null; error: null }>>()
  .mockResolvedValue({ data: { id: 'email-123' }, error: null })

jest.unstable_mockModule('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: mockEmailSend },
  })),
}))

// ── portal-slug mock (for enable route) ──────────────────────────────────────
jest.unstable_mockModule('../lib/portal-slug.js', () => ({
  generatePortalSlug: jest.fn().mockResolvedValue('test-biz'),
}))

// ── Dynamic imports (after all mocks) ─────────────────────────────────────────
const [{ default: express }, { default: request }, { default: portalRouter }] = await Promise.all([
  import('express'),
  import('supertest'),
  import('../routes/portal.js'),
])

const { generatePortalSlug } = await import('../lib/portal-slug.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/portal', portalRouter)
  return app
}

// ── Helper: seed a portal_access row ─────────────────────────────────────────
function seedPortalAccess(overrides: Record<string, unknown> = {}) {
  const row = {
    id: 'pa-1',
    tenant_id: 'tenant-1',
    contact_id: 'contact-1',
    access_token: 'valid-token-abc123',
    email: 'alice@example.com',
    last_accessed_at: null,
    expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    created_at: new Date().toISOString(),
    ...overrides,
  }
  ;(store.tables['portal_access'] as Row[]).push(row)
  return row
}

// ── beforeEach: reset store ───────────────────────────────────────────────────
beforeEach(() => {
  store = createStore()
  store.tables['portal_access'] = []
  store.tables['tenants'] = [
    {
      id: 'tenant-1',
      name: 'Test Biz',
      portal_enabled: true,
      portal_slug: 'test-biz',
    },
  ]
  store.tables['contacts'] = [
    {
      id: 'contact-1',
      tenant_id: 'tenant-1',
      full_name: 'Alice Smith',
      email: 'alice@example.com',
      phone: '+15551234567',
    },
  ]
  store.tables['appointments'] = []
  store.tables['quotes'] = []
  store.tables['invoices'] = []
  mockEmailSend.mockClear()
})

// ── Test 1: GET /api/portal/verify with valid token returns { valid: true, contact_name } ──
describe('GET /api/portal/verify — valid token', () => {
  it('returns valid:true and contact_name for a non-expired token', async () => {
    seedPortalAccess()

    const res = await request(makeApp()).get('/api/portal/verify?token=valid-token-abc123')

    expect(res.status).toBe(200)
    expect(res.body.valid).toBe(true)
    expect(res.body.contact_name).toBe('Alice Smith')
  })
})

// ── Test 2: GET /api/portal/verify with expired token returns { valid: false } ─
describe('GET /api/portal/verify — expired token', () => {
  it('returns valid:false when token is expired', async () => {
    seedPortalAccess({
      access_token: 'expired-token',
      expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
    })

    const res = await request(makeApp()).get('/api/portal/verify?token=expired-token')

    expect(res.status).toBe(200)
    expect(res.body.valid).toBe(false)
  })
})

// ── Test 3: GET /api/portal/data with valid token returns only that contact's data ──
describe('GET /api/portal/data — tenant isolation', () => {
  it('returns contact data for the correct tenant and contact only', async () => {
    seedPortalAccess()

    // Seed appointments for contact-1 / tenant-1
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    ;(store.tables['appointments'] as Row[]).push(
      {
        id: 'appt-upcoming',
        contact_id: 'contact-1',
        tenant_id: 'tenant-1',
        scheduled_at: futureDate,
        service_name: 'Haircut',
        status: 'confirmed',
        location_id: 'loc-1',
      },
      {
        id: 'appt-past',
        contact_id: 'contact-1',
        tenant_id: 'tenant-1',
        scheduled_at: pastDate,
        service_name: 'Color',
        status: 'completed',
        location_id: 'loc-1',
      }
    )

    // Seed a different tenant's contact and appointment (should NOT appear)
    ;(store.tables['contacts'] as Row[]).push({
      id: 'contact-other',
      tenant_id: 'tenant-other',
      full_name: 'Bob Other',
      email: 'bob@other.com',
      phone: null,
    })
    ;(store.tables['appointments'] as Row[]).push({
      id: 'appt-other',
      contact_id: 'contact-other',
      tenant_id: 'tenant-other',
      scheduled_at: futureDate,
      service_name: 'Other Service',
      status: 'confirmed',
      location_id: 'loc-other',
    })

    const res = await request(makeApp()).get('/api/portal/data?token=valid-token-abc123')

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('contact')
    expect(res.body).toHaveProperty('appointments')
    expect(res.body).toHaveProperty('quotes')
    expect(res.body).toHaveProperty('invoices')
    expect(res.body).toHaveProperty('documents')

    // Tenant isolation: only contact-1 / tenant-1 appointments
    const upcoming = res.body.appointments.upcoming as Row[]
    const past = res.body.appointments.past as Row[]
    const allApptIds = [...upcoming, ...past].map((a) => a['id'])
    expect(allApptIds).toContain('appt-upcoming')
    expect(allApptIds).toContain('appt-past')
    expect(allApptIds).not.toContain('appt-other')
  })
})

// ── Test 4: GET /api/portal/data with invalid token returns 401 ───────────────
describe('GET /api/portal/data — invalid token', () => {
  it('returns 401 when token is not found', async () => {
    // No portal_access seeded

    const res = await request(makeApp()).get('/api/portal/data?token=invalid-token-xyz')

    expect(res.status).toBe(401)
  })
})

// ── Test 5: POST /api/portal/invite/:contactId creates new portal_access row ────
describe('POST /api/portal/invite/:contactId', () => {
  it('creates portal_access row and returns access_token when none exists', async () => {
    // No pre-existing portal_access row
    expect((store.tables['portal_access'] as Row[]).length).toBe(0)

    const res = await request(makeApp())
      .post('/api/portal/invite/contact-1')
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('access_token')
    expect(res.body).toHaveProperty('portal_url')

    // Confirm a NEW portal_access row was created in store
    const rows = store.tables['portal_access'] as Row[]
    expect(rows.length).toBe(1)
    const row = rows[0]
    expect(row?.['contact_id']).toBe('contact-1')
    expect(row?.['tenant_id']).toBe('tenant-1')
    expect(row?.['email']).toBe('alice@example.com')
  })
})

// ── Test 6: POST /api/portal/enable calls generatePortalSlug and returns slug ─
describe('POST /api/portal/enable', () => {
  it('calls generatePortalSlug with tenantId and business name, returns portal_slug and portal_url', async () => {
    const res = await request(makeApp())
      .post('/api/portal/enable')
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(200)
    expect(res.body.portal_slug).toBe('test-biz')
    expect(res.body.portal_url).toBe('https://app.nuatis.com/portal/test-biz')
    expect((generatePortalSlug as jest.Mock).mock.calls.length).toBeGreaterThan(0)
    expect((generatePortalSlug as jest.Mock).mock.calls[0]).toEqual(['tenant-1', 'Test Biz'])
  })
})
