'use client'

import { useCallback, useMemo, useState } from 'react'
import { cartTotals, type CartLine, type CartTotals } from '@nuatis/pos-core'
import {
  addLine as addLineTo,
  removeLine as removeLineFrom,
  setQuantity as setQuantityOn,
  toCartLine,
  type MenuItemDto,
  type MenuOptionDto,
} from './cart-lines'

export interface UseCart {
  lines: CartLine[]
  add: (item: MenuItemDto, options?: MenuOptionDto[], quantity?: number) => void
  setQuantity: (index: number, quantity: number) => void
  remove: (index: number) => void
  clear: () => void
  totals: CartTotals
  itemCount: number
}

/**
 * Cart state.
 *
 * A thin wrapper over the pure helpers in cart-lines.ts — all the merge and
 * quantity rules, and every arithmetic operation, live there so they can be
 * tested without rendering anything.
 */
export function useCart(taxRateBps: number, tipCents = 0): UseCart {
  const [lines, setLines] = useState<CartLine[]>([])

  const add = useCallback((item: MenuItemDto, options: MenuOptionDto[] = [], quantity = 1) => {
    setLines((current) => addLineTo(current, toCartLine(item, options, quantity)))
  }, [])

  const setQuantity = useCallback((index: number, quantity: number) => {
    setLines((current) => setQuantityOn(current, index, quantity))
  }, [])

  const remove = useCallback((index: number) => {
    setLines((current) => removeLineFrom(current, index))
  }, [])

  const clear = useCallback(() => setLines([]), [])

  const totals = useMemo(
    () => cartTotals(lines, taxRateBps, tipCents),
    [lines, taxRateBps, tipCents]
  )

  const itemCount = useMemo(() => lines.reduce((n, l) => n + l.quantity, 0), [lines])

  return { lines, add, setQuantity, remove, clear, totals, itemCount }
}
