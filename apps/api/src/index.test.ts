// Bind Express to a random free port so this suite can coexist with a dev
// server already listening on :3001 (src/index.ts calls server.listen()
// unconditionally at module load). Must be set BEFORE ./index.js is
// imported — hence the dynamic import inside each test rather than a
// static top-level import.
process.env['PORT'] = '0'

import { describe, it, expect, jest } from '@jest/globals'
import request from 'supertest'

// Dynamic import of ./index.js triggers server.listen() + startWorkers() at
// module-load time. GET /health also performs live Supabase + Redis pings
// whose DNS lookups can cost several seconds under parallel-worker load.
// 30s gives enough headroom.
jest.setTimeout(60000)

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
