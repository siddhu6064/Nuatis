import { describe, it, expect, jest } from '@jest/globals'
import type { CartLine, TenderLeg } from '@nuatis/pos-core'
import {
  toOrderPayload,
  toPaymentInputs,
  createAndFireOrder,
  CreateOrderError,
  type CreateOrderOptions,
} from './createOrder'

const LOCATION_ID = 'loc-1'

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    menuItemId: 'item-burger',
    name: 'Burger',
    unitPriceCents: 1200,
    quantity: 1,
    taxable: true,
    modifiers: [],
    ...overrides,
  }
}

function opts(overrides: Partial<CreateOrderOptions> = {}): CreateOrderOptions {
  return {
    locationId: LOCATION_ID,
    tipCents: 0,
    legs: [],
    totalDueCents: 1305,
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

describe('toOrderPayload', () => {
  it('does not send prices — the server prices the order from the menu', () => {
    const payload = toOrderPayload([line()], opts())
    expect(JSON.stringify(payload)).not.toMatch(/1200|12\.00|unit_price|price/)
  })

  it('sends menu_item_id and the chosen option ids, which is what routes the ticket', () => {
    const payload = toOrderPayload(
      [
        line({
          modifiers: [
            { optionId: 'opt-cheddar', name: 'Cheddar', priceDeltaCents: 150 },
            { optionId: 'opt-bacon', name: 'Bacon', priceDeltaCents: 200 },
          ],
        }),
      ],
      opts()
    )

    expect(payload.lines).toEqual([
      { menu_item_id: 'item-burger', quantity: 1, option_ids: ['opt-cheddar', 'opt-bacon'] },
    ])
  })

  it('carries the location_id, without which the API refuses to fire', () => {
    expect(toOrderPayload([line()], opts()).location_id).toBe(LOCATION_ID)
  })

  it('sends the tip in dollars', () => {
    expect(toOrderPayload([line()], opts({ tipCents: 305 })).tip_amount).toBe(3.05)
  })
})

describe('toPaymentInputs', () => {
  it('records each leg of a split separately', () => {
    const legs: TenderLeg[] = [
      { method: 'card', amountCents: 1000 },
      { method: 'card', amountCents: 305 },
    ]
    expect(toPaymentInputs(legs, 1305)).toEqual([
      { method: 'card', amount: 10 },
      { method: 'card', amount: 3.05 },
    ])
  })

  it('clamps an over-tendered cash note to what was owed, because the rest is change', () => {
    const payments = toPaymentInputs([{ method: 'cash', amountCents: 2000 }], 1305)
    expect(payments).toEqual([{ method: 'cash', amount: 13.05 }])
  })

  it('never sums above the total on a mixed split with change', () => {
    const legs: TenderLeg[] = [
      { method: 'card', amountCents: 1000 },
      { method: 'cash', amountCents: 1000 },
    ]
    const payments = toPaymentInputs(legs, 1305)
    const sum = payments.reduce((n, p) => n + Math.round(p.amount * 100), 0)
    expect(sum).toBe(1305)
  })

  it('drops a leg that is entirely change', () => {
    const legs: TenderLeg[] = [
      { method: 'card', amountCents: 1305 },
      { method: 'cash', amountCents: 500 },
    ]
    expect(toPaymentInputs(legs, 1305)).toEqual([{ method: 'card', amount: 13.05 }])
  })

  it('returns nothing when nothing was owed', () => {
    expect(toPaymentInputs([{ method: 'cash', amountCents: 500 }], 0)).toEqual([])
  })
})

describe('createAndFireOrder', () => {
  it('creates the order, then fires it', async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: 'order-1' }, 201))
      .mockResolvedValueOnce(jsonResponse({ tickets: [{ id: 't1' }, { id: 't2' }] }, 201))

    const result = await createAndFireOrder([line()], opts(), fetchImpl)

    expect(result).toEqual({ orderId: 'order-1', fired: true, ticketCount: 2 })
    expect(fetchImpl.mock.calls[0]![0]).toBe('/api/pos/orders')
    expect(fetchImpl.mock.calls[1]![0]).toBe('/api/pos/tickets/fire')
    expect(JSON.parse(String(fetchImpl.mock.calls[1]![1]!.body))).toEqual({ order_id: 'order-1' })
  })

  it('does not fire when the order failed to create', async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ error: 'Location not found' }, 404))

    await expect(createAndFireOrder([line()], opts(), fetchImpl)).rejects.toThrow(
      'Location not found'
    )
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('returns the order id when firing fails, so the sale is not rung twice', async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ id: 'order-1' }, 201))
      .mockResolvedValueOnce(jsonResponse({ error: 'Order has no line items to fire' }, 400))

    await expect(createAndFireOrder([line()], opts(), fetchImpl)).rejects.toMatchObject({
      orderId: 'order-1',
    })
  })

  it('refuses an empty cart before touching the network', async () => {
    const fetchImpl = jest.fn<typeof fetch>()
    await expect(createAndFireOrder([], opts(), fetchImpl)).rejects.toBeInstanceOf(CreateOrderError)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
