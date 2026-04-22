import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import type { Request, Response, NextFunction } from 'express'
import {
  createStore,
  createMockSupabase,
  type MockStore,
  type Row,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000al00001'

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { auditLoggerMiddleware } = await import('./audit-logger.js')

function makeApp() {
  const app = express()
  app.use(express.json())

  // Pre-set tenantId on res.locals for all routes (simulates requireAuth)
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.locals['tenantId'] = TENANT_ID
    next()
  })

  app.use(auditLoggerMiddleware)

  app.post('/api/contacts', (_req, res) => {
    res.status(201).json({ ok: true })
  })
  app.get('/api/contacts', (_req, res) => {
    res.status(200).json({ ok: true })
  })
  app.post('/api/push/subscribe', (_req, res) => {
    res.status(200).json({ ok: true })
  })

  return app
}

async function waitForFinish(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20))
}

beforeEach(() => {
  store = createStore()
  store.tables['audit_log'] = []
})

describe('auditLoggerMiddleware', () => {
  it('inserts audit_log row for POST request with tenant context', async () => {
    const res = await request(makeApp()).post('/api/contacts').send({ foo: 'bar' })

    expect(res.status).toBe(201)
    await waitForFinish()

    const rows = store.tables['audit_log'] as Row[]
    expect(rows.length).toBe(1)
    expect(rows[0]!['action']).toBe('create')
    expect(rows[0]!['tenant_id']).toBe(TENANT_ID)
    const details = rows[0]!['details'] as Record<string, unknown>
    expect(details['status']).toBe(201)
  })

  it('does NOT insert for GET requests', async () => {
    const res = await request(makeApp()).get('/api/contacts')

    expect(res.status).toBe(200)
    await waitForFinish()

    const rows = store.tables['audit_log'] as Row[]
    expect(rows.length).toBe(0)
  })

  it('does NOT insert for SKIP_PATHS (/api/push)', async () => {
    const res = await request(makeApp()).post('/api/push/subscribe').send({})

    expect(res.status).toBe(200)
    await waitForFinish()

    const rows = store.tables['audit_log'] as Row[]
    expect(rows.length).toBe(0)
  })
})
