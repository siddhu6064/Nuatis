'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'

const PIN_LENGTH = 4
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const

interface PinPadProps {
  tenantId: string
  locationId: string
}

/**
 * Register sign-in.
 *
 * Keys are 88px: this is the control a cashier uses most, on a screen they may
 * be reaching across a counter to hit. The PIN is posted to this app's own
 * /api/session route, which exchanges it server-side — the PIN never goes to
 * the API from the browser, and the token that comes back never reaches this
 * component.
 */
export function PinPad({ tenantId, locationId }: PinPadProps) {
  const router = useRouter()
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
        // replace, not push: the PIN screen must not be reachable with Back.
        router.replace('/')
      } catch {
        setError('Cannot reach the server')
        setPin('')
      } finally {
        setSubmitting(false)
      }
    },
    [tenantId, locationId, router]
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
