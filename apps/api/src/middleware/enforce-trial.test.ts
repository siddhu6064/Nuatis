import { describe, it, expect, jest, beforeAll, beforeEach } from '@jest/globals'
import { config } from 'dotenv'
import { resolve } from 'path'
import express from 'express'
import request from 'supertest'
import { mintTestToken } from '../routes/__test-support__/jwt.js'

config({ path: resolve(process.cwd(), '.env') })

beforeAll(() => {
  process.env['AUTH_SECRET'] = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
})

const SECRET = () => process.env['AUTH_SECRET'] as string
const TENANT = 'aaaaaaaa-0000-0000-0000-000000000001'
const TRIAL_ENDED_AT = '2026-06-29T00:00:00.000Z'

// Controllable trial-cache mock — enforce-trial imports ../lib/trial-cache.js
const getTrialExpiredMock = jest.fn<(tenantId: string) => Promise<boolean>>()
jest.unstable_mockModule('../lib/trial-cache.js', () => ({
  getTrialExpired: getTrialExpiredMock,
  getCachedTrialEndsAt: () => TRIAL_ENDED_AT,
  getCachedReadOnlyReason: () => 'trial_expired',
  invalidateTrialCache: () => undefined,
}))

// Dynamic import AFTER the trial-cache mock; everything else is static.
const { enforceTrial } = await import('./enforce-trial.js')

const app = express()
app.use(express.json())
app.use('/api', enforceTrial)
app.all('/api/*', (_req, res) => {
  res.json({ ok: true })
})

async function token(): Promise<string> {
  return mintTestToken({ sub: 'user-1', tenantId: TENANT, role: 'owner' }, { secret: SECRET() })
}

beforeEach(() => {
  getTrialExpiredMock.mockReset()
})

describe('enforceTrial', () => {
  it('GET passes when expired (read-only, not locked out)', async () => {
    getTrialExpiredMock.mockResolvedValue(true)
    const res = await request(app)
      .get('/api/contacts')
      .set('Authorization', `Bearer ${await token()}`)
    expect(res.status).toBe(200)
  })

  it('POST 402s when expired, with the read-only body', async () => {
    getTrialExpiredMock.mockResolvedValue(true)
    const res = await request(app)
      .post('/api/contacts')
      .set('Authorization', `Bearer ${await token()}`)
      .send({})
    expect(res.status).toBe(402)
    expect(res.body).toEqual({
      error: 'Trial ended',
      reason: 'trial_expired',
      trial_ended_at: TRIAL_ENDED_AT,
      upgrade_url: '/pricing',
      read_only: true,
    })
  })

  it('POST passes when not expired', async () => {
    getTrialExpiredMock.mockResolvedValue(false)
    const res = await request(app)
      .post('/api/contacts')
      .set('Authorization', `Bearer ${await token()}`)
      .send({})
    expect(res.status).toBe(200)
  })

  it('POST passes with no token — requireAuth downstream stays authoritative', async () => {
    getTrialExpiredMock.mockResolvedValue(true)
    const res = await request(app).post('/api/contacts').send({})
    expect(res.status).toBe(200)
    expect(getTrialExpiredMock).not.toHaveBeenCalled()
  })

  it('POST passes with a garbage token (fail open)', async () => {
    getTrialExpiredMock.mockResolvedValue(true)
    const res = await request(app)
      .post('/api/contacts')
      .set('Authorization', 'Bearer not-a-jwt')
      .send({})
    expect(res.status).toBe(200)
    expect(getTrialExpiredMock).not.toHaveBeenCalled()
  })

  const EXEMPT = [
    '/api/billing/checkout',
    '/api/auth/mobile/login',
    '/api/webhooks/stripe',
    '/api/webhooks/email',
    '/api/webhooks/email-inbound',
    '/api/settings/data-export',
  ]
  for (const path of EXEMPT) {
    it(`exempt: POST ${path} passes while expired`, async () => {
      getTrialExpiredMock.mockResolvedValue(true)
      const res = await request(app)
        .post(path)
        .set('Authorization', `Bearer ${await token()}`)
        .send({})
      expect(res.status).toBe(200)
    })
  }

  it('POST /api/webhooks (tenant webhook CRUD) is BLOCKED while expired', async () => {
    getTrialExpiredMock.mockResolvedValue(true)
    const res = await request(app)
      .post('/api/webhooks')
      .set('Authorization', `Bearer ${await token()}`)
      .send({})
    expect(res.status).toBe(402)
  })
})
