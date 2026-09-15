import { describe, it, expect } from '@jest/globals'
import { defaultEntitlement, TIER_GATED } from './stripe-plans.js'
import { VALID_MODULE_IDS, getModuleDef } from './module-registry.js'

describe('pos module registration', () => {
  it('is a valid module id', () => {
    expect(VALID_MODULE_IDS).toContain('pos')
  })

  it('has a module definition', () => {
    const def = getModuleDef('pos')
    expect(def).toBeDefined()
    expect(def?.defaultOn).toBe(false)
  })

  it('is tier-gated, not a base-suite freebie', () => {
    expect(TIER_GATED.has('pos')).toBe(true)
  })
})

describe('pos_only product', () => {
  it('grants pos', () => {
    expect(defaultEntitlement('pos', null, 'pos_only')).toBe(true)
  })

  it('grants crm — POS needs a customer record for receipts and gift cards', () => {
    expect(defaultEntitlement('crm', null, 'pos_only')).toBe(true)
  })

  it('does NOT grant maya', () => {
    expect(defaultEntitlement('maya', null, 'pos_only')).toBe(false)
  })

  it('does NOT grant scheduling', () => {
    expect(defaultEntitlement('scheduling', null, 'pos_only')).toBe(false)
  })

  it('does not leak pos to a suite tenant on a plan that omits it', () => {
    expect(defaultEntitlement('pos', 'core', 'suite')).toBe(false)
  })

  it('grants pos to a suite tenant on the scale plan', () => {
    expect(defaultEntitlement('pos', 'scale', 'suite')).toBe(true)
  })

  it('still restricts maya_only to maya', () => {
    expect(defaultEntitlement('pos', null, 'maya_only')).toBe(false)
    expect(defaultEntitlement('maya', null, 'maya_only')).toBe(true)
  })
})
