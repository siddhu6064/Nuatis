import { describe, it, expect } from '@jest/globals'
import { defaultEntitlement } from '../config/stripe-plans.js'

describe('incidents entitlement', () => {
  it('is included on the scale plan', () => {
    expect(defaultEntitlement('incidents', 'scale', 'suite')).toBe(true)
  })

  it('is not included on core', () => {
    expect(defaultEntitlement('incidents', 'core', 'suite')).toBe(false)
  })

  it('is NOT implied by pos_only — the tracker is the upsell', () => {
    expect(defaultEntitlement('incidents', 'scale', 'pos_only')).toBe(false)
    // The register itself still works.
    expect(defaultEntitlement('pos', 'scale', 'pos_only')).toBe(true)
  })

  it('is not granted to a maya_only tenant', () => {
    expect(defaultEntitlement('incidents', 'scale', 'maya_only')).toBe(false)
  })
})
