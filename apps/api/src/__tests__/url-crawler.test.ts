import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

// ── Env vars ──────────────────────────────────────────────────────────────────
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-key'
process.env['GEMINI_API_KEY'] = 'mock-gemini-key'

// ── Shared mock store ─────────────────────────────────────────────────────────
let store: MockStore = createStore()

// ── Supabase mock ─────────────────────────────────────────────────────────────
// createClient always uses the live `store` reference, so reassigning `store`
// in beforeEach is picked up automatically.
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

// ── maya-kb-extractor mock (prevents PDF/Gemini dependency in upload tests) ───
jest.unstable_mockModule('../voice/maya-kb-extractor.js', () => ({
  extractPdfText: jest.fn().mockResolvedValue(undefined),
}))

// NOTE: We do NOT mock '../lib/url-crawler.js' globally.
// The POST /urls route fires crawlUrl() as fire-and-forget (not awaited on the
// response path), so Tests 4-5 complete before any crawl runs.
// Test 6 imports the REAL crawlUrl so it can verify the DB update.

// ── Dynamic imports after all mocks ──────────────────────────────────────────
const [
  { default: express },
  { default: request },
  { default: mayaKbRouter },
  { buildKbUrlsBlock },
  { crawlUrl },
] = await Promise.all([
  import('express'),
  import('supertest'),
  import('../routes/maya-kb.js'),
  import('../voice/business-knowledge.js'),
  import('../lib/url-crawler.js'),
])

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/maya-kb', mayaKbRouter)
  return app
}

// ── beforeEach: reset store ───────────────────────────────────────────────────
beforeEach(() => {
  store = createStore()
  store.tables['maya_kb_urls'] = []
  store.tables['maya_kb_files'] = []
})

// ── Tests 1-3: buildKbUrlsBlock (pure function) ───────────────────────────────

describe('buildKbUrlsBlock', () => {
  // Test 1: 2 ready URLs produce correct block format
  it('Test 1: returns correct block format with 2 ready URLs', () => {
    const urls = [
      { url: 'https://example.com', extracted_text: 'We offer plumbing services.' },
      { url: 'https://example.com/about', extracted_text: 'Founded in 2010.' },
    ]
    const result = buildKbUrlsBlock(urls)

    expect(result).toBe(
      '\n\n--- WEBSITE KNOWLEDGE ---\n' +
        'Source: https://example.com\nWe offer plumbing services.\n---\n' +
        'Source: https://example.com/about\nFounded in 2010.\n---\n'
    )
  })

  // Test 2: empty array returns empty string
  it('Test 2: returns empty string for empty array', () => {
    const result = buildKbUrlsBlock([])
    expect(result).toBe('')
  })

  // Test 3: skips entries with null extracted_text
  it('Test 3: skips entries with null extracted_text', () => {
    const urls = [
      { url: 'https://example.com', extracted_text: null },
      { url: 'https://example.com/services', extracted_text: 'Our services include X and Y.' },
      { url: 'https://example.com/pending', extracted_text: null },
    ]
    const result = buildKbUrlsBlock(urls)

    // Only the non-null entry should appear
    expect(result).toContain('Source: https://example.com/services')
    expect(result).toContain('Our services include X and Y.')
    expect(result).not.toContain('Source: https://example.com\n')
    expect(result).not.toContain('Source: https://example.com/pending')
  })
})

// ── Tests 4-5: POST /api/maya-kb/urls API integration ────────────────────────

describe('POST /api/maya-kb/urls', () => {
  // Test 4: non-http URL → 400
  it('Test 4: rejects non-http URL with 400', async () => {
    const res = await request(makeApp())
      .post('/api/maya-kb/urls')
      .set('Content-Type', 'application/json')
      .send({ url: 'ftp://example.com/resource' })

    expect(res.status).toBe(400)
    expect(res.body.error).toBeTruthy()
  })

  // Test 5: duplicate URL → 409 (inject error code '23505')
  it('Test 5: returns 409 for duplicate URL via error injection', async () => {
    // The supabase mock's single() returns tableErrors[table] when set.
    // We cast to include the `code` field that the route checks for '23505'.
    store.tableErrors = {
      maya_kb_urls: {
        code: '23505',
        message: 'duplicate key value violates unique constraint',
      } as unknown as { message: string },
    }

    const res = await request(makeApp())
      .post('/api/maya-kb/urls')
      .set('Content-Type', 'application/json')
      .send({ url: 'https://example.com' })

    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/already added/i)
  })
})

// ── Test 6: crawlUrl rejects localhost URLs ───────────────────────────────────

describe('crawlUrl', () => {
  it('Test 6: sets status=error in DB when given a localhost URL', async () => {
    // Seed a row so the UPDATE statements inside crawlUrl can find and mutate it
    store.tables['maya_kb_urls'] = [
      {
        id: 'url-rec-1',
        tenant_id: 'tenant-1',
        url: 'http://localhost:3000/site',
        status: 'pending',
      },
    ]

    // Call the REAL crawlUrl — it will:
    //   1. UPDATE status='crawling'
    //   2. Validate hostname → throw "Crawling local or IP addresses is not allowed"
    //   3. Catch → UPDATE status='error', error_message=<message>
    await crawlUrl({
      tenantId: 'tenant-1',
      urlRecordId: 'url-rec-1',
      rootUrl: 'http://localhost:3000/site',
    })

    const urlRows = store.tables['maya_kb_urls'] as Row[]
    const record = urlRows.find((r) => r['id'] === 'url-rec-1')
    expect(record).toBeDefined()
    expect(record!['status']).toBe('error')
    expect(typeof record!['error_message']).toBe('string')
    expect((record!['error_message'] as string).toLowerCase()).toMatch(/local|not allowed/)
  })
})
