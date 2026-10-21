'use client'

import { useCallback, useState } from 'react'
import type { TenderLeg, TenderMethod } from '@nuatis/pos-core'
import {
  initialState,
  start as startMachine,
  setTip as setTipOn,
  toTender as toTenderOn,
  addLeg as addLegTo,
  removeLeg as removeLegFrom,
  balanceCents,
  isSettled,
  complete as completeMachine,
  cancel as cancelMachine,
  cashTakenCents,
  cashIntoDrawerCents,
  type CheckoutState,
} from './checkout-machine'

/** How long the simulated card approval takes, matching the prototype. */
const MOCK_CARD_APPROVAL_MS = 2000

export interface UseCheckout {
  state: CheckoutState
  /** Amount owed including the chosen tip. */
  totalDueCents: number
  balanceCents: number
  isSettled: boolean
  busy: boolean
  start: () => void
  setTip: (tipCents: number) => void
  toTender: () => void
  takeCash: (amountCents: number) => void
  takeCard: (amountCents: number) => Promise<void>
  removeLeg: (index: number) => void
  complete: () => void
  cancel: () => void
}

/**
 * Checkout state plus the side effects a sale actually has.
 *
 * All transition rules live in checkout-machine.ts; this adds the card
 * approval delay and nothing else. `preTipTotalCents` is the cart total before
 * a tip, so the tip percentage is taken on the goods, not on itself.
 */
export function useCheckout(preTipTotalCents: number): UseCheckout {
  const [state, setState] = useState<CheckoutState>(initialState)
  const [busy, setBusy] = useState(false)

  const totalDueCents = preTipTotalCents + state.tipCents

  const start = useCallback(() => {
    setState((s) => startMachine(s, preTipTotalCents))
  }, [preTipTotalCents])

  const setTip = useCallback((tipCents: number) => {
    setState((s) => setTipOn(s, tipCents))
  }, [])

  const toTender = useCallback(() => setState(toTenderOn), [])

  const takeCash = useCallback(
    (amountCents: number) => {
      setState((s) => addLegTo(s, { method: 'cash', amountCents }, preTipTotalCents + s.tipCents))
    },
    [preTipTotalCents]
  )

  const takeCard = useCallback(
    async (amountCents: number) => {
      setBusy(true)
      try {
        // DEMO: simulated card approval. Replace this single await with the
        // Stripe Terminal SDK — everything downstream already treats the
        // result as a real payment, so nothing else has to change.
        await new Promise((resolve) => setTimeout(resolve, MOCK_CARD_APPROVAL_MS))
        setState((s) => addLegTo(s, { method: 'card', amountCents }, preTipTotalCents + s.tipCents))
      } finally {
        setBusy(false)
      }
    },
    [preTipTotalCents]
  )

  const removeLeg = useCallback((index: number) => {
    setState((s) => removeLegFrom(s, index))
  }, [])

  const complete = useCallback(() => {
    setState((s) => completeMachine(s, preTipTotalCents + s.tipCents))
  }, [preTipTotalCents])

  const cancel = useCallback(() => setState(cancelMachine()), [])

  return {
    state,
    totalDueCents,
    balanceCents: balanceCents(state, totalDueCents),
    isSettled: isSettled(state, totalDueCents),
    busy,
    start,
    setTip,
    toTender,
    takeCash,
    takeCard,
    removeLeg,
    complete,
    cancel,
  }
}

export { cashTakenCents, cashIntoDrawerCents }
export type { TenderLeg, TenderMethod }
