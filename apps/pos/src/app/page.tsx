'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import { MenuGrid } from '@/components/MenuGrid'
import { CartPanel } from '@/components/CartPanel'
import { ModifierDialog } from '@/components/ModifierDialog'
import { CheckoutDialog } from '@/components/CheckoutDialog'
import { useCart } from '@/lib/useCart'
import { createAndFireOrder, CreateOrderError } from '@/lib/createOrder'
import { useCheckout, cashIntoDrawerCents } from '@/lib/useCheckout'
import { canAddDirectly, type MenuCategoryDto, type MenuItemDto } from '@/lib/cart-lines'

interface PosSettings {
  business_name: string | null
  location_name: string | null
  tax_rate_bps: number
}

export default function RegisterPage() {
  const [categories, setCategories] = useState<MenuCategoryDto[]>([])
  const [settings, setSettings] = useState<PosSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pendingItem, setPendingItem] = useState<MenuItemDto | null>(null)
  const [drawerSessionId, setDrawerSessionId] = useState<string | null>(null)
  // Something went wrong AFTER the money was taken. Deliberately not `error`:
  // that renders a full-page alert, which would wipe the register out from
  // under a cashier holding a customer's receipt.
  const [saleWarning, setSaleWarning] = useState<string | null>(null)

  // Tax cannot be guessed: 0 until settings load, and the cart is not usable
  // before then anyway.
  const cart = useCart(settings?.tax_rate_bps ?? 0)
  const checkout = useCheckout(cart.totals.totalCents)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const locationId = process.env.NEXT_PUBLIC_POS_LOCATION_ID ?? ''
        const [menuRes, settingsRes, drawerRes] = await Promise.all([
          fetch('/api/pos/menu/tree'),
          fetch(`/api/pos/settings?location_id=${encodeURIComponent(locationId)}`),
          fetch(`/api/pos/drawer/sessions/current?location_id=${encodeURIComponent(locationId)}`),
        ])

        if (menuRes.status === 401 || settingsRes.status === 401) {
          // The 12h session expired mid-shift. Send them back to the PIN pad
          // rather than showing an empty menu that looks like a data problem.
          window.location.assign('/sign-in')
          return
        }
        if (!menuRes.ok || !settingsRes.ok) {
          setError(
            menuRes.status === 403 || settingsRes.status === 403
              ? 'The POS module is not enabled for this business.'
              : 'Could not load the menu.'
          )
          return
        }

        const menu = (await menuRes.json()) as { categories: MenuCategoryDto[] }
        const config = (await settingsRes.json()) as PosSettings
        if (cancelled) return
        setCategories(menu.categories)
        setSettings(config)

        // A missing drawer is not an error — it just means cash cannot be
        // taken until someone opens one.
        if (drawerRes.ok) {
          const drawer = (await drawerRes.json()) as { session: { id: string } | null }
          setDrawerSessionId(drawer.session?.id ?? null)
        }
      } catch {
        if (!cancelled) setError('Could not reach the server.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const select = useCallback(
    (item: MenuItemDto) => {
      // Straight into the cart when nothing has to be chosen — making a
      // cashier confirm a dialog for a Coke is how queues form.
      if (canAddDirectly(item) && item.modifier_groups.length === 0) {
        cart.add(item)
        return
      }
      setPendingItem(item)
    },
    [cart]
  )

  /**
   * Everything that happens once the money is in: the kitchen gets the order
   * and the drawer gets the cash.
   *
   * Both run on the way INTO the receipt, not when the cashier dismisses it.
   * Firing on dismissal means a receipt left on screen is food that never
   * started cooking.
   *
   * Neither failure can undo a payment that has already been taken, so both are
   * surfaced as warnings on the receipt rather than thrown away — a sale
   * missing from the drawer is exactly the discrepancy the close-out exists to
   * catch, and a sale missing from the kitchen is a customer waiting for food
   * nobody is making.
   */
  const settle = useCallback(async () => {
    const problems: string[] = []

    try {
      await createAndFireOrder(cart.lines, {
        locationId: process.env.NEXT_PUBLIC_POS_LOCATION_ID ?? '',
        tipCents: checkout.state.tipCents,
        legs: checkout.state.legs,
        totalDueCents: checkout.totalDueCents,
      })
    } catch (err) {
      problems.push(
        err instanceof CreateOrderError && err.orderId
          ? 'The sale was recorded but the kitchen was not notified — tell them by hand.'
          : 'The sale was paid but could not be recorded. Tell a manager before the next order.'
      )
    }

    const cash = cashIntoDrawerCents(checkout.state)
    if (cash > 0 && drawerSessionId) {
      try {
        const res = await fetch(`/api/pos/drawer/sessions/${drawerSessionId}/events`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'sale', amount: Number((cash / 100).toFixed(2)) }),
        })
        if (!res.ok) problems.push('The cash was not recorded in the drawer.')
      } catch {
        problems.push('The cash was not recorded in the drawer.')
      }
    }

    setSaleWarning(problems.length > 0 ? problems.join(' ') : null)
  }, [cart.lines, checkout.state, checkout.totalDueCents, drawerSessionId])

  // Run `settle` exactly once per sale, on the transition into the receipt.
  // Held in a ref so the effect depends only on the stage: settle changes
  // identity whenever the cart does, and depending on it directly would re-fire
  // the same order to the kitchen.
  const settleRef = useRef(settle)
  useEffect(() => {
    settleRef.current = settle
  }, [settle])

  const settledRef = useRef(false)
  useEffect(() => {
    if (checkout.state.stage !== 'receipt') {
      settledRef.current = false
      return
    }
    if (settledRef.current) return
    settledRef.current = true
    void settleRef.current()
  }, [checkout.state.stage])

  /** Clear the till for the next customer. The sale is already settled. */
  const startNextOrder = useCallback(() => {
    setSaleWarning(null)
    cart.clear()
    checkout.cancel()
  }, [cart, checkout])

  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>
        <CircularProgress />
      </Box>
    )
  }

  if (error) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', p: 3 }}>
        <Alert severity="error" sx={{ maxWidth: 480 }}>
          {error}
        </Alert>
      </Box>
    )
  }

  return (
    <Box component="main" sx={{ display: 'flex', flexDirection: 'column', height: '100dvh' }}>
      <Box
        sx={{
          px: 2,
          py: 1.5,
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <Typography variant="h6">{settings?.business_name ?? 'Register'}</Typography>
        <Typography variant="body2" color="text.secondary">
          {settings?.location_name}
          {cart.itemCount > 0 && ` · ${cart.itemCount} item${cart.itemCount === 1 ? '' : 's'}`}
        </Typography>
      </Box>

      <Box sx={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <MenuGrid categories={categories} onSelect={select} />
        </Box>
        <CartPanel
          lines={cart.lines}
          totals={cart.totals}
          onSetQuantity={cart.setQuantity}
          onClear={cart.clear}
          onCharge={checkout.start}
        />
      </Box>

      <CheckoutDialog
        checkout={checkout}
        preTipTotalCents={cart.totals.totalCents}
        drawerSessionId={drawerSessionId}
        warning={saleWarning}
        onDone={startNextOrder}
      />

      <ModifierDialog
        item={pendingItem}
        onCancel={() => setPendingItem(null)}
        onConfirm={(item, options) => {
          cart.add(item, options)
          setPendingItem(null)
        }}
      />
    </Box>
  )
}
