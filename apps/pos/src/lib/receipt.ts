import {
  lineTotalCents,
  toDollars,
  type CartLine,
  type CartTotals,
  type TenderLeg,
} from '@nuatis/pos-core'

/**
 * Receipt generation, as pure functions.
 *
 * Separated from rendering for the same reason the checkout machine is: a
 * receipt is a money document, and the arithmetic on it has to be testable
 * without a browser.
 *
 * The one rule that matters here: this module NEVER recomputes totals. It is
 * handed the `CartTotals` the register already charged and prints those. A
 * second, independent computation is exactly how a printed receipt comes to
 * disagree with the amount on the customer's card — the receipt would look
 * authoritative while being wrong, which is worse than no receipt at all.
 */

/** Characters per line. 40 is the common width for 80mm thermal paper. */
export const RECEIPT_WIDTH = 40

export interface ReceiptModifier {
  name: string
  priceDeltaCents: number
}

export interface ReceiptLine {
  name: string
  quantity: number
  unitPriceCents: number
  modifiers: ReceiptModifier[]
  lineTotalCents: number
}

export interface ReceiptInput {
  businessName: string | null
  locationName: string | null
  orderNumber: string | null
  cashierName: string | null
  soldAt: Date
  lines: CartLine[]
  totals: CartTotals
  legs: TenderLeg[]
  changeDueCents: number
}

export interface Receipt {
  businessName: string
  locationName: string | null
  orderNumber: string | null
  cashierName: string | null
  soldAt: Date
  lines: ReceiptLine[]
  subtotalCents: number
  taxCents: number
  tipCents: number
  totalCents: number
  tenders: TenderLeg[]
  changeDueCents: number
}

const TENDER_LABELS: Record<TenderLeg['method'], string> = {
  cash: 'Cash',
  card: 'Card',
  gift_card: 'Gift card',
}

/**
 * Turn the cart, totals and tender into the document to print.
 *
 * `businessName` falls back to a neutral word rather than an empty heading: a
 * receipt with a blank first line looks like a printer fault. Location and
 * cashier stay null when absent — those lines are simply omitted instead of
 * printing "null" at a customer.
 */
export function buildReceipt(input: ReceiptInput): Receipt {
  return {
    businessName: input.businessName?.trim() || 'Receipt',
    locationName: input.locationName?.trim() || null,
    orderNumber: input.orderNumber?.trim() || null,
    cashierName: input.cashierName?.trim() || null,
    soldAt: input.soldAt,
    lines: input.lines.map((line) => toReceiptLine(line)),
    subtotalCents: input.totals.subtotalCents,
    taxCents: input.totals.taxCents,
    tipCents: input.totals.tipCents,
    totalCents: input.totals.totalCents,
    tenders: input.legs.map((leg) => ({ method: leg.method, amountCents: leg.amountCents })),
    changeDueCents: input.changeDueCents,
  }
}

function toReceiptLine(line: CartLine): ReceiptLine {
  return {
    name: line.name,
    quantity: line.quantity,
    unitPriceCents: line.unitPriceCents,
    modifiers: line.modifiers.map((m) => ({ name: m.name, priceDeltaCents: m.priceDeltaCents })),
    // Reuse the cart's own arithmetic rather than re-deriving it, so a receipt
    // cannot disagree with the cart about what a line cost.
    lineTotalCents: lineTotalCents(line),
  }
}

/**
 * Render the receipt as fixed-width text.
 *
 * Plain text rather than markup because this is what a thermal printer wants,
 * and because it is the form a receipt can also be read back as — pasted into
 * a refund note, or sent as a message body later. Every line is clipped to
 * `RECEIPT_WIDTH`; a long menu name wrapping unpredictably on a 40-column
 * printer produces a receipt a customer cannot read.
 */
export function formatReceiptText(receipt: Receipt): string {
  const out: string[] = []

  out.push(center(receipt.businessName))
  if (receipt.locationName) out.push(center(receipt.locationName))
  out.push('')
  out.push(clip(formatSoldAt(receipt.soldAt)))
  if (receipt.orderNumber) out.push(clip(`Order ${receipt.orderNumber}`))
  if (receipt.cashierName) out.push(clip(`Served by ${receipt.cashierName}`))
  out.push(divider())

  for (const line of receipt.lines) {
    out.push(row(`${line.quantity}x ${line.name}`, toDollars(line.lineTotalCents)))
    for (const modifier of line.modifiers) {
      // A free option is a preparation note, not a charge — printing "0.00"
      // beside it invites "what am I being charged for?" at the counter.
      out.push(
        modifier.priceDeltaCents === 0
          ? clip(`  + ${modifier.name}`)
          : row(`  + ${modifier.name}`, toDollars(modifier.priceDeltaCents))
      )
    }
  }

  out.push(divider())
  out.push(row('Subtotal', toDollars(receipt.subtotalCents)))
  out.push(row('Tax', toDollars(receipt.taxCents)))
  if (receipt.tipCents > 0) out.push(row('Tip', toDollars(receipt.tipCents)))
  out.push(row('TOTAL', toDollars(receipt.totalCents)))
  out.push('')

  for (const tender of receipt.tenders) {
    out.push(row(TENDER_LABELS[tender.method], toDollars(tender.amountCents)))
  }
  if (receipt.changeDueCents > 0) {
    out.push(row('Change', toDollars(receipt.changeDueCents)))
  }

  return out.join('\n')
}

/** `YYYY-MM-DD HH:mm` in the register's own timezone. */
function formatSoldAt(when: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const date = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`
  return `${date} ${pad(when.getHours())}:${pad(when.getMinutes())}`
}

function divider(): string {
  return '-'.repeat(RECEIPT_WIDTH)
}

function clip(text: string): string {
  return text.length > RECEIPT_WIDTH ? text.slice(0, RECEIPT_WIDTH) : text
}

function center(text: string): string {
  const clipped = clip(text)
  const left = Math.floor((RECEIPT_WIDTH - clipped.length) / 2)
  return ' '.repeat(left) + clipped
}

/**
 * A label on the left and an amount flush right, clipped so the amount is
 * never the thing that gets cut off — the number is the part a customer is
 * checking.
 */
function row(label: string, amount: string): string {
  const budget = RECEIPT_WIDTH - amount.length - 1
  const text = label.length > budget ? label.slice(0, budget) : label
  const gap = RECEIPT_WIDTH - text.length - amount.length
  return text + ' '.repeat(Math.max(1, gap)) + amount
}
