'use client'

import { useEffect, useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'
import { reportIncident } from '@nuatis/pos-web/incidents'

export interface IncidentType {
  key: string
  label: string
  default_severity: string
  requires_cost: boolean
}

interface ReportTicketIssueDialogProps {
  /** The ticket being reported against; null closes the dialog. */
  ticket: { id: string; ticket_number: number } | null
  types: IncidentType[]
  onClose: () => void
  onReported: (reference: string) => void
}

/**
 * Report an issue against a kitchen ticket.
 *
 * Kitchen-relevant types only, and no amount: a cook noticing a remake is not
 * pricing the food, and asking them to would mean the report does not get made.
 * A manager prices it later from the dashboard if it matters — which is also
 * why no PIN is ever needed here, since a zero-cost report is never above the
 * authorisation threshold.
 *
 * Types that require a cost are filtered out for the same reason: offering a
 * cook "Dropped / wastage" and then refusing it for want of an amount is a dead
 * end at the one moment they were willing to log something.
 */
export function ReportTicketIssueDialog({
  ticket,
  types,
  onClose,
  onReported,
}: ReportTicketIssueDialogProps) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (ticket) setError(null)
  }, [ticket])

  const reportable = types.filter((t) => !t.requires_cost)

  async function report(typeKey: string, label: string) {
    if (!ticket) return
    setBusy(true)
    setError(null)
    try {
      const incident = await reportIncident({
        typeKey,
        title: `${label} — ticket #${ticket.ticket_number}`,
        costCents: 0,
        // No location: the server derives it from the ticket. A location the
        // client chose is how an incident gets filed against the wrong site.
        locationId: null,
        orderId: null,
        kitchenTicketId: ticket.id,
        reportedByStaffId: null,
        managerPin: null,
      })
      onReported(incident.reference)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That could not be reported.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={ticket !== null} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>Issue on #{ticket?.ticket_number}</DialogTitle>

      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {reportable.length === 0 ? (
          <Typography color="text.secondary">Nothing to report against this ticket.</Typography>
        ) : (
          <Box sx={{ display: 'grid', gap: 1.5 }}>
            {reportable.map((t) => (
              <Button
                key={t.key}
                variant="outlined"
                disabled={busy}
                onClick={() => void report(t.key, t.label)}
                // One tap, no confirm step. A cook has one free hand.
                sx={{ height: 72, fontSize: '1.125rem', textTransform: 'none' }}
              >
                {t.label}
              </Button>
            ))}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} disabled={busy} sx={{ height: 56 }}>
          Cancel
        </Button>
      </DialogActions>
    </Dialog>
  )
}
