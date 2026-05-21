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
process.env['TELNYX_API_KEY'] = 'test-telnyx-key'
process.env['TELNYX_CONNECTION_ID'] = 'conn-123'
process.env['API_BASE_URL'] = 'https://api.example.com'
process.env['VOICE_WS_URL'] = 'wss://api.example.com/voice/ws'

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

// ── BullMQ mock ───────────────────────────────────────────────────────────────
const mockQueueAdd = jest.fn<() => Promise<void>>().mockResolvedValue(undefined)

jest.unstable_mockModule('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({
    add: mockQueueAdd,
    close: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
  })),
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    close: jest.fn(),
  })),
}))

// ── BullMQ connection mock ────────────────────────────────────────────────────
jest.unstable_mockModule('../lib/bullmq-connection.js', () => ({
  createBullMQConnection: jest.fn().mockReturnValue({}),
}))

// ── outbound-caller mock ──────────────────────────────────────────────────────
const mockInitiateOutboundCall = jest
  .fn<() => Promise<{ callControlId: string; callLegId: string }>>()
  .mockResolvedValue({
    callControlId: 'call-ctrl-123',
    callLegId: 'call-leg-123',
  })

jest.unstable_mockModule('../lib/outbound-caller.js', () => ({
  initiateOutboundCall: mockInitiateOutboundCall,
}))

// ── scanner-pause mock ────────────────────────────────────────────────────────
jest.unstable_mockModule('../lib/scanner-pause.js', () => ({
  isScannerPaused: jest.fn<() => Promise<boolean>>().mockResolvedValue(false),
}))

// ── Dynamic imports (after all mocks) ─────────────────────────────────────────
const [{ default: express }, { default: request }, { default: outboundCallsRouter }] =
  await Promise.all([import('express'), import('supertest'), import('../routes/outbound-calls.js')])

const { processOutboundCall } = await import('../workers/outbound-call-worker.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/outbound-calls', outboundCallsRouter)
  return app
}

// ── beforeEach: reset store ───────────────────────────────────────────────────
beforeEach(() => {
  store = createStore()
  store.tables['outbound_call_jobs'] = []
  store.tables['contacts'] = [
    {
      id: 'contact-1',
      tenant_id: 'tenant-1',
      full_name: 'Alice Smith',
      phone: '+15551234567',
      email: 'alice@example.com',
      is_archived: false,
      phone_opt_out: false,
      sms_opt_out: false,
    },
    {
      id: 'contact-no-phone',
      tenant_id: 'tenant-1',
      full_name: 'Bob Jones',
      phone: null,
      email: 'bob@example.com',
      is_archived: false,
      phone_opt_out: false,
      sms_opt_out: false,
    },
  ]
  store.tables['locations'] = [
    {
      id: 'loc-1',
      tenant_id: 'tenant-1',
      telnyx_number: '+15559876543',
      is_primary: true,
    },
  ]
  store.tables['tenants'] = [{ id: 'tenant-1', name: 'Test Biz' }]
  mockQueueAdd.mockClear()
  mockInitiateOutboundCall.mockClear()
})

// ── Test 1: POST /api/outbound-calls with contact missing phone → 400 ─────────
describe('POST /api/outbound-calls — contact has no phone', () => {
  it('returns 400 when contact has no phone number', async () => {
    const res = await request(makeApp())
      .post('/api/outbound-calls')
      .send({ contact_id: 'contact-no-phone' })
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
  })
})

// ── Test 2: POST /api/outbound-calls enqueues BullMQ job ─────────────────────
describe('POST /api/outbound-calls — enqueues job', () => {
  it('returns 201 and enqueues a BullMQ job for a valid contact', async () => {
    const res = await request(makeApp())
      .post('/api/outbound-calls')
      .send({ contact_id: 'contact-1', call_context: 'Test call' })
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(201)
    expect(mockQueueAdd).toHaveBeenCalledTimes(1)
  })
})

// ── Test 3: outbound_call_jobs row created with status='pending' ──────────────
describe('POST /api/outbound-calls — creates pending job row', () => {
  it('inserts a row with status=pending, correct contact_id and tenant_id', async () => {
    await request(makeApp())
      .post('/api/outbound-calls')
      .send({ contact_id: 'contact-1' })
      .set('Content-Type', 'application/json')

    const jobs = store.tables['outbound_call_jobs'] as Row[]
    expect(jobs.length).toBeGreaterThan(0)
    const job = jobs[0]
    expect(job?.['status']).toBe('pending')
    expect(job?.['contact_id']).toBe('contact-1')
    expect(job?.['tenant_id']).toBe('tenant-1')
  })
})

// ── Test 4: POST /api/outbound-calls/:id/cancel → 400 when status='completed' ─
describe('POST /api/outbound-calls/:id/cancel — completed job', () => {
  it('returns 400 when trying to cancel a completed job', async () => {
    ;(store.tables['outbound_call_jobs'] as Row[]).push({
      id: 'job-1',
      tenant_id: 'tenant-1',
      contact_id: 'contact-1',
      status: 'completed',
      trigger_type: 'manual',
      trigger_config: {},
      scheduled_at: new Date().toISOString(),
      max_attempts: 3,
      attempts: 1,
    })

    const res = await request(makeApp())
      .post('/api/outbound-calls/job-1/cancel')
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
  })
})

// ── Test 5: Worker skips job when contact phone is null ───────────────────────
describe('processOutboundCall — contact has no phone', () => {
  it('sets job status to failed and does not initiate a call', async () => {
    ;(store.tables['outbound_call_jobs'] as Row[]).push({
      id: 'job-worker-1',
      tenant_id: 'tenant-1',
      contact_id: 'contact-no-phone',
      status: 'pending',
      trigger_type: 'manual',
      trigger_config: { call_context: 'Test call' },
      scheduled_at: new Date().toISOString(),
      max_attempts: 3,
      attempts: 0,
    })

    await processOutboundCall({ jobId: 'job-worker-1' })

    expect(mockInitiateOutboundCall).not.toHaveBeenCalled()

    const jobs = store.tables['outbound_call_jobs'] as Row[]
    const job = jobs.find((j) => j['id'] === 'job-worker-1')
    expect(job?.['status']).toBe('failed')
  })
})
