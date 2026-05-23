import { describe, it, expect, beforeAll } from '@jest/globals'
import express from 'express'
import request from 'supertest'

beforeAll(() => {
  process.env['NODE_ENV'] = 'test'
  process.env['STRIPE_PRICE_CORE_MONTHLY'] = 'price_core_m'
  process.env['STRIPE_PRICE_CORE_ANNUAL'] = 'price_core_y'
  process.env['STRIPE_PRICE_CORE_OVERAGE'] = 'price_core_o'
  process.env['STRIPE_PRICE_PRO_MONTHLY'] = 'price_pro_m'
  process.env['STRIPE_PRICE_PRO_ANNUAL'] = 'price_pro_y'
  process.env['STRIPE_PRICE_PRO_OVERAGE'] = 'price_pro_o'
  process.env['STRIPE_PRICE_SCALE_MONTHLY'] = 'price_scale_m'
  process.env['STRIPE_PRICE_SCALE_ANNUAL'] = 'price_scale_y'
})

describe('GET /api/billing/plans', () => {
  it('returns all three plans with the required public fields', async () => {
    const billingRouter = (await import('./billing.js')).default
    const app = express()
    app.use(express.json())
    app.use('/api/billing', billingRouter)

    const res = await request(app).get('/api/billing/plans')

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.plans)).toBe(true)
    expect(res.body.plans).toHaveLength(3)

    const byKey = Object.fromEntries(
      (res.body.plans as Array<{ key: string }>).map((p) => [p.key, p])
    )

    expect(byKey['core']).toMatchObject({
      key: 'core',
      name: 'Core',
      monthly_price_cents: 14_900,
      annual_price_cents: 149_000,
      maya_minutes: 300,
      overage_rate: 0.05,
    })
    expect(byKey['pro']).toMatchObject({
      key: 'pro',
      monthly_price_cents: 29_900,
      maya_minutes: 600,
      overage_rate: 0.04,
    })
    expect(byKey['scale']).toMatchObject({
      key: 'scale',
      maya_minutes: null,
      overage_rate: null,
    })

    // Module list must be present and non-empty for each plan
    expect(byKey['core']?.modules?.length).toBeGreaterThan(0)
    expect(byKey['pro']?.modules?.length).toBeGreaterThan(byKey['core']?.modules?.length)
    expect(byKey['scale']?.modules?.length).toBeGreaterThan(byKey['pro']?.modules?.length)
  })

  it('is publicly accessible — no auth header required', async () => {
    const billingRouter = (await import('./billing.js')).default
    const app = express()
    app.use(express.json())
    app.use('/api/billing', billingRouter)

    const res = await request(app).get('/api/billing/plans')
    expect(res.status).toBe(200)
  })
})
