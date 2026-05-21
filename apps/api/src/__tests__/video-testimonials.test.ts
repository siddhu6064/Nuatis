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
process.env['GEMINI_API_KEY'] = 'test-gemini-key'

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

// ── Multer mock — does NOT set req.file (so Test 3 can verify missing-file → 400) ──
jest.unstable_mockModule('multer', () => {
  const multerInstance = {
    single: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
      // Intentionally does NOT set req.file — individual tests that need a file
      // must set it on the request another way (or test the 400 path here)
      next()
    },
  }
  const multerFn = () => multerInstance
  ;(multerFn as unknown as { memoryStorage: () => Record<string, never> }).memoryStorage =
    () => ({})
  return { default: multerFn }
})

// ── Gemini mock ───────────────────────────────────────────────────────────────
const mockGenerateContent = jest
  .fn<() => Promise<{ text: string }>>()
  .mockResolvedValue({ text: '{"transcript": "This is amazing!", "sentiment": "positive"}' })

jest.unstable_mockModule('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
}))

// ── video-testimonial-processor mock ─────────────────────────────────────────
const mockProcessorFn = jest.fn<() => Promise<void>>().mockResolvedValue(undefined)

jest.unstable_mockModule('../lib/video-testimonial-processor.js', () => ({
  generateTranscriptAndSentiment: mockProcessorFn,
}))

// ── Dynamic imports (after all mocks) ─────────────────────────────────────────
const [{ default: express }, { default: request }, { default: videoRouter }] = await Promise.all([
  import('express'),
  import('supertest'),
  import('../routes/video-testimonials.js'),
])

const { generateTranscriptAndSentiment } = await import('../lib/video-testimonial-processor.js')

// ── App factory ───────────────────────────────────────────────────────────────
function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/video-testimonials', videoRouter)
  return app
}

// ── beforeEach: reset store ───────────────────────────────────────────────────
beforeEach(() => {
  store = createStore()
  store.tables['video_collectors'] = [
    {
      id: 'collector-1',
      tenant_id: 'tenant-1',
      name: 'Summer Reviews',
      slug: 'abc123def456',
      prompt: 'Tell us about your experience!',
      max_duration_seconds: 30,
      status: 'active',
      submission_count: 0,
      created_at: new Date().toISOString(),
      tenants: { name: 'Test Biz' },
    },
  ]
  store.tables['video_testimonials'] = []
  store.tables['tenants'] = [{ id: 'tenant-1', name: 'Test Biz' }]
  mockGenerateContent.mockClear()
  mockProcessorFn.mockClear()
})

// ── Test 1: GET /collect/:slug → { valid: false } for unknown slug ─────────────
describe('GET /api/video-testimonials/collect/:slug — unknown slug', () => {
  it('returns { valid: false } when the slug does not exist', async () => {
    const res = await request(makeApp()).get('/api/video-testimonials/collect/unknown-slug-xyz')

    expect(res.status).toBe(200)
    expect(res.body.valid).toBe(false)
  })
})

// ── Test 2: GET /collect/:slug → collector data for active slug ───────────────
describe('GET /api/video-testimonials/collect/:slug — active collector', () => {
  it('returns valid=true and collector details for a known active slug', async () => {
    const res = await request(makeApp()).get('/api/video-testimonials/collect/abc123def456')

    expect(res.status).toBe(200)
    expect(res.body.valid).toBe(true)
    expect(res.body.collector.prompt).toBe('Tell us about your experience!')
    expect(res.body.collector.max_duration_seconds).toBe(30)
  })
})

// ── Test 3: POST /collect/:slug with no file → 400 ───────────────────────────
describe('POST /api/video-testimonials/collect/:slug — no video file', () => {
  it('returns 400 with an error message when no video file is provided', async () => {
    const res = await request(makeApp())
      .post('/api/video-testimonials/collect/abc123def456')
      .send({ name: 'Alice' })
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
    expect(String(res.body.error).toLowerCase()).toContain('video file')
  })
})

// ── Test 4: POST /:id/approve sets status='approved' + reviewed_at ────────────
describe('POST /api/video-testimonials/:id/approve — approve testimonial', () => {
  it('returns { ok: true } and updates status to approved with reviewed_at', async () => {
    ;(store.tables['video_testimonials'] as Row[]).push({
      id: 'test-1',
      tenant_id: 'tenant-1',
      collector_id: 'collector-1',
      storage_path: 'tenant-1/collector-1/test.webm',
      status: 'pending',
      submitter_name: 'Alice',
      submitter_email: 'alice@example.com',
      transcript: null,
      sentiment: null,
      submitted_at: new Date().toISOString(),
      reviewed_at: null,
      created_at: new Date().toISOString(),
    })

    const res = await request(makeApp())
      .post('/api/video-testimonials/test-1/approve')
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)

    const testimonials = store.tables['video_testimonials'] as Row[]
    const updated = testimonials.find((t) => t['id'] === 'test-1')
    expect(updated?.['status']).toBe('approved')
    expect(updated?.['reviewed_at']).toBeTruthy()
  })
})

// ── Test 5: generateTranscriptAndSentiment mock is callable and resolves ──────
describe('generateTranscriptAndSentiment — mock wiring', () => {
  it('resolves without throwing and does not invoke Gemini (processor is mocked)', async () => {
    ;(store.tables['video_testimonials'] as Row[]).push({
      id: 'proc-1',
      tenant_id: 'tenant-1',
      collector_id: 'collector-1',
      storage_path: 'tenant-1/collector-1/video.webm',
      status: 'pending',
      transcript: null,
      sentiment: null,
      submitted_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    })

    // The processor module is mocked — this call goes to mockProcessorFn
    await expect(generateTranscriptAndSentiment('proc-1')).resolves.toBeUndefined()

    // Mock was invoked once with the correct testimonial ID
    expect(mockProcessorFn).toHaveBeenCalledTimes(1)
    expect(mockProcessorFn).toHaveBeenCalledWith('proc-1')

    // Real Gemini was NOT called (processor is mocked, not the real implementation)
    expect(mockGenerateContent).not.toHaveBeenCalled()
  })
})
