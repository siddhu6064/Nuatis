'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import Alert from '@mui/material/Alert'
import Typography from '@mui/material/Typography'
import CircularProgress from '@mui/material/CircularProgress'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import { SEVERITIES, SEVERITY_COLOR, STATUSES, isOverdue, toDollars, type Incident } from './types'

const LIVE_STATUSES = new Set(['open', 'triaged', 'in_progress'])

export default function IncidentsBoard() {
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [status, setStatus] = useState<string>('live')
  const [severity, setSeverity] = useState<string>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: '100' })
      // 'live' is not a server status — it is the three working ones, which is
      // what a manager opening this page actually wants to see.
      if (status !== 'live' && status !== 'all') params.set('status', status)
      if (severity !== 'all') params.set('severity', severity)

      const res = await fetch(`/api/incidents?${params.toString()}`)
      if (res.status === 403) {
        setError('The Incidents module is not enabled on this plan.')
        return
      }
      if (!res.ok) {
        setError('Could not load incidents.')
        return
      }
      const body = (await res.json()) as { data: Incident[] }
      setIncidents(body.data)
    } catch {
      setError('Could not reach the server.')
    } finally {
      setLoading(false)
    }
  }, [status, severity])

  useEffect(() => {
    void load()
  }, [load])

  const visible =
    status === 'live' ? incidents.filter((i) => LIVE_STATUSES.has(i.status)) : incidents

  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" sx={{ mb: 2 }}>
        Incidents
      </Typography>

      {error && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={status}
          onChange={(_, v: string | null) => v && setStatus(v)}
        >
          <ToggleButton value="live">Live</ToggleButton>
          {STATUSES.map((s) => (
            <ToggleButton key={s} value={s} sx={{ textTransform: 'capitalize' }}>
              {s.replace('_', ' ')}
            </ToggleButton>
          ))}
          <ToggleButton value="all">All</ToggleButton>
        </ToggleButtonGroup>

        <ToggleButtonGroup
          exclusive
          size="small"
          value={severity}
          onChange={(_, v: string | null) => v && setSeverity(v)}
        >
          <ToggleButton value="all">Any severity</ToggleButton>
          {SEVERITIES.map((s) => (
            <ToggleButton key={s} value={s} sx={{ textTransform: 'capitalize' }}>
              {s}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Box>

      {visible.length === 0 ? (
        <Typography color="text.secondary">Nothing to show.</Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Reference</TableCell>
              <TableCell>Title</TableCell>
              <TableCell>Severity</TableCell>
              <TableCell>Status</TableCell>
              <TableCell align="right">Cost</TableCell>
              <TableCell>Raised</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {visible.map((incident) => (
              <TableRow key={incident.id} hover>
                <TableCell>
                  <Link href={`/incidents/${incident.id}`}>{incident.reference}</Link>
                </TableCell>
                <TableCell>
                  {incident.title}
                  {/* Overdue is the one thing worth interrupting a scan for. */}
                  {isOverdue(incident) && (
                    <Chip size="small" color="error" label="Overdue" sx={{ ml: 1 }} />
                  )}
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    color={SEVERITY_COLOR[incident.severity]}
                    label={incident.severity}
                    sx={{ textTransform: 'capitalize' }}
                  />
                </TableCell>
                <TableCell sx={{ textTransform: 'capitalize' }}>
                  {incident.status.replace('_', ' ')}
                </TableCell>
                <TableCell align="right">
                  {incident.cost_cents > 0 ? `$${toDollars(incident.cost_cents)}` : '—'}
                </TableCell>
                <TableCell>{new Date(incident.created_at).toLocaleDateString()}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Box>
  )
}
