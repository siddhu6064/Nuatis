'use client'

import { useCallback, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'

const PIN_LENGTH = 4
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

export interface PinPadProps {
  tenantId: string
  locationId: string
}

/**
 * PIN sign-in, shared by the register and the kitchen display.
 *
 * Keys are 88px: this is the control a cashier uses most, on a screen they may
 * be reaching across a counter to hit. The PIN is posted to this app's own
 * /api/session route, which exchanges it server-side — the PIN never goes to
 * the API from the browser, and the token that comes back never reaches this
 * component.
 */
export function PinPad({ tenantId, locationId }: PinPadProps) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = useCallback(
    async (value: string) => {
      setSubmitting(true)
      setError(null)
      try {
        const res = await fetch('/api/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tenant_id: tenantId, location_id: locationId, pin: value }),
        })
        if (!res.ok) {
          // Never distinguish wrong-PIN from unknown-staff on screen — the API
          // is deliberately uniform about it and the UI should not undo that.
          setError(res.status === 503 ? 'Cannot reach the server' : 'Incorrect PIN')
          setPin('')
          return
        }
        // A full page load, not router.replace(). Before sign-in the proxy
        // 307s '/' to '/sign-in', and Next's Router Cache keeps that redirect
        // — so a client-side replace('/') resolves straight back here and the
        // screen silently never changes, even though the RSC payload fetches
        // 200. A hard navigation re-runs the proxy with the new cookie. This
        // happens once per shift, so the cost is irrelevant.
        window.location.assign('/')
      } catch {
        setError('Cannot reach the server')
        setPin('')
      } finally {
        setSubmitting(false)
      }
    },
    [tenantId, locationId]
  )

  const press = useCallback(
    (key: string) => {
      if (submitting) return
      setError(null)
      setPin((current) => {
        if (current.length >= PIN_LENGTH) return current
        const next = current + key
        // Submit on the last digit rather than making the cashier reach for a
        // separate confirm key.
        if (next.length === PIN_LENGTH) void submit(next)
        return next
      })
    },
    [submitting, submit]
  )

  const clear = useCallback(() => {
    if (submitting) return
    setPin('')
    setError(null)
  }, [submitting])

  return (
    <Paper elevation={0} sx={{ p: 4, width: 360, mx: 'auto', textAlign: 'center' }}>
      <Typography variant="h5" sx={{ mb: 1 }}>
        Enter your PIN
      </Typography>

      <Box
        aria-label="PIN entry"
        aria-live="polite"
        sx={{ display: 'flex', justifyContent: 'center', gap: 1.5, my: 3, height: 24 }}
      >
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <Box
            key={i}
            sx={{
              width: 18,
              height: 18,
              borderRadius: '50%',
              border: '2px solid',
              borderColor: 'primary.main',
              bgcolor: i < pin.length ? 'primary.main' : 'transparent',
            }}
          />
        ))}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1.5 }}>
        {KEYS.map((k) => (
          <Button
            key={k}
            variant="outlined"
            onClick={() => press(k)}
            disabled={submitting}
            sx={{ height: 88, fontSize: '1.5rem' }}
          >
            {k}
          </Button>
        ))}
        <Button
          variant="text"
          onClick={clear}
          disabled={submitting || pin.length === 0}
          sx={{ height: 88 }}
        >
          Clear
        </Button>
        <Button
          variant="outlined"
          onClick={() => press('0')}
          disabled={submitting}
          sx={{ height: 88, fontSize: '1.5rem' }}
        >
          0
        </Button>
        <Box sx={{ height: 88 }} />
      </Box>

      {submitting && (
        <Typography variant="body2" sx={{ mt: 2 }} color="text.secondary">
          Signing in…
        </Typography>
      )}
    </Paper>
  )
}
