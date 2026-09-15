import {
  initialState,
  start,
  setTip,
  tipFromBps,
  toTender,
  addLeg,
  removeLeg,
  balanceCents,
  isSettled,
  complete,
  cancel,
  cashTakenCents,
  cashIntoDrawerCents,
  MAX_LEGS,
  type CheckoutState,
} from './checkout-machine'

const TOTAL = 5000

function atTender(legs: CheckoutState['legs'] = []): CheckoutState {
  return { ...initialState(), stage: 'tender', legs }
}

describe('start', () => {
  it('moves an empty machine to the tip stage', () => {
    expect(start(initialState(), TOTAL).stage).toBe('tip')
  })

  it('refuses to open on an empty cart', () => {
    const s = start(initialState(), 0)
    expect(s.stage).toBe('idle')
    expect(s.error).toBeTruthy()
  })

  it('clears anything left over from a previous sale', () => {
    const dirty: CheckoutState = {
      stage: 'receipt',
      tipCents: 500,
      legs: [{ method: 'cash', amountCents: 100 }],
      changeDueCents: 25,
      error: 'stale',
    }
    const s = start(dirty, TOTAL)
    expect(s.tipCents).toBe(0)
    expect(s.legs).toHaveLength(0)
    expect(s.changeDueCents).toBe(0)
    expect(s.error).toBeNull()
  })
})

describe('tipFromBps', () => {
  it('computes a preset percentage', () => {
    expect(tipFromBps(5000, 2000)).toBe(1000) // 20% of 50.00
  })

  it('rounds to the cent rather than leaving a fraction', () => {
    // 18% of 33.33 is 599.94 cents.
    expect(tipFromBps(3333, 1800)).toBe(600)
  })

  it('is zero on a zero total', () => {
    expect(tipFromBps(0, 2000)).toBe(0)
  })
})

describe('setTip', () => {
  it('stores a tip', () => {
    expect(setTip(initialState(), 750).tipCents).toBe(750)
  })

  it('allows no tip', () => {
    expect(setTip(initialState(), 0).tipCents).toBe(0)
  })

  it('refuses a negative tip', () => {
    const s = setTip(initialState(), -1)
    expect(s.error).toBeTruthy()
    expect(s.tipCents).toBe(0)
  })
})

describe('toTender', () => {
  it('advances from tip', () => {
    expect(toTender({ ...initialState(), stage: 'tip' }).stage).toBe('tender')
  })

  it('does nothing from any other stage', () => {
    expect(toTender(initialState()).stage).toBe('idle')
  })
})

describe('addLeg', () => {
  it('adds a card leg', () => {
    const s = addLeg(atTender(), { method: 'card', amountCents: 5000 }, TOTAL)
    expect(s.legs).toHaveLength(1)
    expect(s.error).toBeNull()
  })

  it('refuses a zero amount', () => {
    expect(addLeg(atTender(), { method: 'cash', amountCents: 0 }, TOTAL).legs).toHaveLength(0)
  })

  it('refuses a negative amount', () => {
    expect(addLeg(atTender(), { method: 'cash', amountCents: -5 }, TOTAL).legs).toHaveLength(0)
  })

  it('refuses a fractional amount', () => {
    expect(addLeg(atTender(), { method: 'cash', amountCents: 10.5 }, TOTAL).legs).toHaveLength(0)
  })

  it('lets cash exceed the balance — that is how change happens', () => {
    const s = addLeg(atTender(), { method: 'cash', amountCents: 6000 }, TOTAL)
    expect(s.legs).toHaveLength(1)
    expect(s.error).toBeNull()
  })

  it('refuses to overcharge a card', () => {
    const s = addLeg(atTender(), { method: 'card', amountCents: 6000 }, TOTAL)
    expect(s.legs).toHaveLength(0)
    expect(s.error).toBeTruthy()
  })

  it('refuses to overcharge a card on the remaining balance of a split', () => {
    const partial = atTender([{ method: 'cash', amountCents: 3000 }])
    const s = addLeg(partial, { method: 'card', amountCents: 2500 }, TOTAL)
    expect(s.legs).toHaveLength(1)
    expect(s.error).toBeTruthy()
  })

  it(`stops at ${MAX_LEGS} legs`, () => {
    let s = atTender()
    for (let i = 0; i < MAX_LEGS; i += 1) {
      s = addLeg(s, { method: 'cash', amountCents: 100 }, TOTAL)
    }
    expect(s.legs).toHaveLength(MAX_LEGS)
    const overflow = addLeg(s, { method: 'cash', amountCents: 100 }, TOTAL)
    expect(overflow.legs).toHaveLength(MAX_LEGS)
    expect(overflow.error).toBeTruthy()
  })
})

describe('removeLeg', () => {
  it('removes a leg and clears the error', () => {
    const s = removeLeg({ ...atTender([{ method: 'cash', amountCents: 100 }]), error: 'boom' }, 0)
    expect(s.legs).toHaveLength(0)
    expect(s.error).toBeNull()
  })
})

describe('balanceCents', () => {
  it('is the full total with nothing tendered', () => {
    expect(balanceCents(atTender(), TOTAL)).toBe(TOTAL)
  })

  it('drops as legs are added', () => {
    const s = atTender([{ method: 'card', amountCents: 2000 }])
    expect(balanceCents(s, TOTAL)).toBe(3000)
  })

  it('goes negative on over-tender', () => {
    const s = atTender([{ method: 'cash', amountCents: 6000 }])
    expect(balanceCents(s, TOTAL)).toBe(-1000)
  })
})

describe('isSettled', () => {
  it('is false while a balance remains', () => {
    expect(isSettled(atTender([{ method: 'cash', amountCents: 4999 }]), TOTAL)).toBe(false)
  })

  it('is true on an exact split across five legs', () => {
    const s = atTender([
      { method: 'card', amountCents: 1001 },
      { method: 'card', amountCents: 1001 },
      { method: 'cash', amountCents: 1001 },
      { method: 'gift_card', amountCents: 1001 },
      { method: 'cash', amountCents: 996 },
    ])
    expect(isSettled(s, TOTAL)).toBe(true)
  })

  it('is true on over-tender', () => {
    expect(isSettled(atTender([{ method: 'cash', amountCents: 6000 }]), TOTAL)).toBe(true)
  })
})

describe('complete', () => {
  it('cannot reach the receipt while a cent is outstanding', () => {
    const s = complete(atTender([{ method: 'cash', amountCents: 4999 }]), TOTAL)
    expect(s.stage).toBe('tender')
    expect(s.error).toBeTruthy()
  })

  it('cannot reach the receipt with nothing tendered at all', () => {
    expect(complete(atTender(), TOTAL).stage).toBe('tender')
  })

  it('reaches the receipt on exact payment with no change', () => {
    const s = complete(atTender([{ method: 'card', amountCents: TOTAL }]), TOTAL)
    expect(s.stage).toBe('receipt')
    expect(s.changeDueCents).toBe(0)
  })

  it('reports change due on over-tender', () => {
    const s = complete(atTender([{ method: 'cash', amountCents: 6000 }]), TOTAL)
    expect(s.stage).toBe('receipt')
    expect(s.changeDueCents).toBe(1000)
  })

  it('computes change across a split where only the last leg overpays', () => {
    const s = complete(
      atTender([
        { method: 'card', amountCents: 2000 },
        { method: 'cash', amountCents: 4000 },
      ]),
      TOTAL
    )
    expect(s.changeDueCents).toBe(1000)
  })
})

describe('cancel', () => {
  it('returns to idle from the receipt stage', () => {
    expect(cancel().stage).toBe('idle')
  })

  it('drops any legs already taken', () => {
    expect(cancel().legs).toHaveLength(0)
  })
})

describe('cashTakenCents', () => {
  it('counts only the cash legs — the drawer never sees card money', () => {
    const s = atTender([
      { method: 'cash', amountCents: 2000 },
      { method: 'card', amountCents: 1500 },
      { method: 'cash', amountCents: 500 },
    ])
    expect(cashTakenCents(s)).toBe(2500)
  })

  it('is zero on a card-only sale', () => {
    expect(cashTakenCents(atTender([{ method: 'card', amountCents: 5000 }]))).toBe(0)
  })
})

describe('cashIntoDrawerCents', () => {
  it('nets the change back out — the drawer keeps the sale, not the tender', () => {
    // $5.00 handed over on a $3.26 sale: the till keeps $3.26 and returns
    // $1.74. Recording the gross $5.00 would show a $1.74 shortage at
    // close-out on every cash sale with change.
    const s = complete(atTender([{ method: 'cash', amountCents: 500 }]), 326)
    expect(s.changeDueCents).toBe(174)
    expect(cashIntoDrawerCents(s)).toBe(326)
  })

  it('equals the tender when nothing is given back', () => {
    const s = complete(atTender([{ method: 'cash', amountCents: 326 }]), 326)
    expect(cashIntoDrawerCents(s)).toBe(326)
  })

  it('counts only the cash portion of a split', () => {
    const s = complete(
      atTender([
        { method: 'card', amountCents: 126 },
        { method: 'cash', amountCents: 200 },
      ]),
      326
    )
    expect(cashIntoDrawerCents(s)).toBe(200)
  })

  it('nets change against the cash portion of a split, never the card', () => {
    // Card 1.26 + cash 5.00 on a 3.26 sale: 2.00 of cash is owed, 3.00 back.
    const s = complete(
      atTender([
        { method: 'card', amountCents: 126 },
        { method: 'cash', amountCents: 500 },
      ]),
      326
    )
    expect(s.changeDueCents).toBe(300)
    expect(cashIntoDrawerCents(s)).toBe(200)
  })

  it('is zero on a card-only sale — the drawer never opens', () => {
    const s = complete(atTender([{ method: 'card', amountCents: 326 }]), 326)
    expect(cashIntoDrawerCents(s)).toBe(0)
  })
})

describe('partial card amounts', () => {
  it('accepts a card leg for part of the balance', () => {
    // "Put $10 on this card and the rest on another."
    const s = addLeg(atTender(), { method: 'card', amountCents: 1000 }, 1958)
    expect(s.legs).toHaveLength(1)
    expect(s.error).toBeNull()
    expect(balanceCents(s, 1958)).toBe(958)
  })

  it('settles once a second card covers the remainder', () => {
    let s = addLeg(atTender(), { method: 'card', amountCents: 1000 }, 1958)
    s = addLeg(s, { method: 'card', amountCents: 958 }, 1958)
    expect(isSettled(s, 1958)).toBe(true)
    expect(complete(s, 1958).changeDueCents).toBe(0)
  })

  it('still refuses a partial card that exceeds what is left', () => {
    const partial = addLeg(atTender(), { method: 'card', amountCents: 1000 }, 1958)
    const over = addLeg(partial, { method: 'card', amountCents: 9999 }, 1958)
    expect(over.legs).toHaveLength(1)
    expect(over.error).toBeTruthy()
  })

  it('allows mixing a partial card with cash for the rest, including change', () => {
    let s = addLeg(atTender(), { method: 'card', amountCents: 1000 }, 1958)
    s = addLeg(s, { method: 'cash', amountCents: 1000 }, 1958)
    const done = complete(s, 1958)
    expect(done.stage).toBe('receipt')
    expect(done.changeDueCents).toBe(42)
    // The drawer keeps the cash owed, not the full note.
    expect(cashIntoDrawerCents(done)).toBe(958)
  })
})
