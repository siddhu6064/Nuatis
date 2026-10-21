'use client'

import { useState } from 'react'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import MenuItem from '@mui/material/MenuItem'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import { COMPONENTS, PLATFORM_SEVERITIES } from './types'

/** SEV1 is defined by money, not by component — worth saying at the point of choosing. */
const SEVERITY_HINT: Record<string, string> = {
  sev1: 'Merchants cannot take money',
  sev2: 'A module is broken or badly degraded',
  sev3: 'Degraded, with a workaround',
  sev4: 'Cosmetic or internal-only',
}

export function DeclareIncidentDialog({
  open,
  onClose,
  onDeclared,
}: {
  open: boolean
  onClose: () => void
  onDeclared: () => void
}) {
  const [severity, setSeverity] = useState('sev3')
  const [title, setTitle] = useState('')
  const [component, setComponent] = useState('')
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin-console/incidents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          severity,
          title: title.trim(),
          component: component || null,
          summary: summary.trim() || null,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? 'Could not declare the incident.')
        return
      }
      setTitle('')
      setSummary('')
      setComponent('')
      setSeverity('sev3')
      onDeclared()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Declare an incident</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField
            select
            label="Severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            helperText={SEVERITY_HINT[severity]}
          >
            {PLATFORM_SEVERITIES.map((s) => (
              <MenuItem key={s} value={s}>
                {s.toUpperCase()} — {SEVERITY_HINT[s]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Register cannot take payment"
            required
          />
          <TextField
            select
            label="Component"
            value={component}
            onChange={(e) => setComponent(e.target.value)}
          >
            <MenuItem value="">Not sure yet</MenuItem>
            {COMPONENTS.map((c) => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            multiline
            minRows={2}
            helperText="Internal. Merchants never see this."
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void submit()} disabled={busy || !title.trim()}>
          Declare
        </Button>
      </DialogActions>
    </Dialog>
  )
}
