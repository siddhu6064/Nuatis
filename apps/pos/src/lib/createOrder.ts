import type { CartLine, TenderLeg } from '@nuatis/pos-core'

/** One line as `POST /api/pos/orders` wants it. */
export interface OrderLineInput {
  menu_item_id: string
  quantity: number
  option_ids: string[]
}

export interface PaymentInput {
  method: TenderLeg['method']
  /** Dollars, because the API speaks numeric(10,2). */
  amount: number
}

export interface OrderPayload {
  location_id: string
  lines: OrderLineInput[]
  tip_amount: number
  payments: PaymentInput[]
}

export interface CreateOrderOptions {
  locationId: string
  tipCents: number
  legs: TenderLeg[]
  /** Order total including tax and tip — what the customer actually owed. */
  totalDueCents: number
}

export interface FireResult {
  orderId: string
  /** False when the sale was recorded but the kitchen never received it. */
  fired: boolean
  ticketCount: number
}

export class CreateOrderError extends Error {
  constructor(
    message: string,
    /** Set when the order exists but firing failed — do not retry the order. */
    readonly orderId: string | null = null
  ) {
    super(message)
    this.name = 'CreateOrderError'
  }
}

function toDollarNumber(cents: number): number {
  // Dollars as a number, to two places. The API re-derives cents from this, and
  // the server is the one that prices the order anyway — these amounts only say
  // how it was paid.
  return Number((cents / 100).toFixed(2))
}

/**
 * Payments to record, clamped so they never sum above what was owed.
 *
 * A $20 note against a $13.05 ticket pays $13.05; the other $6.95 is change
 * walking back out of the drawer. Recording the gross note would make the
 * payment rows disagree with the order total on every cash sale — the same
 * mistake that overstated the cash drawer before `cashIntoDrawerCents` fixed
 * it. The state machine already refuses to over-charge a card, so the clamp
 * can only ever trim cash, which is exactly where change comes from.
 */
export function toPaymentInputs(legs: TenderLeg[], totalDueCents: number): PaymentInput[] {
  const payments: PaymentInput[] = []
  let remaining = Math.max(0, totalDueCents)

  for (const leg of legs) {
    const applied = Math.min(leg.amountCents, remaining)
    if (applied <= 0) continue
    payments.push({ method: leg.method, amount: toDollarNumber(applied) })
    remaining -= applied
  }

  return payments
}

/**
 * Cart plus tender, as the API's order body.
 *
 * Deliberately carries no prices. The server reads them from the menu, so a
 * register sitting in a public room cannot name its own total — and the two
 * can never disagree about what a burger costs.
 */
export function toOrderPayload(lines: CartLine[], opts: CreateOrderOptions): OrderPayload {
  return {
    location_id: opts.locationId,
    lines: lines.map((line) => ({
      menu_item_id: line.menuItemId,
      quantity: line.quantity,
      option_ids: line.modifiers.map((m) => m.optionId),
    })),
    tip_amount: toDollarNumber(opts.tipCents),
    payments: toPaymentInputs(opts.legs, opts.totalDueCents),
  }
}

/**
 * Create the order, then fire it to the kitchen.
 *
 * Two calls, not one, because they fail differently and the cashier needs to
 * know which happened. A failed create means nothing was recorded and the sale
 * can be re-rung. A failed fire means the money is booked but no station has
 * the ticket — re-ringing would double-charge, so the order id comes back on
 * the error so the sale can be fired again instead.
 */
export async function createAndFireOrder(
  lines: CartLine[],
  opts: CreateOrderOptions,
  fetchImpl: typeof fetch = fetch
): Promise<FireResult> {
  if (lines.length === 0) throw new CreateOrderError('Nothing to send')

  const orderRes = await fetchImpl('/api/pos/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(toOrderPayload(lines, opts)),
  })

  if (!orderRes.ok) {
    throw new CreateOrderError(await errorTextOf(orderRes, 'The order could not be created.'))
  }

  const order = (await orderRes.json()) as { id?: string }
  if (!order.id) throw new CreateOrderError('The order was created without an id.')

  const fireRes = await fetchImpl('/api/pos/tickets/fire', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ order_id: order.id }),
  })

  if (!fireRes.ok) {
    throw new CreateOrderError(
      await errorTextOf(fireRes, 'The sale was recorded but the kitchen was not notified.'),
      order.id
    )
  }

  const fired = (await fireRes.json()) as { tickets?: unknown[] }
  return { orderId: order.id, fired: true, ticketCount: fired.tickets?.length ?? 0 }
}

async function errorTextOf(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    return body.error ?? fallback
  } catch {
    return fallback
  }
}
