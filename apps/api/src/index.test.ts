// Bind Express to a random free port so this suite can coexist with a dev
// server already listening on :3001 (src/index.ts calls server.listen()
// unconditionally at module load). Must be set BEFORE ./index.js is
// imported — hence the dynamic import inside each test rather than a
// static top-level import.
process.env['PORT'] = '0'
// Avoid /health hanging on DNS when a parallel suite in the same Jest
// worker has pre-set SUPABASE_URL to a non-resolvable test host. health.ts
// short-circuits to `false` when either env var is missing.
delete process.env['SUPABASE_URL']
delete process.env['SUPABASE_SERVICE_ROLE_KEY']
// REDIS_URL similarly — checkRedis short-circuits when unset.
delete process.env['REDIS_URL']

import { describe, it, expect, jest } from '@jest/globals'
import request from 'supertest'

// Dynamic import of ./index.js triggers server.listen() + startWorkers() at
// module-load time. GET /health also performs a live Supabase + Redis ping
// whose DNS lookups can each take several seconds when the env points at a
// non-resolvable host. 30s gives enough headroom under parallel-worker load.
jest.setTimeout(30000)

describe('API health check', () => {
  it('GET /health returns 200 with status ok', async () => {
    const app = (await import('./index.js')).default
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('healthy')
    expect(res.body.version).toBe('1.0.0')
    expect(res.body.services).toBeDefined()
  })

  it('GET / returns 200', async () => {
    const app = (await import('./index.js')).default
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
  })
})
