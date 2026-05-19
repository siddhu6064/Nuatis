import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

// ── Mock supabase ─────────────────────────────────────────────────────────────
let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

// ── Mock nanoid so slugs are deterministic ────────────────────────────────────
jest.unstable_mockModule('nanoid', () => ({
  nanoid: () => 'TESTSLUG',
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'
process.env['API_BASE_URL'] = 'http://localhost:3001'

const [
  { default: express },
  { default: request },
  { triggerLinkPublicRouter },
  { generateTriggerSlug },
  { buildTriggerUrl },
] = await Promise.all([
  import('express'),
  import('supertest'),
  import('../routes/trigger-links.js'),
  import('../lib/slugify.js'),
  import('@nuatis/shared'),
])

function makePublicApp() {
  const app = express()
  app.use('/t', triggerLinkPublicRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['trigger_links'] = []
  store.tables['trigger_link_events'] = []
})

// ── Unit: generateTriggerSlug ────────────────────────────────────────────────
describe('generateTriggerSlug', () => {
  it('returns an 8-character string', async () => {
    // nanoid is mocked to return 'TESTSLUG' (8 chars), toLowerCase → 'testslug'
    const slug = await generateTriggerSlug()
    expect(typeof slug).toBe('string')
    expect(slug).toHaveLength(8)
  })
})

// ── Unit: buildTriggerUrl ────────────────────────────────────────────────────
describe('buildTriggerUrl', () => {
  it('includes ?cid= param when contactId provided', () => {
    const url = buildTriggerUrl('abc12345', 'contact-uuid')
    expect(url).toBe('http://localhost:3001/t/abc12345?cid=contact-uuid')
  })

  it('omits ?cid= param when contactId not provided', () => {
    const url = buildTriggerUrl('abc12345')
    expect(url).toBe('http://localhost:3001/t/abc12345')
  })
})

// ── Route: GET /t/:slug ───────────────────────────────────────────────────────
describe('GET /t/:slug', () => {
  it('returns 404 HTML when slug not found', async () => {
    const res = await request(makePublicApp()).get('/t/unknownslug')
    expect(res.status).toBe(404)
    expect(res.text).toContain('no longer active')
  })

  it('increments click_count for a valid slug', async () => {
    const linkId = randomUUID()
    ;(store.tables['trigger_links'] as Row[]).push({
      id: linkId,
      tenant_id: 'tenant-1',
      name: 'Test Link',
      slug: 'testslug',
      action: 'mark_contacted',
      action_config: {},
      click_count: 0,
    })

    await request(makePublicApp()).get('/t/testslug')

    const link = (store.tables['trigger_links'] as Row[]).find((r) => r['id'] === linkId)
    expect(link?.['click_count']).toBe(1)
  })
})
