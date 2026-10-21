import { tenderBalanceCents, changeDueCents, type TenderLeg } from '@nuatis/pos-core'

/**
 * The checkout state machine, as pure functions.
 *
 * Ported from the prototype's `idle → tip → processing → receipt` flow, which
 * the original audit assessed as sound. Split out from React so the rules that
 * decide whether money has actually been collected can be tested without
 * rendering anything.
 */

export type CheckoutStage = 'idle' | 'tip' | 'tender' | 'processing' | 'receipt'

export interface CheckoutState {
  stage: CheckoutStage
  /** Tip in cents, chosen before tender so it is part of the amount due. */
  tipCents: number
  /** Payments taken so far. More than one means a split. */
  legs: TenderLeg[]
  /** Cash back owed, computed once at completion. */
  changeDueCents: number
  error: string | null
}

/** Up to five legs, matching the prototype. Beyond that a till is being misused. */
export const MAX_LEGS = 5

export const TIP_PRESETS_BPS = [1500, 1800, 2000] as const

export function initialState(): CheckoutState {
  return { stage: 'idle', tipCents: 0, legs: [], changeDueCents: 0, error: null }
}

/** Open checkout on a non-empty cart. An empty cart has nothing to charge. */
export function start(state: CheckoutState, subtotalWithTaxCents: number): CheckoutState {
  if (subtotalWithTaxCents <= 0) {
    return { ...state, error: 'Nothing to charge' }
  }
  return { ...initialState(), stage: 'tip' }
}

/** Tip from a preset percentage of the pre-tip total, rounded to the cent. */
export function tipFromBps(preTipTotalCents: number, bps: number): number {
  return Math.round((preTipTotalCents * bps) / 10000)
}

export function setTip(state: CheckoutState, tipCents: number): CheckoutState {
  if (tipCents < 0) return { ...state, error: 'Tip cannot be negative' }
  return { ...state, tipCents, error: null }
}

export function toTender(state: CheckoutState): CheckoutState {
  if (state.stage !== 'tip') return state
  return { ...state, stage: 'tender', error: null }
}

/**
 * Remaining balance. Negative means the customer handed over more than the
 * total — that is change owed, not an error.
 */
export function balanceCents(state: CheckoutState, totalDueCents: number): number {
  return tenderBalanceCents(totalDueCents, state.legs)
}

export function addLeg(state: CheckoutState, leg: TenderLeg, totalDueCents: number): CheckoutState {
  if (state.legs.length >= MAX_LEGS) {
    return { ...state, error: `A sale cannot have more than ${MAX_LEGS} payments` }
  }
  if (!Number.isInteger(leg.amountCents) || leg.amountCents <= 0) {
    return { ...state, error: 'Enter an amount' }
  }
  // Only cash can exceed the balance — that is how change works. Overcharging a
  // card is a refund waiting to happen, so it is refused here.
  const remaining = balanceCents(state, totalDueCents)
  if (leg.method !== 'cash' && leg.amountCents > remaining) {
    return { ...state, error: 'That is more than the remaining balance' }
  }
  return { ...state, legs: [...state.legs, leg], error: null }
}

export function removeLeg(state: CheckoutState, index: number): CheckoutState {
  return { ...state, legs: state.legs.filter((_, i) => i !== index), error: null }
}

/** True once the legs cover the total. */
export function isSettled(state: CheckoutState, totalDueCents: number): boolean {
  return balanceCents(state, totalDueCents) <= 0
}

export function toProcessing(state: CheckoutState): CheckoutState {
  return { ...state, stage: 'processing', error: null }
}

/**
 * Finish the sale. Refuses while any balance remains — the whole point of the
 * machine is that `receipt` is unreachable without the money being collected.
 */
export function complete(state: CheckoutState, totalDueCents: number): CheckoutState {
  if (!isSettled(state, totalDueCents)) {
    return { ...state, stage: 'tender', error: 'Balance is not fully paid' }
  }
  const tendered = state.legs.reduce((sum, l) => sum + l.amountCents, 0)
  return {
    ...state,
    stage: 'receipt',
    changeDueCents: changeDueCents(totalDueCents, tendered),
    error: null,
  }
}

/** Cancel from any stage. A cashier can always back out of a sale. */
export function cancel(): CheckoutState {
  return initialState()
}

export function cashTakenCents(state: CheckoutState): number {
  return state.legs.filter((l) => l.method === 'cash').reduce((sum, l) => sum + l.amountCents, 0)
}

/**
 * Cash the drawer actually keeps: what was handed over, less the change handed
 * back.
 *
 * Recording the gross tender instead overstates the drawer by the change on
 * every cash sale, so a close-out shows a shortage exactly equal to the change
 * given all shift — the sort of discrepancy that gets a cashier accused of
 * something. Change only ever comes out of cash, never off a card, so
 * subtracting it from the cash legs is the whole correction.
 */
export function cashIntoDrawerCents(state: CheckoutState): number {
  return cashTakenCents(state) - state.changeDueCents
}
