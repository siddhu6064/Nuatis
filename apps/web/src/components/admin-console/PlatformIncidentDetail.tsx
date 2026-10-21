'use client'

import { useCallback, useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import {
  ackCountdownLabel,
  canCloseFromUi,
  severityColor,
  type PlatformIncident,
  type PlatformIncidentEvent,
} from './types'

const EVENT_LABEL: Record<string, string> = {
  detected: 'Detected',
  status_changed: 'Status changed',
  assigned: 'Assigned',
  postmortem_written: 'Postmortem written',
  customer_message_published: 'Customer message published',
  customer_message_retracted: 'Customer message retracted',
}

export function PlatformIncidentDetail({ incidentId }: { incidentId: string }) {
  const [incident, setIncident] = useState<PlatformIncident | null>(null)
  const [events, setEvents] = useState<PlatformIncidentEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [postmortem, setPostmortem] = useState('')
  const [customerMessage, setCustomerMessage] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin-console/incidents/${incidentId}`)
      if (!res.ok) {
        setError(res.status === 404 ? 'Incident not found.' : 'Could not load this incident.')
        return
      }
      const body = (await res.json()) as {
        incident: PlatformIncident
        events: PlatformIncidentEvent[]
      }
      setIncident(body.incident)
      setEvents(body.events)
      setPostmortem(body.incident.postmortem ?? '')
      setCustomerMessage(body.incident.customer_message ?? '')
      setError(null)
    } catch {
      setError('Could not reach the server.')
    } finally {
      setLoading(false)
    }
  }, [incidentId])

  useEffect(() => {
    void load()
  }, [load])

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true)
      try {
        const res = await fetch(`/api/admin-console/incidents/${incidentId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string }
          // The API's own wording explains a refused transition better than a
          // generic message — "A SEV1 needs a postmortem before it can be
          // closed" is the rule, stated.
          setError(err.error ?? 'Could not update this incident.')
          return
        }
        setError(null)
        await load()
      } finally {
        setBusy(false)
      }
    },
    [incidentId, load]
  )

  async function saveCustomerMessage() {
    setBusy(true)
    try {
      await fetch(`/api/admin-console/incidents/${incidentId}/customer-message`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ customer_message: customerMessage }),
      })
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function setPublished(published: boolean) {
    setBusy(true)
    try {
      const res = await fetch(
        `/api/admin-console/incidents/${incidentId}/customer-message/publish`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ published }),
        }
      )
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        setError(err.error ?? 'Could not change publication.')
        return
      }
      setError(null)
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    )
  }
  if (!incident) {
    return <Alert severity="error">{error ?? 'Incident not found.'}</Alert>
  }

  const live = incident.status !== 'closed'
  const published = incident.customer_message_published_at !== null

  return (
    <Box>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1, flexWrap: 'wrap' }}>
        <Typography variant="h5">{incident.reference}</Typography>
        <Chip
          size="small"
          color={severityColor(incident.severity)}
          label={incident.severity.toUpperCase()}
        />
        <Chip
          size="small"
          label={incident.status.replace('_', ' ')}
          sx={{ textTransform: 'capitalize' }}
        />
        {!incident.acknowledged_at && (
          <Typography variant="body2" color="text.secondary">
            {ackCountdownLabel(incident.ack_due_at, new Date())}
          </Typography>
        )}
      </Box>
      <Typography variant="h6" sx={{ mb: 1 }}>
        {incident.title}
      </Typography>
      {incident.summary && (
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {incident.summary}
        </Typography>
      )}

      {live && (
        <Stack direction="row" spacing={1} sx={{ mb: 3, flexWrap: 'wrap', gap: 1 }}>
          {incident.status === 'detected' && (
            <Button
              variant="outlined"
              disabled={busy}
              onClick={() => void patch({ status: 'acknowledged' })}
            >
              Acknowledge
            </Button>
          )}
          {(incident.status === 'detected' || incident.status === 'acknowledged') && (
            <Button
              variant="outlined"
              disabled={busy}
              onClick={() => void patch({ status: 'mitigating' })}
            >
              Mitigating
            </Button>
          )}
          {incident.status !== 'resolved' &&
            incident.status !== 'postmortem_due' &&
            incident.status !== 'closed' && (
              <Button
                variant="contained"
                disabled={busy}
                onClick={() => void patch({ status: 'resolved' })}
              >
                Resolved
              </Button>
            )}
          {incident.status === 'resolved' &&
            (incident.severity === 'sev1' || incident.severity === 'sev2') && (
              <Button
                variant="outlined"
                disabled={busy}
                onClick={() => void patch({ status: 'postmortem_due' })}
              >
                Needs postmortem
              </Button>
            )}
          {canCloseFromUi(incident) && (
            <Button
              variant="outlined"
              color="success"
              disabled={busy}
              onClick={() => void patch({ status: 'closed' })}
            >
              Close
            </Button>
          )}
        </Stack>
      )}

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Postmortem
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Internal. A SEV1 or SEV2 cannot be closed until this is written.
        </Typography>
        <TextField
          fullWidth
          multiline
          minRows={6}
          value={postmortem}
          onChange={(e) => setPostmortem(e.target.value)}
          placeholder={'## What happened\n\n## Why\n\n## What we changed'}
        />
        <Button sx={{ mt: 1 }} disabled={busy} onClick={() => void patch({ postmortem })}>
          Save postmortem
        </Button>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Customer message
        </Typography>
        <Alert severity={published ? 'warning' : 'info'} sx={{ mb: 1 }}>
          {published
            ? 'Published — affected merchants can read this now.'
            : 'Not published. Nothing here reaches a merchant until you publish it.'}
        </Alert>
        <TextField
          fullWidth
          multiline
          minRows={3}
          value={customerMessage}
          onChange={(e) => setCustomerMessage(e.target.value)}
          placeholder="Card payments were briefly unavailable this morning."
          helperText="Write this for a merchant. The title and summary above are never shown to them."
        />
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <Button disabled={busy} onClick={() => void saveCustomerMessage()}>
            Save draft
          </Button>
          {published ? (
            <Button color="warning" disabled={busy} onClick={() => void setPublished(false)}>
              Retract
            </Button>
          ) : (
            <Button
              variant="contained"
              disabled={busy || !customerMessage.trim()}
              onClick={() => void setPublished(true)}
            >
              Publish to affected merchants
            </Button>
          )}
        </Stack>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Timeline
        </Typography>
        {events.length === 0 ? (
          <Typography color="text.secondary">Nothing recorded yet.</Typography>
        ) : (
          <Stack divider={<Divider />} spacing={1}>
            {events.map((e) => (
              <Box key={e.id} sx={{ display: 'flex', gap: 2, py: 0.5 }}>
                <Typography variant="body2" color="text.secondary" sx={{ minWidth: 170 }}>
                  {new Date(e.at).toLocaleString()}
                </Typography>
                <Typography variant="body2" sx={{ flex: 1 }}>
                  {EVENT_LABEL[e.kind] ?? e.kind}
                  {e.actor_kind === 'system' && (
                    <Chip size="small" label="automatic" sx={{ ml: 1 }} />
                  )}
                </Typography>
              </Box>
            ))}
          </Stack>
        )}
      </Paper>
    </Box>
  )
}
