import request from 'supertest'
import app from './index.js'

describe('API health check', () => {
  it('GET /health returns 200 with status ok', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('healthy')
    expect(res.body.version).toBe('1.0.0')
    expect(res.body.services).toBeDefined()
  })

  it('GET / returns 200', async () => {
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
  })
})
