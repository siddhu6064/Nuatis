import { describe, it, expect } from '@jest/globals'
import { SEEDED_TYPES } from './incident-types.js'

describe('seeded incident types', () => {
  it('gives a restaurant the reasons a till actually needs', () => {
    const keys = SEEDED_TYPES['restaurant']!.map((t) => t.key)
    expect(keys).toEqual(
      expect.arrayContaining(['wrong_item', 'allergy', 'dropped', 'late', 'equipment'])
    )
  })

  it('has a default set for a vertical with no specific list', () => {
    expect(SEEDED_TYPES['default']!.length).toBeGreaterThan(0)
  })

  it('marks allergy critical — it is the one that ends up in a newspaper', () => {
    const allergy = SEEDED_TYPES['restaurant']!.find((t) => t.key === 'allergy')
    expect(allergy?.default_severity).toBe('critical')
  })

  it('marks wastage as always carrying a cost', () => {
    const dropped = SEEDED_TYPES['restaurant']!.find((t) => t.key === 'dropped')
    expect(dropped?.requires_cost).toBe(true)
  })

  it('uses keys that are stable identifiers, not labels', () => {
    for (const list of Object.values(SEEDED_TYPES)) {
      for (const t of list) {
        expect(t.key).toMatch(/^[a-z][a-z0-9_]*$/)
      }
    }
  })
})
