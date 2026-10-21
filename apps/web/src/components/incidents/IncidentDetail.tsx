'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Chip from '@mui/material/Chip'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import Divider from '@mui/material/Divider'
import CircularProgress from '@mui/material/CircularProgress'
import { SEVERITY_COLOR, isOverdue, toDollars, type Incident, type IncidentEvent } from './types'

/** Reads as a sentence in the timeline rather than a database value. */
const EVENT_LABEL: Record<string, string> = {
  reported: 'Reported',
  assigned: 'Assigned',
  status_changed: 'Status changed',
}

export default function IncidentDetail({ incidentId }: { incidentId: string }) {
  const [incident, setIncident] = useState<Incident | null>(null)
  const [events, setEvents] = useState<IncidentEvent[]>([])
  const [rootCause, setRootCause] = useState('')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/incidents/${incidentId}`)
      if (!res.ok) {
        setError(res.status === 404 ? 'Incident not found.' : 'Could not load this incident.')
        return
      }
      const body = (await res.json()) as { incident: Incident; events: IncidentEvent[] }
      setIncident(body.incident)
      setEvents(body.events)
      setRootCause(body.incident.root_cause ?? '')
      setNotes(body.incident.resolution_notes ?? '')
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
      setError(null)
      try {
        const res = await fetch(`/api/incidents/${incidentId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          // The API's own wording explains refused transitions better than a
          // generic message — "Cannot move an incident from resolved to open"
          // tells a manager exactly what happened.
          const errBody = (await res.json().catch(() => ({}))) as { error?: string }
          setError(errBody.error ?? 'That change could not be saved.')
          return
        }
        await load()
      } catch {
        setError('Could not reach the server.')
      } finally {
        setBusy(false)
      }
    },
    [incidentId, load]
  )

  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (!incident) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">{error ?? 'Incident not found.'}</Alert>
      </Box>
    )
  }

  const live = incident.status !== 'resolved' && incident.status !== 'cancelled'

  return (
    <Box sx={{ p: 3, maxWidth: 900 }}>
      <Link href="/incidents">← All incidents</Link>

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 2, mb: 1, flexWrap: 'wrap' }}>
        <Typography variant="h4">{incident.reference}</Typography>
        <Chip
          color={SEVERITY_COLOR[incident.severity]}
          label={incident.severity}
          sx={{ textTransform: 'capitalize' }}
        />
        <Chip label={incident.status.replace('_', ' ')} sx={{ textTransform: 'capitalize' }} />
        {isOverdue(incident) && <Chip color="error" label="Overdue" />}
      </Box>

      <Typography variant="h6" sx={{ mb: 1 }}>
        {incident.title}
      </Typography>
      {incident.description && (
        <Typography color="text.secondary" sx={{ mb: 2 }}>
          {incident.description}
        </Typography>
      )}
      {incident.cost_cents > 0 && (
        <Typography sx={{ mb: 2 }}>Cost ${toDollars(incident.cost_cents)}</Typography>
      )}

      {error && (
        <Alert severity="warning" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {live && (
        <Paper elevation={0} sx={{ p: 2, mb: 3, border: 1, borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
            {incident.status === 'open' && (
              <Button
                variant="outlined"
                disabled={busy}
                onClick={() => void patch({ status: 'triaged' })}
              >
                Triage
              </Button>
            )}
            {incident.status !== 'in_progress' && (
              <Button
                variant="outlined"
                disabled={busy}
                onClick={() => void patch({ status: 'in_progress' })}
              >
                Start work
              </Button>
            )}
            <Button
              variant="text"
              disabled={busy}
              onClick={() => void patch({ status: 'cancelled' })}
            >
              Cancel incident
            </Button>
          </Box>

          <Divider sx={{ mb: 2 }} />

          <TextField
            fullWidth
            label="Root cause"
            value={rootCause}
            onChange={(e) => setRootCause(e.target.value)}
            disabled={busy}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth
            multiline
            minRows={2}
            label="Resolution notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={busy}
            sx={{ mb: 2 }}
          />
          {/* Resolving without a root cause is how an incident log becomes a
              list of things that happened rather than things that were learned. */}
          <Button
            variant="contained"
            disabled={busy || rootCause.trim() === ''}
            onClick={() =>
              void patch({ status: 'resolved', root_cause: rootCause, resolution_notes: notes })
            }
          >
            Resolve
          </Button>
          {rootCause.trim() === '' && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              A root cause is needed to resolve this.
            </Typography>
          )}
        </Paper>
      )}

      <Typography variant="h6" sx={{ mb: 1 }}>
        Timeline
      </Typography>
      <Paper elevation={0} sx={{ border: 1, borderColor: 'divider' }}>
        {events.map((event, i) => (
          <Box key={event.id} sx={{ p: 2, borderTop: i === 0 ? 0 : 1, borderColor: 'divider' }}>
            <Typography variant="body2" color="text.secondary">
              {new Date(event.at).toLocaleString()} ·{' '}
              {/* A rule acted, not a person — worth saying out loud. */}
              {event.actor_kind === 'system' ? 'Automatically' : event.actor_kind}
            </Typography>
            <Typography>{EVENT_LABEL[event.kind] ?? event.kind}</Typography>
          </Box>
        ))}
      </Paper>
    </Box>
  )
}
