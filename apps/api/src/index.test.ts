import request from 'supertest'
import app from './index.js'

describe('API health check', () => {
  it('GET /health returns 200 with status ok', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    expect(res.body.service).toBe('nuatis-api')
  })

  it('GET / returns 200', async () => {
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
  })
})
