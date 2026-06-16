import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'

// ── Env (must be set before module imports that read it at load) ──────────────
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

// ── Shared mock store ─────────────────────────────────────────────────────────
const store: MockStore = createStore()

// ── PostHog capture mock — the seam under test ────────────────────────────────
const capture = jest.fn()
jest.unstable_mockModule('../lib/posthog.js', () => ({
  capture,
  shutdownPostHog: jest.fn(async () => undefined),
}))

// ── Supabase mock (+ auth.admin for the tenants signup route) ─────────────────
const createUser = jest.fn(async () => ({
  data: { user: { id: 'sb-auth-user-1', email: 'owner@example.com' } },
  error: null,
}))
const deleteUser = jest.fn(async () => ({ data: null, error: null }))
jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => {
    const base = createMockSupabase(store) as unknown as Record<string, unknown>
    base['auth'] = { admin: { createUser, deleteUser } }
    return base
  },
}))

// ── Auth mock — injects the domain user id (appUserId) on the request ─────────
const AUTHED = {
  tenantId: 'tenant-1',
  userId: 'sub-1',
  appUserId: 'app-user-1',
  role: 'owner',
  vertical: 'hvac',
}
jest.unstable_mockModule('../lib/auth.js', () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    Object.assign(req, AUTHED)
    next()
  },
  requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}))

// ── Rate-limit middleware → passthrough ───────────────────────────────────────
const passthrough = (_req: unknown, _res: unknown, next: () => void) => next()
jest.unstable_mockModule('../middleware/rate-limit.js', () => ({
  authLimiter: passthrough,
  phoneProvisionLimiter: passthrough,
  apiLimiter: passthrough,
}))

// ── Side-effect deps mocked to no-ops ─────────────────────────────────────────
jest.unstable_mockModule('../lib/maya-memory-queue.js', () => ({
  enqueueMayaMemoryExtraction: jest.fn(),
}))
jest.unstable_mockModule('../lib/activity.js', () => ({
  logActivity: jest.fn(async () => undefined),
}))
jest.unstable_mockModule('../services/scheduling.js', () => ({
  createEvent: jest.fn(async () => null),
  createEventWithMeet: jest.fn(async () => ({ eventId: null, meetLink: null })),
  updateEvent: jest.fn(async () => undefined),
  deleteEvent: jest.fn(async () => undefined),
}))
jest.unstable_mockModule('../lib/sms.js', () => ({ sendSms: jest.fn(async () => undefined) }))
jest.unstable_mockModule('../lib/ops-copilot-client.js', () => ({
  publishActivityEvent: jest.fn(async () => undefined),
}))
jest.unstable_mockModule('../lib/modules.js', () => ({
  isModuleEnabled: jest.fn(async () => true),
}))
jest.unstable_mockModule('../lib/resource-availability.js', () => ({
  checkResourceAvailable: jest.fn(async () => true),
}))
jest.unstable_mockModule('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn(), close: jest.fn() })),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn() })),
}))
jest.unstable_mockModule('../lib/bullmq-connection.js', () => ({
  createBullMQConnection: jest.fn().mockReturnValue({}),
}))
jest.unstable_mockModule('../lib/seed-sample-data.js', () => ({
  seedSampleData: jest.fn(async () => undefined),
}))
jest.unstable_mockModule('@nuatis/shared', () => ({
  getVertical: () => ({
    fields: {},
    system_prompt_template: '',
    pipeline_stages: [{ name: 'New', position: 1, color: '#0d9488' }],
  }),
  VERTICAL_SLUGS: ['hvac'],
  seedInventory: jest.fn(async () => undefined),
  seedStaff: jest.fn(async () => undefined),
  getFirstName: (fullName: string | null | undefined, fallback = 'there') =>
    fullName?.trim() ? fullName.trim().split(' ')[0] : fallback,
}))

// ── Dynamic imports (after mocks) ─────────────────────────────────────────────
// Import sequentially — concurrent import() of several zod-using routers trips
// a jest-ESM module-linking race ("can not be resolved ... not linked").
const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: tenantsRouter } = await import('../routes/tenants.js')
const { default: provisioningRouter } = await import('../routes/provisioning.js')
const { default: appointmentsRouter } = await import('../routes/appointments.js')
const { processImportRows } = await import('../lib/import-processor.js')
const { persistVoiceSession } = await import('../voice/call-session-logger.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/tenants', tenantsRouter)
  app.use('/api/provisioning', provisioningRouter)
  app.use('/api/appointments', appointmentsRouter)
  return app
}

beforeEach(() => {
  // Reset tables in place — do NOT reassign `store`. tenants.ts binds its
  // supabase client once at module load (to this store object), so a fresh
  // store would orphan that client. Mutating .tables keeps both the
  // module-level and per-request mock clients pointed at the live data.
  store.tables = {}
  for (const t of [
    'tenants',
    'users',
    'tenant_users',
    'vertical_configs',
    'pipeline_stages',
    'automation_rules',
    'locations',
    'contacts',
    'voice_sessions',
    'appointments',
    'resource_bookings',
  ]) {
    store.tables[t] = []
  }
  capture.mockClear()
  createUser.mockClear()
})

describe('activation events — tenant_signed_up', () => {
  it('emits tenant_signed_up with tenant_id + distinctId = new appUserId', async () => {
    const res = await request(makeApp()).post('/api/tenants').send({
      business_name: 'Acme HVAC',
      vertical_slug: 'hvac',
      owner_email: 'owner@example.com',
      owner_password: 'password123',
      owner_name: 'Owner One',
      skipSampleData: true,
    })
    expect(res.status).toBe(201)

    const userRow = store.tables['users'][0]!
    const tenantRow = store.tables['tenants'][0]!
    const call = capture.mock.calls.find((c) => c[1] === 'tenant_signed_up')
    expect(call).toBeDefined()
    expect(call![0]).toBe(userRow['id']) // distinctId = domain user id
    expect(call![2]).toMatchObject({
      tenant_id: tenantRow['id'],
      vertical: 'hvac',
      product: 'suite',
    })
  })
})

describe('activation events — onboarding_completed', () => {
  it('emits onboarding_completed with tenant_id + appUserId on final step', async () => {
    store.tables['tenants'] = [{ id: 'tenant-1', onboarding_step: 6 }]
    const res = await request(makeApp()).post('/api/provisioning/complete-step').send({ step: 6 })
    expect(res.status).toBe(200)

    const call = capture.mock.calls.find((c) => c[1] === 'onboarding_completed')
    expect(call).toBeDefined()
    expect(call![0]).toBe('app-user-1')
    expect(call![2]).toMatchObject({ tenant_id: 'tenant-1', vertical: 'hvac' })
  })

  it('does NOT emit onboarding_completed on a non-final step', async () => {
    store.tables['tenants'] = [{ id: 'tenant-1', onboarding_step: 2 }]
    await request(makeApp()).post('/api/provisioning/complete-step').send({ step: 2 })
    expect(capture.mock.calls.find((c) => c[1] === 'onboarding_completed')).toBeUndefined()
  })
})

describe('activation events — appointment_created', () => {
  it('emits appointment_created with tenant_id + channel manual + appUserId', async () => {
    const start = new Date('2026-07-01T15:00:00.000Z').toISOString()
    const end = new Date('2026-07-01T16:00:00.000Z').toISOString()
    const res = await request(makeApp())
      .post('/api/appointments')
      .send({ contact_id: randomUUID(), title: 'Service call', start_time: start, end_time: end })
    expect(res.status).toBe(201)

    const call = capture.mock.calls.find((c) => c[1] === 'appointment_created')
    expect(call).toBeDefined()
    expect(call![0]).toBe('app-user-1')
    expect(call![2]).toMatchObject({ tenant_id: 'tenant-1', channel: 'manual' })
  })
})

describe('activation events — contact_import_completed', () => {
  it('emits with tenant_id + row_count, distinctId = actor appUserId when provided', async () => {
    const result = await processImportRows(
      'tenant-1',
      [{ name: 'Jane', phone: '5551234567' }],
      { name: 'name', phone: 'phone' },
      { skip_duplicates: true, update_existing: false },
      undefined,
      'app-user-1'
    )
    expect(result.imported).toBe(1)
    const call = capture.mock.calls.find((c) => c[1] === 'contact_import_completed')
    expect(call).toBeDefined()
    expect(call![0]).toBe('app-user-1')
    expect(call![2]).toMatchObject({ tenant_id: 'tenant-1', row_count: 1 })
  })

  it('falls back to tenant distinctId when no actor in scope', async () => {
    await processImportRows(
      'tenant-1',
      [{ name: 'Bob' }],
      { name: 'name' },
      { skip_duplicates: true, update_existing: false }
    )
    const call = capture.mock.calls.find((c) => c[1] === 'contact_import_completed')
    expect(call![0]).toBe('tenant:tenant-1')
  })
})

describe('activation events — maya_call_logged', () => {
  it('emits with tenant_id, tenant-keyed distinctId, is_first=true on first session', async () => {
    await persistVoiceSession({
      tenantId: 'tenant-1',
      streamId: 's1',
      callControlId: 'c1',
      callerPhone: '+15551230000',
      duration: 42,
      firstResponseMs: 800,
      bookedAppointment: false,
      appointmentId: null,
      contactId: null,
      escalated: false,
      escalationReason: null,
      vertical: 'hvac',
      toolCallsMade: [],
      hangupSource: null,
      hangupCause: null,
      callQualityMos: null,
      startedAt: new Date('2026-07-01T15:00:00.000Z'),
    })

    const call = capture.mock.calls.find((c) => c[1] === 'maya_call_logged')
    expect(call).toBeDefined()
    expect(call![0]).toBe('tenant:tenant-1')
    expect(call![2]).toMatchObject({ tenant_id: 'tenant-1', is_first: true })
  })
})
