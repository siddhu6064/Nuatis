import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'

// ── Module-level mocks (must precede all dynamic imports) ─────────────────────

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

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
}))

jest.unstable_mockModule('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: {
      generateContent: jest.fn<() => Promise<{ text: string }>>().mockResolvedValue({
        text: 'Great appointment reminder!',
      }),
    },
  })),
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['GEMINI_API_KEY'] = 'test-key'

// ── Dynamic imports (after all unstable_mockModule calls) ─────────────────────

const [
  { default: express },
  { default: request },
  { default: brandVoiceRouter },
  { buildBrandVoicePromptBlock },
] = await Promise.all([
  import('express'),
  import('supertest'),
  import('../routes/brand-voice.js'),
  import('../lib/brand-voice.js'),
])

// ── App factory ───────────────────────────────────────────────────────────────

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/brand-voice', brandVoiceRouter)
  return app
}

// ── beforeEach ────────────────────────────────────────────────────────────────

beforeEach(() => {
  store = createStore()
  store.tables['tenants'] = [{ id: 'tenant-1', brand_voice: {} }]
})

// ── Tests 1-3: Unit tests for buildBrandVoicePromptBlock ──────────────────────

describe('buildBrandVoicePromptBlock', () => {
  it('returns empty string when passed null', () => {
    const result = buildBrandVoicePromptBlock(null)
    expect(result).toBe('')
  })

  it('includes tone in output when populated', () => {
    const result = buildBrandVoicePromptBlock({ tone: 'friendly', formality: 'informal' })
    expect(result).toContain('friendly')
    expect(result).toContain('--- BRAND VOICE ---')
  })

  it('includes avoid_phrases when set', () => {
    const result = buildBrandVoicePromptBlock({ avoid_phrases: ['cheap', 'discount'] })
    expect(result).toContain('cheap')
    expect(result).toContain('discount')
  })
})

// ── Tests 4-6: Route integration tests ───────────────────────────────────────

describe('PUT /api/brand-voice', () => {
  it('returns 400 when tone is invalid', async () => {
    const res = await request(makeApp())
      .put('/api/brand-voice')
      .send({ tone: 'INVALID' })
      .set('Content-Type', 'application/json')
    expect(res.status).toBe(400)
    expect(res.body.error).toBeTruthy()
  })

  it('returns 400 when industry_terms has more than 10 items', async () => {
    const res = await request(makeApp())
      .put('/api/brand-voice')
      .send({ industry_terms: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'] })
      .set('Content-Type', 'application/json')
    expect(res.status).toBe(400)
  })
})

describe('POST /api/brand-voice/preview', () => {
  it('returns { preview: string } with mocked Gemini', async () => {
    const res = await request(makeApp())
      .post('/api/brand-voice/preview')
      .send({ tone: 'friendly' })
      .set('Content-Type', 'application/json')
    expect(res.status).toBe(200)
    expect(typeof res.body.preview).toBe('string')
  })
})
