import {
  formatMoney,
  parsePriceInput,
  itemPayload,
  groupPayload,
  optionPayload,
  describeGroupRule,
  type ItemFormValues,
} from './menu-admin'

function form(over: Partial<ItemFormValues> = {}): ItemFormValues {
  return {
    name: 'Classic Burger',
    price: '12.00',
    taxable: true,
    kitchenStation: 'grill',
    available: true,
    sortOrder: '0',
    ...over,
  }
}

describe('parsePriceInput', () => {
  it('reads dollars as a two-decimal number, which is what the API stores', () => {
    expect(parsePriceInput('12')).toBe(12)
    expect(parsePriceInput('12.5')).toBe(12.5)
    expect(parsePriceInput('0')).toBe(0)
  })

  it('tolerates a leading dollar sign and surrounding space', () => {
    expect(parsePriceInput(' $12.00 ')).toBe(12)
  })

  it('rejects anything that is not a price', () => {
    expect(parsePriceInput('')).toBeNull()
    expect(parsePriceInput('free')).toBeNull()
    expect(parsePriceInput('12.34.56')).toBeNull()
    expect(parsePriceInput('-1')).toBeNull()
  })

  it('rounds to the cent rather than sending a fraction of one', () => {
    // numeric(10,2) would round this on the way in anyway; doing it here means
    // the form shows the merchant the price that will actually be stored.
    expect(parsePriceInput('12.345')).toBe(12.35)
  })
})

describe('itemPayload', () => {
  it('sends the fields the API names, not the form field names', () => {
    expect(itemPayload('cat-1', form())).toEqual({
      category_id: 'cat-1',
      name: 'Classic Burger',
      price: 12,
      taxable: true,
      kitchen_station: 'grill',
      available: true,
      sort_order: 0,
    })
  })

  it('sends a null station rather than an empty string when none is chosen', () => {
    // kitchen_station is the KDS routing key; '' would route a ticket to a
    // station board that does not exist, so the item would be cooked by nobody.
    expect(itemPayload('cat-1', form({ kitchenStation: '' }))!.kitchen_station).toBeNull()
  })

  it('trims the name', () => {
    expect(itemPayload('cat-1', form({ name: '  Fries  ' }))!.name).toBe('Fries')
  })

  it('treats a blank sort order as zero', () => {
    expect(itemPayload('cat-1', form({ sortOrder: '' }))!.sort_order).toBe(0)
  })

  it('returns null when the name is blank, so the form can refuse', () => {
    expect(itemPayload('cat-1', form({ name: '   ' }))).toBeNull()
  })

  it('returns null when the price is not a price', () => {
    expect(itemPayload('cat-1', form({ price: 'ask' }))).toBeNull()
  })
})

describe('groupPayload', () => {
  it('sends the group with its selection bounds', () => {
    expect(
      groupPayload({ name: 'Temperature', minSelect: '1', maxSelect: '1', required: true })
    ).toEqual({ name: 'Temperature', min_select: 1, max_select: 1, required: true })
  })

  it('refuses a max below the min, which no choice could satisfy', () => {
    expect(
      groupPayload({ name: 'Extras', minSelect: '2', maxSelect: '1', required: false })
    ).toBeNull()
  })

  it('refuses a required group that permits zero choices', () => {
    expect(
      groupPayload({ name: 'Extras', minSelect: '0', maxSelect: '0', required: true })
    ).toBeNull()
  })

  it('refuses a blank name', () => {
    expect(groupPayload({ name: ' ', minSelect: '0', maxSelect: '1', required: false })).toBeNull()
  })
})

describe('optionPayload', () => {
  it('sends the option with its price delta', () => {
    expect(optionPayload('grp-1', { name: 'Bacon', priceDelta: '1.50', sortOrder: '2' })).toEqual({
      group_id: 'grp-1',
      name: 'Bacon',
      price_delta: 1.5,
      sort_order: 2,
    })
  })

  it('treats a blank price delta as free rather than refusing', () => {
    // Most options are preparation choices at no charge; making the merchant
    // type 0.00 for every one of them is friction with no purpose.
    expect(optionPayload('grp-1', { name: 'Medium rare', priceDelta: '', sortOrder: '' })).toEqual({
      group_id: 'grp-1',
      name: 'Medium rare',
      price_delta: 0,
      sort_order: 0,
    })
  })

  it('refuses a blank name', () => {
    expect(optionPayload('grp-1', { name: '', priceDelta: '1.00', sortOrder: '0' })).toBeNull()
  })

  it('refuses a negative delta — that is a discount, not a modifier', () => {
    expect(
      optionPayload('grp-1', { name: 'Bacon', priceDelta: '-1.00', sortOrder: '0' })
    ).toBeNull()
  })
})

describe('describeGroupRule', () => {
  it('describes a required single choice', () => {
    expect(describeGroupRule({ min_select: 1, max_select: 1, required: true })).toBe('Choose 1')
  })

  it('describes an optional range', () => {
    expect(describeGroupRule({ min_select: 0, max_select: 3, required: false })).toBe('Up to 3')
  })

  it('describes a required range', () => {
    expect(describeGroupRule({ min_select: 1, max_select: 3, required: true })).toBe(
      'Choose 1 to 3'
    )
  })
})

describe('formatMoney', () => {
  it('always shows two decimals, whatever the API sent', () => {
    // Postgres numeric comes back as a string, and the driver does not promise
    // trailing zeros — a live menu rendered "$12", "$15.5" and "+$1.5", which
    // reads as a typo on a price list a merchant is checking.
    expect(formatMoney('12')).toBe('12.00')
    expect(formatMoney('15.5')).toBe('15.50')
    expect(formatMoney('4.50')).toBe('4.50')
  })

  it('rounds to the cent', () => {
    expect(formatMoney('12.345')).toBe('12.35')
  })

  it('shows zero as 0.00 rather than blank', () => {
    expect(formatMoney('0')).toBe('0.00')
  })

  it('passes an unparseable value straight through instead of printing NaN', () => {
    expect(formatMoney('')).toBe('')
    expect(formatMoney('n/a')).toBe('n/a')
  })
})

describe('numeric columns arrive as numbers, not strings', () => {
  // Postgres numeric is typed as a string in the DTOs, but supabase-js hands
  // these back as JS numbers. Typing alone cannot catch that — the compiler
  // believed the annotation — and the first render of the menu threw
  // "value.trim is not a function". Both entry points take either.

  it('formats a numeric price', () => {
    expect(formatMoney(12 as unknown as string)).toBe('12.00')
    expect(formatMoney(15.5 as unknown as string)).toBe('15.50')
    expect(formatMoney(0 as unknown as string)).toBe('0.00')
  })

  it('parses a numeric price without throwing', () => {
    // Reached when the edit dialog seeds its form from an existing item.
    expect(parsePriceInput(12.5 as unknown as string)).toBe(12.5)
    expect(parsePriceInput(0 as unknown as string)).toBe(0)
  })

  it('still refuses a negative number', () => {
    expect(parsePriceInput(-1 as unknown as string)).toBeNull()
  })
})
