import {
  parseMoneyInput,
  openDrawerPayload,
  closeDrawerPayload,
  describeVariance,
  summariseClose,
  isCloseReadable,
} from './drawer'

describe('parseMoneyInput', () => {
  it('reads dollars as integer cents', () => {
    expect(parseMoneyInput('100')).toBe(10000)
    expect(parseMoneyInput('119.58')).toBe(11958)
    expect(parseMoneyInput('0.05')).toBe(5)
  })

  it('accepts zero — an empty till is a real opening float', () => {
    expect(parseMoneyInput('0')).toBe(0)
  })

  it('tolerates the spacing and symbols a cashier actually types', () => {
    expect(parseMoneyInput(' 100 ')).toBe(10000)
    expect(parseMoneyInput('$100')).toBe(10000)
    expect(parseMoneyInput('1,250.00')).toBe(125000)
  })

  it('rejects anything that is not a number', () => {
    expect(parseMoneyInput('')).toBeNull()
    expect(parseMoneyInput('abc')).toBeNull()
    expect(parseMoneyInput('12.34.56')).toBeNull()
    expect(parseMoneyInput('$')).toBeNull()
  })

  it('rejects a negative amount — a drawer cannot hold less than nothing', () => {
    expect(parseMoneyInput('-5')).toBeNull()
  })

  it('does not drift on a value that floats round badly', () => {
    // 8.285 * 100 is 828.4999... in IEEE 754. Losing that cent in a drawer
    // count surfaces later as a variance nobody can account for.
    expect(parseMoneyInput('8.285')).toBe(829)
  })
})

describe('openDrawerPayload', () => {
  it('sends the location and the float in dollars, as the API expects', () => {
    expect(openDrawerPayload('loc-1', 10000)).toEqual({
      location_id: 'loc-1',
      opening_float: 100,
    })
  })

  it('sends a two-decimal number rather than a repeating fraction', () => {
    expect(openDrawerPayload('loc-1', 11958)).toEqual({
      location_id: 'loc-1',
      opening_float: 119.58,
    })
  })
})

describe('closeDrawerPayload', () => {
  it('sends the counted total in dollars', () => {
    expect(closeDrawerPayload(11958, '')).toEqual({ counted_total: 119.58, notes: null })
  })

  it('passes a note through when the cashier wrote one', () => {
    expect(closeDrawerPayload(0, 'two tens missing')).toEqual({
      counted_total: 0,
      notes: 'two tens missing',
    })
  })

  it('sends null rather than whitespace for an empty note', () => {
    expect(closeDrawerPayload(100, '   ').notes).toBeNull()
  })
})

describe('describeVariance', () => {
  it('calls an exact count balanced', () => {
    expect(describeVariance(0)).toEqual({ tone: 'balanced', text: 'Balanced' })
  })

  it('calls a surplus over, by the amount', () => {
    expect(describeVariance(250)).toEqual({ tone: 'over', text: 'Over by $2.50' })
  })

  it('calls a shortfall short, stated as a positive amount', () => {
    // "Short by $-2.50" is how a cashier ends up arguing with the screen.
    expect(describeVariance(-250)).toEqual({ tone: 'short', text: 'Short by $2.50' })
  })
})

describe('summariseClose', () => {
  it('parses the numeric strings the API returns into cents', () => {
    const summary = summariseClose({
      opening_float: '100.00',
      expected_total: '119.58',
      counted_total: '119.58',
      variance: '0.00',
    })

    expect(summary).toEqual({
      openingFloatCents: 10000,
      expectedCents: 11958,
      countedCents: 11958,
      varianceCents: 0,
    })
  })

  it('keeps the sign of a shortfall', () => {
    expect(
      summariseClose({
        opening_float: '100.00',
        expected_total: '119.58',
        counted_total: '115.00',
        variance: '-4.58',
      }).varianceCents
    ).toBe(-458)
  })

  it('treats a missing field as zero rather than NaN', () => {
    // A NaN here renders as "$NaN" on a close-out a manager has to sign off.
    expect(summariseClose({})).toEqual({
      openingFloatCents: 0,
      expectedCents: 0,
      countedCents: 0,
      varianceCents: 0,
    })
  })
})

describe('summariseClose — numeric columns arrive as numbers', () => {
  // Caught in the browser, not here: the close-out rendered $0.00 / $0.00 /
  // $0.00 and declared the till "Balanced". supabase-js hands numeric back as
  // a JS number, and the original guard returned 0 for anything non-string.
  // These tests fed it strings, so they passed while the screen was wrong —
  // and "Balanced" on a drawer nobody measured is worse than no answer, since
  // it is what a manager signs off.

  it('reads numeric values', () => {
    expect(
      summariseClose({
        opening_float: 100 as unknown as string,
        expected_total: 117.32 as unknown as string,
        counted_total: 117.32 as unknown as string,
        variance: 0 as unknown as string,
      })
    ).toEqual({
      openingFloatCents: 10000,
      expectedCents: 11732,
      countedCents: 11732,
      varianceCents: 0,
    })
  })

  it('keeps the sign of a numeric shortfall', () => {
    expect(summariseClose({ variance: -4.58 as unknown as string }).varianceCents).toBe(-458)
  })
})

describe('isCloseReadable', () => {
  it('is true when the server reported a variance', () => {
    expect(isCloseReadable({ variance: '0.00' })).toBe(true)
    expect(isCloseReadable({ variance: 0 as unknown as string })).toBe(true)
  })

  it('is false when the variance is missing, so nothing claims "Balanced"', () => {
    expect(isCloseReadable({})).toBe(false)
    expect(isCloseReadable({ variance: null })).toBe(false)
  })
})
