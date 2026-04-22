import { describe, it, expect } from '@jest/globals'
import { validateInventoryCreate, applyQuantityAdjustment } from './inventory-logic.js'

describe('validateInventoryCreate', () => {
  it('accepts a minimal valid body', () => {
    const result = validateInventoryCreate({ name: 'Gloves', quantity: 10 })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.name).toBe('Gloves')
      expect(result.quantity).toBe(10)
      expect(result.unit).toBe('each')
      expect(result.reorder_threshold).toBe(5)
    }
  })

  it('rejects missing name with error "name is required"', () => {
    const result = validateInventoryCreate({ quantity: 10 })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('name is required')
  })

  it('rejects negative quantity', () => {
    const result = validateInventoryCreate({ name: 'Gloves', quantity: -1 })
    expect(result.ok).toBe(false)
  })

  it('rejects missing quantity', () => {
    const result = validateInventoryCreate({ name: 'Gloves' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/quantity/i)
  })

  it('rejects invalid unit', () => {
    const result = validateInventoryCreate({
      name: 'Gloves',
      quantity: 10,
      unit: 'pallets',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/unit/i)
  })
})

describe('applyQuantityAdjustment', () => {
  it('positive delta increases quantity', () => {
    const result = applyQuantityAdjustment(10, 5)
    expect(result.newQuantity).toBe(15)
    expect(result.clamped).toBe(false)
  })

  it('negative delta within stock decreases without clamp', () => {
    const result = applyQuantityAdjustment(10, -3)
    expect(result.newQuantity).toBe(7)
    expect(result.clamped).toBe(false)
  })

  it('negative delta larger than stock clamps at 0 and flags clamped', () => {
    const result = applyQuantityAdjustment(2, -10)
    expect(result.newQuantity).toBe(0)
    expect(result.clamped).toBe(true)
  })

  it('zero-result delta is not flagged as clamped', () => {
    const result = applyQuantityAdjustment(5, -5)
    expect(result.newQuantity).toBe(0)
    expect(result.clamped).toBe(false)
  })
})
