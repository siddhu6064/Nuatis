import { describe, it, expect, jest, beforeEach } from '@jest/globals'
import { randomUUID } from 'node:crypto'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

// ── Configurable insert-error hook ───────────────────────────────────────────
// Set this to a Supabase-style error object before a request to force the
// snippets insert to return that error (used for the 409 duplicate test).
let nextInsertError: { code: string; message: string } | null = null

// ── Mock supabase ─────────────────────────────────────────────────────────────
let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => {
    const base = createMockSupabase(store) as {
      from: (table: string) => unknown
      rpc: unknown
      auth: unknown
      storage: unknown
    }
    return {
      ...base,
      from(table: string) {
        if (table === 'snippets' && nextInsertError !== null) {
          // Return a proxy that intercepts .insert() and returns the forced error
          const err = nextInsertError
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      or: () => Promise.resolve({ data: null, error: err }),
                      then: (resolve: (v: { data: null; error: typeof err }) => void) =>
                        resolve({ data: null, error: err }),
                    }),
                    then: (resolve: (v: { data: null; error: typeof err }) => void) =>
                      resolve({ data: null, error: err }),
                  }),
                }),
              }),
            }),
            insert: () => ({
              select: () => ({
                single: () => Promise.resolve({ data: null, error: err }),
              }),
            }),
          }
        }
        return base.from(table)
      },
    }
  },
}))

// ── Mock requireAuth ──────────────────────────────────────────────────────────
const TENANT_ID = 'tenant-test-1'

jest.unstable_mockModule('../lib/auth.js', () => ({
  requireAuth: (
    _req: { tenantId: string; userId: string; role: string },
    _res: unknown,
    next: () => void
  ) => {
    _req.tenantId = TENANT_ID
    _req.userId = 'user-1'
    _req.role = 'admin'
    next()
  },
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const [{ default: express }, { default: request }, { default: snippetsRouter }] = await Promise.all(
  [import('express'), import('supertest'), import('../routes/snippets.js')]
)

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/snippets', snippetsRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  store.tables['snippets'] = []
  nextInsertError = null
})

// ── GET /api/snippets/search ──────────────────────────────────────────────────
describe('GET /api/snippets/search', () => {
  it('returns snippets matching shortcut or name containing the query', async () => {
    // Pre-populate the store with three snippets — two match "con", one does not
    ;(store.tables['snippets'] as Row[]).push(
      {
        id: randomUUID(),
        tenant_id: TENANT_ID,
        name: 'Confirm appointment',
        shortcut: 'conf',
        body: 'Your appointment is confirmed.',
      },
      {
        id: randomUUID(),
        tenant_id: TENANT_ID,
        name: 'Contact us',
        shortcut: 'contact',
        body: 'Please contact our team.',
      },
      {
        id: randomUUID(),
        tenant_id: TENANT_ID,
        name: 'Welcome message',
        shortcut: 'welcome',
        body: 'Welcome aboard!',
      }
    )

    const res = await request(makeApp()).get('/api/snippets/search?q=con')

    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('snippets')
    const snippets = res.body.snippets as Array<{ name: string; shortcut: string }>
    // Should match "Confirm appointment" (name) and "Contact us" (name) and "contact" (shortcut)
    // "Welcome message" should NOT appear
    expect(snippets.length).toBeGreaterThanOrEqual(2)
    const names = snippets.map((s) => s.name)
    expect(names).toContain('Confirm appointment')
    expect(names).toContain('Contact us')
    expect(names).not.toContain('Welcome message')
  })

  it('returns snippets from the authenticated tenant only', async () => {
    ;(store.tables['snippets'] as Row[]).push(
      {
        id: randomUUID(),
        tenant_id: TENANT_ID,
        name: 'Concierge note',
        shortcut: 'conc',
        body: 'Concierge service available.',
      },
      {
        id: randomUUID(),
        tenant_id: 'other-tenant',
        name: 'Conference call',
        shortcut: 'conf',
        body: 'Join the conference.',
      }
    )

    const res = await request(makeApp()).get('/api/snippets/search?q=con')

    expect(res.status).toBe(200)
    const snippets = res.body.snippets as Array<{ name: string }>
    const names = snippets.map((s) => s.name)
    expect(names).toContain('Concierge note')
    expect(names).not.toContain('Conference call')
  })
})

// ── POST /api/snippets — validation ──────────────────────────────────────────
describe('POST /api/snippets', () => {
  it('returns 400 when shortcut contains a space', async () => {
    const res = await request(makeApp())
      .post('/api/snippets')
      .send({ name: 'Test Snippet', shortcut: 'has space', body: 'hello there' })
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(400)
    expect(res.body).toHaveProperty('error')
    expect((res.body.error as string).toLowerCase()).toMatch(/space|alphanumeric|dash/)
  })

  it('returns 201 and the created snippet when input is valid', async () => {
    const res = await request(makeApp())
      .post('/api/snippets')
      .send({ name: 'Hello World', shortcut: 'hello', body: 'Hello, World!' })
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty('snippet')
    expect(res.body.snippet).toMatchObject({
      name: 'Hello World',
      shortcut: 'hello',
      body: 'Hello, World!',
    })
  })

  it('returns 409 when supabase reports a unique-constraint violation (23505)', async () => {
    // Force the next insert to return a 23505 unique-constraint error
    nextInsertError = { code: '23505', message: 'duplicate key value violates unique constraint' }

    const res = await request(makeApp())
      .post('/api/snippets')
      .send({ name: 'Duplicate', shortcut: 'myshortcut', body: 'Some body text' })
      .set('Content-Type', 'application/json')

    expect(res.status).toBe(409)
    expect(res.body).toHaveProperty('error')
    expect((res.body.error as string).toLowerCase()).toContain('myshortcut')
  })
})
