'use client'

import { useCallback, useEffect, useState } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import { MenuGrid } from '@/components/MenuGrid'
import { CartPanel } from '@/components/CartPanel'
import { ModifierDialog } from '@/components/ModifierDialog'
import { useCart } from '@/lib/useCart'
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

  // Tax cannot be guessed: 0 until settings load, and the cart is not usable
  // before then anyway.
  const cart = useCart(settings?.tax_rate_bps ?? 0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const locationId = process.env.NEXT_PUBLIC_POS_LOCATION_ID ?? ''
        const [menuRes, settingsRes] = await Promise.all([
          fetch('/api/pos/menu/tree'),
          fetch(`/api/pos/settings?location_id=${encodeURIComponent(locationId)}`),
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
        />
      </Box>

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
