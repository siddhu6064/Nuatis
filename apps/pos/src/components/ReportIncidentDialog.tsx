'use client'

import { useEffect, useMemo, useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'
import TextField from '@mui/material/TextField'
import { toDollars } from '@nuatis/pos-core'
import { needsManagerPin, reportIncident, type IncidentInput } from '@/lib/report-incident'

export interface IncidentType {
  key: string
  label: string
  default_severity: string
  requires_cost: boolean
}

interface ReportIncidentDialogProps {
  open: boolean
  types: IncidentType[]
  /** Threshold in cents above which a manager PIN is needed. */
  thresholdCents: number
  locationId: string | null
  /** The sale this is about, when there is one. */
  orderId: string | null
  reportedByStaffId: string | null
  onClose: () => void
  onReported: (reference: string) => void
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'back'] as const

/**
 * Report an issue from the register.
 *
 * One screen, not a wizard: this happens with a queue waiting, and every extra
 * step is a reason to not bother logging it at all. Type, amount, done — the
 * PIN pad only appears when the amount actually needs one.
 */
export function ReportIncidentDialog({
  open,
  types,
  thresholdCents,
  locationId,
  orderId,
  reportedByStaffId,
  onClose,
  onReported,
}: ReportIncidentDialogProps) {
  const [typeKey, setTypeKey] = useState('')
  const [entry, setEntry] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Reset between openings, so the previous report's amount is never attached
  // to the next one.
  useEffect(() => {
    if (!open) return
    setTypeKey('')
    setEntry('')
    setPin('')
    setError(null)
  }, [open])

  const type = useMemo(() => types.find((t) => t.key === typeKey), [types, typeKey])
  const costCents = entry === '' ? 0 : Number(entry)
  const pinRequired = needsManagerPin(costCents, thresholdCents)
  const costMissing = !!type?.requires_cost && costCents <= 0

  function press(key: string) {
    setEntry((current) => {
      if (key === 'back') return current.slice(0, -1)
      if (current.length >= 6) return current
      return current === '0' ? key : current + key
    })
  }

  async function submit() {
    if (!type) return
    setBusy(true)
    setError(null)

    const input: IncidentInput = {
      typeKey: type.key,
      title: type.label,
      costCents,
      locationId,
      orderId,
      kitchenTicketId: null,
      reportedByStaffId,
      managerPin: pin === '' ? null : pin,
    }

    try {
      const incident = await reportIncident(input)
      onReported(incident.reference)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That could not be reported.')
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>Report an issue</DialogTitle>

      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1, mb: 2 }}>
          {types.map((t) => (
            <Button
              key={t.key}
              variant={t.key === typeKey ? 'contained' : 'outlined'}
              onClick={() => setTypeKey(t.key)}
              disabled={busy}
              sx={{ height: 64, textTransform: 'none' }}
            >
              {t.label}
            </Button>
          ))}
        </Box>

        {type && (
          <>
            <Box sx={{ textAlign: 'right', mb: 1 }}>
              <Typography sx={{ fontSize: '2rem', fontWeight: 700, lineHeight: 1.1 }}>
                ${toDollars(costCents)}
              </Typography>
              {costMissing && (
                <Typography color="error" variant="body2">
                  {type.label} needs an amount
                </Typography>
              )}
              {pinRequired && (
                <Typography color="text.secondary" variant="body2">
                  Over ${toDollars(thresholdCents)} — a manager has to approve this
                </Typography>
              )}
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
              {KEYS.map((key) => (
                <Button
                  key={key}
                  variant="outlined"
                  onClick={() => press(key)}
                  disabled={busy}
                  sx={{ height: 56, fontSize: '1.125rem' }}
                >
                  {key === 'back' ? '⌫' : key}
                </Button>
              ))}
            </Box>

            {/* Only asked for when the amount actually needs it. Prompting on a
                free coffee is how staff learn to stop reporting anything. */}
            {pinRequired && (
              <TextField
                fullWidth
                type="password"
                inputMode="numeric"
                label="Manager PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                disabled={busy}
                sx={{ mt: 2 }}
              />
            )}
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={busy || !type || costMissing || (pinRequired && pin.length < 4)}
          onClick={() => void submit()}
          sx={{ height: 56 }}
        >
          Report
        </Button>
      </DialogActions>
    </Dialog>
  )
}
