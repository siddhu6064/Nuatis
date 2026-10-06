'use client'

import { useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'
import Divider from '@mui/material/Divider'
import { toDollars } from '@nuatis/pos-core'
import {
  parseMoneyInput,
  openDrawerPayload,
  closeDrawerPayload,
  describeVariance,
  summariseClose,
  type CloseSummary,
} from '@/lib/drawer'

export interface DrawerSession {
  id: string
  opening_float: string
}

interface DrawerDialogProps {
  open: boolean
  locationId: string
  /** The drawer currently open at this location, or null if none is. */
  session: DrawerSession | null
  onCancel: () => void
  onOpened: (session: DrawerSession) => void
  onClosedOut: () => void
}

/**
 * Open a till, and close it out at the end of a shift.
 *
 * The backend has had sessions, events and variance since the first POS slice;
 * there was simply no screen, so a cashier could take cash all day into a
 * drawer nobody had opened — `settle` treats a missing drawer as non-fatal and
 * just skips recording the cash, which is exactly the silent discrepancy the
 * close-out exists to catch.
 *
 * The close is deliberately BLIND: the cashier types what they counted and
 * only then sees expected and variance. Showing the expected figure first
 * turns a count into a copy, which is the one thing a till reconciliation is
 * supposed to prevent. The API computes the expected total from `cash_events`
 * server-side, so this screen cannot influence it either way.
 */
export function DrawerDialog({
  open,
  locationId,
  session,
  onCancel,
  onOpened,
  onClosedOut,
}: DrawerDialogProps) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [summary, setSummary] = useState<CloseSummary | null>(null)

  const amountCents = parseMoneyInput(amount)

  function reset() {
    setAmount('')
    setNote('')
    setError(null)
    setSummary(null)
  }

  function cancel() {
    reset()
    onCancel()
  }

  async function openDrawer() {
    if (amountCents === null) {
      setError('Enter the opening float.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/pos/drawer/sessions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(openDrawerPayload(locationId, amountCents)),
      })
      if (!res.ok) {
        setError(await errorTextOf(res, 'The drawer could not be opened.'))
        return
      }
      const body = (await res.json()) as { session?: DrawerSession }
      if (!body.session?.id) {
        setError('The drawer was opened but the register did not get its id. Reload the page.')
        return
      }
      reset()
      onOpened(body.session)
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  async function closeDrawer() {
    if (!session) return
    if (amountCents === null) {
      setError('Enter the counted total.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/pos/drawer/sessions/${session.id}/close`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(closeDrawerPayload(amountCents, note)),
      })
      if (!res.ok) {
        setError(await errorTextOf(res, 'The drawer could not be closed.'))
        return
      }
      const body = (await res.json()) as { session?: Record<string, string | null> }
      // The variance is shown from what the server computed, never from a
      // local subtraction — the server is the one that summed the events.
      setSummary(summariseClose(body.session ?? {}))
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  // ── Closed out: the count, and what it means ──────────────────────────────
  if (summary) {
    const variance = describeVariance(summary.varianceCents)
    return (
      <Dialog open={open} fullWidth maxWidth="xs">
        <DialogTitle>Drawer closed</DialogTitle>
        <DialogContent>
          <Row label="Opening float" amount={summary.openingFloatCents} />
          <Row label="Expected" amount={summary.expectedCents} />
          <Row label="Counted" amount={summary.countedCents} bold />
          <Divider sx={{ my: 1.5 }} />
          <Alert severity={variance.tone === 'balanced' ? 'success' : 'warning'}>
            {variance.text}
          </Alert>
          {variance.tone !== 'balanced' && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Tell a manager before the next shift takes the till.
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button
            fullWidth
            variant="contained"
            sx={{ height: 56 }}
            onClick={() => {
              reset()
              onClosedOut()
            }}
          >
            Done
          </Button>
        </DialogActions>
      </Dialog>
    )
  }

  const closing = session !== null

  return (
    <Dialog open={open} fullWidth maxWidth="xs">
      <DialogTitle>{closing ? 'Close the drawer' : 'Open the drawer'}</DialogTitle>
      <DialogContent>
        {closing && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Count the till and enter the total. You will see the expected figure once you have.
          </Typography>
        )}

        <TextField
          autoFocus
          fullWidth
          label={closing ? 'Counted total' : 'Opening float'}
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value)
            setError(null)
          }}
          placeholder="0.00"
          inputMode="decimal"
          slotProps={{ input: { startAdornment: <Box sx={{ mr: 0.5 }}>$</Box> } }}
          sx={{ '& input': { fontSize: 28, py: 1.5 } }}
        />

        {closing && (
          <TextField
            fullWidth
            label="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Anything that explains a difference"
            sx={{ mt: 2 }}
          />
        )}

        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={cancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={busy || amountCents === null}
          onClick={() => void (closing ? closeDrawer() : openDrawer())}
          sx={{ height: 56, flex: 1 }}
        >
          {closing ? 'Close drawer' : 'Open drawer'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

function Row({ label, amount, bold = false }: { label: string; amount: number; bold?: boolean }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.25 }}>
      <Typography variant="body2" sx={{ fontWeight: bold ? 600 : 400 }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{ fontWeight: bold ? 600 : 400, fontVariantNumeric: 'tabular-nums' }}
      >
        ${toDollars(amount)}
      </Typography>
    </Box>
  )
}

async function errorTextOf(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    return body.error ?? fallback
  } catch {
    return fallback
  }
}
