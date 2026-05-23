import { describe, it, expect, beforeAll } from '@jest/globals'

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

describe('webhook helpers — customerIdOf', () => {
  it('handles string and object Stripe expand forms', async () => {
    const { customerIdOf } = await import('./stripe-billing-webhooks.js')
    expect(customerIdOf('cus_123')).toBe('cus_123')
    expect(customerIdOf({ id: 'cus_456' })).toBe('cus_456')
    expect(customerIdOf(null)).toBeNull()
    expect(customerIdOf(undefined)).toBeNull()
  })
})

describe('webhook helpers — unixToIso', () => {
  it('converts unix seconds to ISO; returns null for null/0', async () => {
    const { unixToIso } = await import('./stripe-billing-webhooks.js')
    expect(unixToIso(1_700_000_000)).toBe(new Date(1_700_000_000 * 1000).toISOString())
    expect(unixToIso(null)).toBeNull()
    expect(unixToIso(undefined)).toBeNull()
    expect(unixToIso(0)).toBeNull()
  })
})

describe('webhook helpers — resolveInvoiceSubscriptionId', () => {
  it('prefers legacy top-level subscription field', async () => {
    const { resolveInvoiceSubscriptionId } = await import('./stripe-billing-webhooks.js')
    expect(
      resolveInvoiceSubscriptionId({
        id: 'in_1',
        customer: 'cus_1',
        subscription: 'sub_legacy',
      })
    ).toBe('sub_legacy')
  })

  it('falls back to v22 nested subscription_details', async () => {
    const { resolveInvoiceSubscriptionId } = await import('./stripe-billing-webhooks.js')
    expect(
      resolveInvoiceSubscriptionId({
        id: 'in_2',
        customer: 'cus_2',
        parent: {
          subscription_details: { subscription: 'sub_v22' },
        },
      })
    ).toBe('sub_v22')
  })

  it('returns null when no subscription reference present', async () => {
    const { resolveInvoiceSubscriptionId } = await import('./stripe-billing-webhooks.js')
    expect(resolveInvoiceSubscriptionId({ id: 'in_3', customer: 'cus_3' })).toBeNull()
  })
})

describe('webhook helpers — identifyPlanAndOverageItem', () => {
  it('identifies the plan from the recurring price ID + the metered item', async () => {
    const { identifyPlanAndOverageItem } = await import('./stripe-billing-webhooks.js')
    const result = identifyPlanAndOverageItem({
      id: 'sub_1',
      status: 'trialing',
      customer: 'cus_1',
      current_period_end: 0,
      trial_end: 0,
      items: {
        data: [
          { id: 'si_base', price: { id: 'price_pro_m', recurring: { usage_type: 'licensed' } } },
          { id: 'si_meter', price: { id: 'price_pro_o', recurring: { usage_type: 'metered' } } },
        ],
      },
    })
    expect(result.planKey).toBe('pro')
    expect(result.overageItemId).toBe('si_meter')
  })

  it('returns no overage item for Scale (no metered line)', async () => {
    const { identifyPlanAndOverageItem } = await import('./stripe-billing-webhooks.js')
    const result = identifyPlanAndOverageItem({
      id: 'sub_2',
      status: 'active',
      customer: 'cus_2',
      current_period_end: 0,
      trial_end: 0,
      items: {
        data: [
          { id: 'si_base', price: { id: 'price_scale_m', recurring: { usage_type: 'licensed' } } },
        ],
      },
    })
    expect(result.planKey).toBe('scale')
    expect(result.overageItemId).toBeNull()
  })

  it('returns null planKey for unrecognized price IDs', async () => {
    const { identifyPlanAndOverageItem } = await import('./stripe-billing-webhooks.js')
    const result = identifyPlanAndOverageItem({
      id: 'sub_3',
      status: 'active',
      customer: 'cus_3',
      current_period_end: 0,
      trial_end: 0,
      items: {
        data: [{ id: 'si_x', price: { id: 'price_unknown' } }],
      },
    })
    expect(result.planKey).toBeNull()
  })
})
