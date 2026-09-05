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

// ── booking-availability mock (for the appointment reschedule/cancel routes) ─
const getTenantCalendarCredentials = jest.fn(async () => ({
  provider: 'native' as const,
  calendarId: 'primary',
  timezone: 'America/Chicago',
  tenantId: 'tenant-1',
  refreshToken: '',
}))
const isSlotAvailable = jest.fn(async () => true)
const getAvailableSlotsForDate = jest.fn(async () => ({
  slots: [{ start: '10:00', end: '10:30' }],
  closed: false,
}))
const createCalendarEvent = jest.fn(async () => ({
  googleEventId: null,
  startIso: '2027-01-15T10:00:00.000Z',
  endIso: '2027-01-15T10:30:00.000Z',
}))
jest.unstable_mockModule('../lib/booking-availability.js', () => ({
  getTenantCalendarCredentials,
  isSlotAvailable,
  getAvailableSlotsForDate,
  createCalendarEvent,
}))

// ── activity/webhook mocks (for the new-appointment booking route) ──────────
const logActivity = jest.fn(async () => undefined)
const dispatchWebhook = jest.fn(async () => undefined)
jest.unstable_mockModule('../lib/activity.js', () => ({ logActivity }))
jest.unstable_mockModule('../lib/webhook-dispatcher.js', () => ({ dispatchWebhook }))

// ── Stripe mock (for payment-method setup-intent/remove routes) ──────────────
process.env['STRIPE_SECRET_KEY'] = 'sk_test_mock'
const mockCustomersCreate = jest
  .fn<() => Promise<{ id: string }>>()
  .mockResolvedValue({ id: 'cus_1' })
const mockSetupIntentsCreate = jest
  .fn<() => Promise<{ client_secret: string; id: string }>>()
  .mockResolvedValue({ client_secret: 'seti_1_secret', id: 'seti_1' })
const mockPaymentMethodsDetach = jest.fn<() => Promise<unknown>>().mockResolvedValue({})
jest.unstable_mockModule('stripe', () => ({
  default: jest.fn().mockImplementation(() => ({
    customers: { create: mockCustomersCreate },
    setupIntents: { create: mockSetupIntentsCreate },
    paymentMethods: { detach: mockPaymentMethodsDetach },
  })),
}))

// ── Dynamic imports (after all mocks) ─────────────────────────────────────────
// Sequential, not Promise.all — concurrent dynamic imports that share a
// newly-common dependency (lib/supabase.js, since the getServiceClient()
// consolidation) race in Jest's experimental VM-modules linker and throw
// "module ... is not linked".
const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: portalRouter } = await import('../routes/portal.js')

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
  store.tables['contact_referral_codes'] = []
  store.tables['customer_referral_rewards'] = []
  store.tables['contact_attachments'] = []
  store.tables['services'] = []
  store.tables['staff_services'] = []
  store.tables['staff_members'] = []
  store.tables['locations'] = []
  mockEmailSend.mockClear()
  mockCustomersCreate.mockClear()
  mockSetupIntentsCreate.mockClear()
  mockPaymentMethodsDetach.mockClear()
  getTenantCalendarCredentials.mockClear()
  isSlotAvailable.mockClear()
  isSlotAvailable.mockResolvedValue(true)
  getAvailableSlotsForDate.mockClear()
  createCalendarEvent.mockClear()
  logActivity.mockClear()
  dispatchWebhook.mockClear()
})

function farFutureIso(hoursFromNow: number): string {
  return new Date(Date.now() + hoursFromNow * 3600_000).toISOString()
}

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
        start_time: futureDate,
        title: 'Haircut',
        status: 'confirmed',
        location_id: 'loc-1',
      },
      {
        id: 'appt-past',
        contact_id: 'contact-1',
        tenant_id: 'tenant-1',
        start_time: pastDate,
        title: 'Color',
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
      start_time: futureDate,
      title: 'Other Service',
      status: 'confirmed',
      location_id: 'loc-other',
    })
    ;(store.tables['invoices'] as Row[]).push({
      id: 'inv-1',
      contact_id: 'contact-1',
      tenant_id: 'tenant-1',
      invoice_number: 'INV-001',
      total: 150,
      balance_due: 150,
      status: 'sent',
      due_date: null,
      created_at: futureDate,
      share_token: 'share-abc123',
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

    // Regression guard: the route previously selected scheduled_at/service_name,
    // columns that don't exist on appointments (real columns are start_time/
    // title) — this silently returned an empty array against the real DB.
    expect(upcoming[0]?.['id']).toBe('appt-upcoming')
    expect(upcoming[0]?.['start_time']).toBe(futureDate)
    expect(upcoming[0]?.['title']).toBe('Haircut')

    // share_token must come through so the portal can link straight to the
    // existing public pay flow (/invoices/public/[token]) instead of a dead end.
    const invoices = res.body.invoices as Row[]
    expect(invoices[0]?.['share_token']).toBe('share-abc123')

    // Program disabled by default (tenants row above has no
    // customer_referral_program_enabled column set) — referral must be null,
    // not an error or a partial object.
    expect(res.body.referral).toBeNull()
  })
})

describe('GET /api/portal/data — documents', () => {
  it('surfaces the contact_attachments store with a signed URL, tenant-isolated', async () => {
    seedPortalAccess()
    ;(store.tables['contact_attachments'] as Row[]).push(
      {
        id: 'att-1',
        tenant_id: 'tenant-1',
        contact_id: 'contact-1',
        filename: 'stored-name.pdf',
        original_filename: 'Consent Form.pdf',
        file_type: 'application/pdf',
        file_size: 24576,
        storage_path: 'tenant-1/contact-1/stored-name.pdf',
        storage_bucket: 'contact-attachments',
        created_at: new Date().toISOString(),
      },
      {
        id: 'att-other',
        tenant_id: 'tenant-other',
        contact_id: 'contact-other',
        filename: 'not-mine.pdf',
        original_filename: 'Not Mine.pdf',
        file_type: 'application/pdf',
        file_size: 100,
        storage_path: 'tenant-other/contact-other/not-mine.pdf',
        storage_bucket: 'contact-attachments',
        created_at: new Date().toISOString(),
      }
    )

    const res = await request(makeApp()).get('/api/portal/data?token=valid-token-abc123')

    expect(res.status).toBe(200)
    expect(res.body.documents).toHaveLength(1)
    expect(res.body.documents[0]).toMatchObject({
      id: 'att-1',
      filename: 'Consent Form.pdf',
      file_size: 24576,
      signed_url: 'https://signed.url/test',
    })
  })
})

// ── Test 5: GET /api/portal/data surfaces the customer-referral block when enabled ──
describe('GET /api/portal/data — customer referrals', () => {
  it('lazily creates a referral code and returns it, plus past reward status', async () => {
    seedPortalAccess()
    store.tables['tenants'] = [
      {
        id: 'tenant-1',
        name: 'Test Biz',
        portal_enabled: true,
        portal_slug: 'test-biz',
        customer_referral_program_enabled: true,
        customer_referral_reward_cents: 1500,
        customer_referral_referred_reward_cents: 0,
      },
    ]
    ;(store.tables['customer_referral_rewards'] as Row[]).push({
      id: 'reward-1',
      tenant_id: 'tenant-1',
      referrer_contact_id: 'contact-1',
      referred_contact_id: 'contact-friend',
      status: 'issued',
      issued_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    })
    ;(store.tables['contacts'] as Row[]).push({
      id: 'contact-friend',
      tenant_id: 'tenant-1',
      full_name: 'A Friend',
    })

    const res = await request(makeApp()).get('/api/portal/data?token=valid-token-abc123')

    expect(res.status).toBe(200)
    expect(res.body.referral).not.toBeNull()
    expect(res.body.referral.code).toBeTruthy()
    expect(res.body.referral.referral_url).toContain(res.body.referral.code)
    expect(res.body.referral.reward_cents).toBe(1500)
    expect(res.body.referral.rewards).toHaveLength(1)
    expect(res.body.referral.rewards[0].status).toBe('issued')

    // A second call must reuse the same code, not mint a new one each time.
    const res2 = await request(makeApp()).get('/api/portal/data?token=valid-token-abc123')
    expect(res2.body.referral.code).toBe(res.body.referral.code)
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

// ── Test 7: payment-method setup-intent / remove ──────────────────────────────
describe('POST /api/portal/payment-method/setup-intent', () => {
  it('creates a Stripe customer + SetupIntent and returns a client secret', async () => {
    seedPortalAccess()

    const res = await request(makeApp()).post(
      '/api/portal/payment-method/setup-intent?token=valid-token-abc123'
    )

    expect(res.status).toBe(200)
    expect(res.body.clientSecret).toBe('seti_1_secret')
    expect(mockCustomersCreate).toHaveBeenCalledTimes(1)

    const rows = store.tables['contacts'] as Row[]
    expect(rows.find((c) => c['id'] === 'contact-1')?.['stripe_customer_id']).toBe('cus_1')
  })

  it('401s for an invalid token', async () => {
    const res = await request(makeApp()).post(
      '/api/portal/payment-method/setup-intent?token=does-not-exist'
    )
    expect(res.status).toBe(401)
  })
})

describe('DELETE /api/portal/payment-method', () => {
  it('detaches and clears the saved payment method', async () => {
    seedPortalAccess()
    ;(store.tables['contacts'] as Row[])[0]!['default_payment_method_id'] = 'pm_1'

    const res = await request(makeApp()).delete(
      '/api/portal/payment-method?token=valid-token-abc123'
    )

    expect(res.status).toBe(200)
    expect(mockPaymentMethodsDetach).toHaveBeenCalledWith('pm_1', {}, undefined)
    const rows = store.tables['contacts'] as Row[]
    expect(rows[0]?.['default_payment_method_id']).toBe(null)
  })

  it('401s for an invalid token', async () => {
    const res = await request(makeApp()).delete('/api/portal/payment-method?token=bad')
    expect(res.status).toBe(401)
  })
})

// ── Portal self-service: reschedule/cancel own appointments ────────────────────
// Previously the portal was entirely read-only for appointments — a customer
// could see them but had no route to change or cancel one from inside the
// portal itself (a separate, unguessable-link flow off the confirmation SMS
// existed, but nothing reachable from a logged-in portal session).
function seedApptForContact1(overrides: Record<string, unknown> = {}) {
  const row = {
    id: 'appt-1',
    tenant_id: 'tenant-1',
    contact_id: 'contact-1',
    title: 'Haircut',
    start_time: farFutureIso(48),
    end_time: farFutureIso(48.5),
    status: 'scheduled',
    deleted_at: null,
    ...overrides,
  }
  ;(store.tables['appointments'] as Row[]).push(row)
  return row
}

describe('GET /api/portal/appointments/:id', () => {
  it('returns eligibility for the caller’s own appointment', async () => {
    seedPortalAccess()
    seedApptForContact1()
    const res = await request(makeApp()).get(
      '/api/portal/appointments/appt-1?token=valid-token-abc123'
    )
    expect(res.status).toBe(200)
    expect(res.body.can_modify).toBe(true)
  })

  it('404s for another contact’s appointment — cannot be reached even with a valid token', async () => {
    seedPortalAccess()
    seedApptForContact1({ id: 'appt-2', contact_id: 'contact-other' })
    const res = await request(makeApp()).get(
      '/api/portal/appointments/appt-2?token=valid-token-abc123'
    )
    expect(res.status).toBe(404)
  })

  it('401s for an invalid token', async () => {
    seedApptForContact1()
    const res = await request(makeApp()).get('/api/portal/appointments/appt-1?token=bad')
    expect(res.status).toBe(401)
  })
})

describe('POST /api/portal/appointments/:id/reschedule', () => {
  it('reschedules to a new available slot', async () => {
    seedPortalAccess()
    seedApptForContact1()
    const res = await request(makeApp())
      .post('/api/portal/appointments/appt-1/reschedule?token=valid-token-abc123')
      .send({ date: '2027-01-15', start_time: '10:00' })
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('scheduled')
  })

  it('409s when inside the notice window', async () => {
    seedPortalAccess()
    seedApptForContact1({ start_time: farFutureIso(1) })
    const res = await request(makeApp())
      .post('/api/portal/appointments/appt-1/reschedule?token=valid-token-abc123')
      .send({ date: '2027-01-15', start_time: '10:00' })
    expect(res.status).toBe(409)
  })

  it('cannot reschedule another contact’s appointment', async () => {
    seedPortalAccess()
    seedApptForContact1({ id: 'appt-2', contact_id: 'contact-other' })
    const res = await request(makeApp())
      .post('/api/portal/appointments/appt-2/reschedule?token=valid-token-abc123')
      .send({ date: '2027-01-15', start_time: '10:00' })
    expect(res.status).toBe(404)
  })
})

describe('POST /api/portal/appointments/:id/cancel', () => {
  it('cancels the appointment', async () => {
    seedPortalAccess()
    seedApptForContact1()
    const res = await request(makeApp()).post(
      '/api/portal/appointments/appt-1/cancel?token=valid-token-abc123'
    )
    expect(res.status).toBe(200)
    expect((store.tables['appointments'] as Row[])[0]?.['status']).toBe('canceled')
  })

  it('409s when inside the notice window', async () => {
    seedPortalAccess()
    seedApptForContact1({ start_time: farFutureIso(1) })
    const res = await request(makeApp()).post(
      '/api/portal/appointments/appt-1/cancel?token=valid-token-abc123'
    )
    expect(res.status).toBe(409)
  })

  it('cannot cancel another contact’s appointment', async () => {
    seedPortalAccess()
    seedApptForContact1({ id: 'appt-2', contact_id: 'contact-other' })
    const res = await request(makeApp()).post(
      '/api/portal/appointments/appt-2/cancel?token=valid-token-abc123'
    )
    expect(res.status).toBe(404)
  })
})

describe('GET /api/portal/booking/services', () => {
  it('returns the tenant’s curated bookable services with mapped staff', async () => {
    seedPortalAccess()
    ;(store.tables['tenants'] as Row[])[0]!['booking_services'] = ['svc-1']
    store.tables['services']!.push({
      id: 'svc-1',
      tenant_id: 'tenant-1',
      name: 'Haircut',
      description: null,
      duration_minutes: 30,
      unit_price: 45,
      is_active: true,
    })
    store.tables['staff_members']!.push({ id: 'staff-1', name: 'Jordan', color_hex: '#000' })
    store.tables['staff_services']!.push({
      tenant_id: 'tenant-1',
      service_id: 'svc-1',
      staff_id: 'staff-1',
    })

    const res = await request(makeApp()).get(
      '/api/portal/booking/services?token=valid-token-abc123'
    )
    expect(res.status).toBe(200)
    expect(res.body.services).toHaveLength(1)
    expect(res.body.services[0].name).toBe('Haircut')
    expect(res.body.staffByService['svc-1']).toHaveLength(1)
    expect(res.body.staffByService['svc-1'][0].name).toBe('Jordan')
  })

  it('returns an empty list when the tenant has no booking_services configured', async () => {
    seedPortalAccess()
    const res = await request(makeApp()).get(
      '/api/portal/booking/services?token=valid-token-abc123'
    )
    expect(res.status).toBe(200)
    expect(res.body.services).toEqual([])
  })

  it('401s an invalid token', async () => {
    const res = await request(makeApp()).get('/api/portal/booking/services?token=bogus')
    expect(res.status).toBe(401)
  })
})

describe('GET /api/portal/booking/availability', () => {
  it('returns slots for a valid service+date', async () => {
    seedPortalAccess()
    store.tables['services']!.push({
      id: 'svc-1',
      tenant_id: 'tenant-1',
      name: 'Haircut',
      duration_minutes: 30,
      is_active: true,
    })

    const res = await request(makeApp()).get(
      '/api/portal/booking/availability?token=valid-token-abc123&serviceId=svc-1&date=2027-01-15'
    )
    expect(res.status).toBe(200)
    expect(res.body.slots).toHaveLength(1)
  })

  it('404s for a service that does not exist on this tenant', async () => {
    seedPortalAccess()
    const res = await request(makeApp()).get(
      '/api/portal/booking/availability?token=valid-token-abc123&serviceId=missing&date=2027-01-15'
    )
    expect(res.status).toBe(404)
  })

  it('400s a malformed date', async () => {
    seedPortalAccess()
    store.tables['services']!.push({
      id: 'svc-1',
      tenant_id: 'tenant-1',
      duration_minutes: 30,
      is_active: true,
    })
    const res = await request(makeApp()).get(
      '/api/portal/booking/availability?token=valid-token-abc123&serviceId=svc-1&date=not-a-date'
    )
    expect(res.status).toBe(400)
  })
})

describe('POST /api/portal/booking/confirm', () => {
  it('books a new appointment for the portal contact', async () => {
    seedPortalAccess()
    store.tables['services']!.push({
      id: 'svc-1',
      tenant_id: 'tenant-1',
      name: 'Haircut',
      duration_minutes: 30,
      is_active: true,
    })

    const res = await request(makeApp())
      .post('/api/portal/booking/confirm?token=valid-token-abc123')
      .send({ serviceId: 'svc-1', date: '2027-01-15', startTime: '10:00' })

    expect(res.status).toBe(201)
    expect(res.body.id).toBeDefined()

    const appt = (store.tables['appointments'] as Row[]).find((a) => a['id'] === res.body.id)
    expect(appt).toBeDefined()
    expect(appt?.['contact_id']).toBe('contact-1')
    expect(appt?.['status']).toBe('confirmed')
    expect(logActivity).toHaveBeenCalledTimes(1)
    expect(dispatchWebhook).toHaveBeenCalledWith(
      'tenant-1',
      'appointment.booked',
      expect.objectContaining({ contact_id: 'contact-1' })
    )
  })

  it('409s when the slot is no longer available', async () => {
    seedPortalAccess()
    store.tables['services']!.push({
      id: 'svc-1',
      tenant_id: 'tenant-1',
      name: 'Haircut',
      duration_minutes: 30,
      is_active: true,
    })
    isSlotAvailable.mockResolvedValueOnce(false)

    const res = await request(makeApp())
      .post('/api/portal/booking/confirm?token=valid-token-abc123')
      .send({ serviceId: 'svc-1', date: '2027-01-15', startTime: '10:00' })

    expect(res.status).toBe(409)
  })

  it('400s missing required fields', async () => {
    seedPortalAccess()
    const res = await request(makeApp())
      .post('/api/portal/booking/confirm?token=valid-token-abc123')
      .send({ date: '2027-01-15' })
    expect(res.status).toBe(400)
  })

  it('401s an invalid token', async () => {
    const res = await request(makeApp())
      .post('/api/portal/booking/confirm?token=bogus')
      .send({ serviceId: 'svc-1', date: '2027-01-15', startTime: '10:00' })
    expect(res.status).toBe(401)
  })
})
