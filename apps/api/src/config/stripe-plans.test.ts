import { describe, it, expect, beforeAll } from '@jest/globals'

// Set price-ID env vars BEFORE importing the module — values are
// captured at module load time.
beforeAll(() => {
  process.env['STRIPE_PRICE_CORE_MONTHLY'] = 'price_core_m'
  process.env['STRIPE_PRICE_CORE_ANNUAL'] = 'price_core_y'
  process.env['STRIPE_PRICE_CORE_OVERAGE'] = 'price_core_o'
  process.env['STRIPE_PRICE_PRO_MONTHLY'] = 'price_pro_m'
  process.env['STRIPE_PRICE_PRO_ANNUAL'] = 'price_pro_y'
  process.env['STRIPE_PRICE_PRO_OVERAGE'] = 'price_pro_o'
  process.env['STRIPE_PRICE_SCALE_MONTHLY'] = 'price_scale_m'
  process.env['STRIPE_PRICE_SCALE_ANNUAL'] = 'price_scale_y'
})

describe('stripe-plans — module mapping', () => {
  it('Core: maya, crm, scheduling, appointments, pipeline', async () => {
    const { PLANS } = await import('./stripe-plans.js')
    expect(PLANS.core.modules).toEqual(
      expect.arrayContaining(['maya', 'crm', 'scheduling', 'appointments', 'pipeline'])
    )
    expect(PLANS.core.modules).not.toContain('automation')
    expect(PLANS.core.modules).not.toContain('insights')
    expect(PLANS.core.modules).not.toContain('campaigns')
    expect(PLANS.core.modules).not.toContain('cpq')
  })

  it('Pro: Core modules + automation, insights, campaigns', async () => {
    const { PLANS } = await import('./stripe-plans.js')
    expect(PLANS.pro.modules).toEqual(
      expect.arrayContaining([
        'maya',
        'crm',
        'scheduling',
        'appointments',
        'pipeline',
        'automation',
        'insights',
        'campaigns',
      ])
    )
    expect(PLANS.pro.modules).not.toContain('cpq')
  })

  it('Scale: Pro modules + cpq', async () => {
    const { PLANS } = await import('./stripe-plans.js')
    expect(PLANS.scale.modules).toEqual(
      expect.arrayContaining([
        'maya',
        'crm',
        'scheduling',
        'appointments',
        'pipeline',
        'automation',
        'insights',
        'campaigns',
        'cpq',
      ])
    )
  })
})

describe('stripe-plans — pricing', () => {
  it('uses cents convention and matches locked tier prices', async () => {
    const { PLANS } = await import('./stripe-plans.js')
    expect(PLANS.core.monthlyPrice).toBe(14_900)
    expect(PLANS.core.annualPrice).toBe(149_000)
    expect(PLANS.pro.monthlyPrice).toBe(29_900)
    expect(PLANS.pro.annualPrice).toBe(299_000)
    expect(PLANS.scale.monthlyPrice).toBe(49_900)
    expect(PLANS.scale.annualPrice).toBe(499_000)
  })

  it('Annual is 10x monthly — i.e. 2 months free', async () => {
    const { PLANS } = await import('./stripe-plans.js')
    expect(PLANS.core.annualPrice).toBe(PLANS.core.monthlyPrice * 10)
    expect(PLANS.pro.annualPrice).toBe(PLANS.pro.monthlyPrice * 10)
    expect(PLANS.scale.annualPrice).toBe(PLANS.scale.monthlyPrice * 10)
  })
})

describe('stripe-plans — overage config', () => {
  it('Scale has unlimited Maya minutes (null) and no overage rate (null)', async () => {
    const { PLANS } = await import('./stripe-plans.js')
    expect(PLANS.scale.mayaMinutes).toBeNull()
    expect(PLANS.scale.overageRate).toBeNull()
    expect(PLANS.scale.stripeOveragePriceId).toBeNull()
  })

  it('Core/Pro define included minutes + overage rate', async () => {
    const { PLANS } = await import('./stripe-plans.js')
    expect(PLANS.core.mayaMinutes).toBe(300)
    expect(PLANS.core.overageRate).toBe(0.05)
    expect(PLANS.pro.mayaMinutes).toBe(600)
    expect(PLANS.pro.overageRate).toBe(0.04)
  })
})

describe('stripe-plans — planKeyFromPriceId', () => {
  it('matches monthly, annual, and overage IDs', async () => {
    const { planKeyFromPriceId } = await import('./stripe-plans.js')
    expect(planKeyFromPriceId('price_core_m')).toBe('core')
    expect(planKeyFromPriceId('price_core_y')).toBe('core')
    expect(planKeyFromPriceId('price_core_o')).toBe('core')
    expect(planKeyFromPriceId('price_pro_m')).toBe('pro')
    expect(planKeyFromPriceId('price_scale_y')).toBe('scale')
  })

  it('returns null for unknown IDs and empty string', async () => {
    const { planKeyFromPriceId } = await import('./stripe-plans.js')
    expect(planKeyFromPriceId('price_unknown')).toBeNull()
    expect(planKeyFromPriceId('')).toBeNull()
  })
})

describe('stripe-plans — modulesForPlan', () => {
  it('returns JSONB-shaped object with each module set to true', async () => {
    const { modulesForPlan } = await import('./stripe-plans.js')
    const coreMods = modulesForPlan('core')
    expect(coreMods).toEqual({
      maya: true,
      crm: true,
      scheduling: true,
      appointments: true,
      pipeline: true,
    })
  })

  it('Scale includes cpq=true', async () => {
    const { modulesForPlan } = await import('./stripe-plans.js')
    expect(modulesForPlan('scale').cpq).toBe(true)
  })
})
