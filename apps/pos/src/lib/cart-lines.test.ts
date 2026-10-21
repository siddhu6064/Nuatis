import { cartTotals, type CartLine } from '@nuatis/pos-core'
import {
  toCartLine,
  isSameLine,
  addLine,
  setQuantity,
  removeLine,
  unsatisfiedGroups,
  canAddDirectly,
  type MenuItemDto,
  type MenuOptionDto,
} from './cart-lines'

function option(id: string, name = id, delta = '0.00'): MenuOptionDto {
  return { id, name, price_delta: delta, sort_order: 0 }
}

function item(overrides: Partial<MenuItemDto> = {}): MenuItemDto {
  return {
    id: 'item-1',
    name: 'Classic Burger',
    price: '12.00',
    taxable: true,
    kitchen_station: 'grill',
    available: true,
    sort_order: 0,
    modifier_groups: [],
    ...overrides,
  }
}

const TEMP_GROUP = {
  id: 'grp-temp',
  name: 'Temperature',
  min_select: 1,
  max_select: 1,
  required: true,
  options: [option('opt-rare', 'Rare'), option('opt-med', 'Medium')],
}

const ADDON_GROUP = {
  id: 'grp-add',
  name: 'Add-ons',
  min_select: 0,
  max_select: 4,
  required: false,
  options: [option('opt-cheese', 'Cheddar', '1.50'), option('opt-bacon', 'Bacon', '2.50')],
}

describe('toCartLine', () => {
  it('converts the numeric-string price to cents', () => {
    expect(toCartLine(item()).unitPriceCents).toBe(1200)
  })

  it('converts modifier price deltas to cents', () => {
    const line = toCartLine(item(), [option('opt-cheese', 'Cheddar', '1.50')])
    expect(line.modifiers[0]?.priceDeltaCents).toBe(150)
  })

  it('carries the taxable flag through', () => {
    expect(toCartLine(item({ taxable: false })).taxable).toBe(false)
  })

  it('defaults to quantity 1', () => {
    expect(toCartLine(item()).quantity).toBe(1)
  })
})

describe('isSameLine', () => {
  it('matches identical plain lines', () => {
    expect(isSameLine(toCartLine(item()), toCartLine(item()))).toBe(true)
  })

  it('does not match different items', () => {
    expect(isSameLine(toCartLine(item()), toCartLine(item({ id: 'item-2' })))).toBe(false)
  })

  it('does not match the same item with different modifiers', () => {
    const plain = toCartLine(item())
    const withCheese = toCartLine(item(), [option('opt-cheese')])
    expect(isSameLine(plain, withCheese)).toBe(false)
  })

  it('ignores the order modifiers were chosen in', () => {
    const a = toCartLine(item(), [option('opt-cheese'), option('opt-bacon')])
    const b = toCartLine(item(), [option('opt-bacon'), option('opt-cheese')])
    expect(isSameLine(a, b)).toBe(true)
  })

  it('does not match a subset of modifiers', () => {
    const one = toCartLine(item(), [option('opt-cheese')])
    const two = toCartLine(item(), [option('opt-cheese'), option('opt-bacon')])
    expect(isSameLine(one, two)).toBe(false)
  })
})

describe('addLine', () => {
  it('appends the first line', () => {
    expect(addLine([], toCartLine(item()))).toHaveLength(1)
  })

  it('increments rather than duplicating an identical line', () => {
    const lines = addLine(addLine([], toCartLine(item())), toCartLine(item()))
    expect(lines).toHaveLength(1)
    expect(lines[0]?.quantity).toBe(2)
  })

  it('keeps the same item with different modifiers as a separate line', () => {
    const lines = addLine(
      addLine([], toCartLine(item())),
      toCartLine(item(), [option('opt-cheese')])
    )
    expect(lines).toHaveLength(2)
  })

  it('does not mutate the array it was given', () => {
    const original: CartLine[] = [toCartLine(item())]
    const copy = [...original]
    addLine(original, toCartLine(item({ id: 'item-2' })))
    expect(original).toEqual(copy)
  })
})

describe('setQuantity', () => {
  it('sets a quantity', () => {
    const lines = setQuantity([toCartLine(item())], 0, 5)
    expect(lines[0]?.quantity).toBe(5)
  })

  it('removes the line at zero — a till has no zero-quantity line', () => {
    expect(setQuantity([toCartLine(item())], 0, 0)).toHaveLength(0)
  })

  it('removes the line on a negative quantity too', () => {
    expect(setQuantity([toCartLine(item())], 0, -3)).toHaveLength(0)
  })

  it('ignores an out-of-range index rather than throwing', () => {
    const lines = [toCartLine(item())]
    expect(setQuantity(lines, 9, 2)).toEqual(lines)
  })
})

describe('removeLine', () => {
  it('removes only the named line', () => {
    const lines = [toCartLine(item()), toCartLine(item({ id: 'item-2' }))]
    const after = removeLine(lines, 0)
    expect(after).toHaveLength(1)
    expect(after[0]?.menuItemId).toBe('item-2')
  })
})

describe('unsatisfiedGroups', () => {
  it('is empty for an item with no modifier groups', () => {
    expect(unsatisfiedGroups(item(), [])).toHaveLength(0)
  })

  it('reports a required group with nothing chosen', () => {
    const withTemp = item({ modifier_groups: [TEMP_GROUP] })
    expect(unsatisfiedGroups(withTemp, [])).toHaveLength(1)
  })

  it('is satisfied once the required group has a choice', () => {
    const withTemp = item({ modifier_groups: [TEMP_GROUP] })
    expect(unsatisfiedGroups(withTemp, [option('opt-rare')])).toHaveLength(0)
  })

  it('does not require an optional group', () => {
    const withAddons = item({ modifier_groups: [ADDON_GROUP] })
    expect(unsatisfiedGroups(withAddons, [])).toHaveLength(0)
  })

  it('treats required with min_select 0 as needing at least one', () => {
    // The schema allows required=true alongside min_select=0; a required group
    // that accepts nothing is meaningless, so one choice is the floor.
    const odd = item({
      modifier_groups: [{ ...TEMP_GROUP, min_select: 0, required: true }],
    })
    expect(unsatisfiedGroups(odd, [])).toHaveLength(1)
  })

  it('honours a min_select above one', () => {
    const pickTwo = item({
      modifier_groups: [{ ...ADDON_GROUP, min_select: 2, required: true }],
    })
    expect(unsatisfiedGroups(pickTwo, [option('opt-cheese')])).toHaveLength(1)
    expect(unsatisfiedGroups(pickTwo, [option('opt-cheese'), option('opt-bacon')])).toHaveLength(0)
  })

  it('ignores options that do not belong to the group', () => {
    const withTemp = item({ modifier_groups: [TEMP_GROUP] })
    expect(unsatisfiedGroups(withTemp, [option('opt-from-elsewhere')])).toHaveLength(1)
  })
})

describe('canAddDirectly', () => {
  it('is true for a plain item', () => {
    expect(canAddDirectly(item())).toBe(true)
  })

  it('is false when a required group must be chosen first', () => {
    expect(canAddDirectly(item({ modifier_groups: [TEMP_GROUP] }))).toBe(false)
  })

  it('is true when the only group is optional', () => {
    expect(canAddDirectly(item({ modifier_groups: [ADDON_GROUP] }))).toBe(true)
  })
})

describe('totals over built lines', () => {
  it('prices a cart the way the receipt will', () => {
    // Burger 12.00 + cheddar 1.50, times 2 = 27.00; fries 4.50 = 31.50.
    // Tax at 8.75% on the whole taxable base = 2.7562… → 276 cents.
    const lines = addLine(
      addLine([], toCartLine(item(), [option('opt-cheese', 'Cheddar', '1.50')], 2)),
      toCartLine(item({ id: 'item-fries', name: 'Fries', price: '4.50' }))
    )
    const totals = cartTotals(lines, 875, 0)

    expect(totals.subtotalCents).toBe(3150)
    expect(totals.taxCents).toBe(276)
    expect(totals.totalCents).toBe(3426)
  })

  it('excludes a non-taxable item from tax but not from the subtotal', () => {
    const lines = addLine(
      addLine([], toCartLine(item({ price: '10.00' }))),
      toCartLine(item({ id: 'gc', name: 'Gift Card', price: '25.00', taxable: false }))
    )
    const totals = cartTotals(lines, 1000, 0)

    expect(totals.subtotalCents).toBe(3500)
    expect(totals.taxCents).toBe(100) // 10% of the taxable 10.00 only
    expect(totals.totalCents).toBe(3600)
  })
})
