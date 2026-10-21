'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Box from '@mui/material/Box'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import MenuItem from '@mui/material/MenuItem'
import Paper from '@mui/material/Paper'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import {
  PLATFORM_SEVERITIES,
  PLATFORM_STATUSES,
  ackCountdownLabel,
  severityColor,
  type PlatformIncident,
} from './types'
import { DeclareIncidentDialog } from './DeclareIncidentDialog'

export function PlatformIncidentsBoard() {
  const [incidents, setIncidents] = useState<PlatformIncident[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState('')
  const [severity, setSeverity] = useState('')
  const [declaring, setDeclaring] = useState(false)
  // One clock for the whole table, so every countdown agrees and the page
  // re-renders once a minute rather than once per row.
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (status) params.set('status', status)
      if (severity) params.set('severity', severity)
      const res = await fetch(`/api/admin-console/incidents?${params.toString()}`)
      if (!res.ok) {
        setError(res.status === 403 ? 'Not authorized.' : 'Could not load incidents.')
        return
      }
      const body = (await res.json()) as { data: PlatformIncident[] }
      setIncidents(body.data)
      setError(null)
    } catch {
      setError('Could not reach the server.')
    } finally {
      setLoading(false)
    }
  }, [status, severity])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" sx={{ flex: 1 }}>
          Platform incidents
        </Typography>
        <TextField
          select
          size="small"
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          sx={{ minWidth: 160 }}
        >
          <MenuItem value="">All</MenuItem>
          {PLATFORM_STATUSES.map((s) => (
            <MenuItem key={s} value={s}>
              {s.replace('_', ' ')}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          size="small"
          label="Severity"
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          sx={{ minWidth: 140 }}
        >
          <MenuItem value="">All</MenuItem>
          {PLATFORM_SEVERITIES.map((s) => (
            <MenuItem key={s} value={s}>
              {s.toUpperCase()}
            </MenuItem>
          ))}
        </TextField>
        <Button variant="contained" onClick={() => setDeclaring(true)}>
          Declare incident
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : incidents.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            No incidents match. A quiet board is the good outcome.
          </Typography>
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Reference</TableCell>
                <TableCell>Severity</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Title</TableCell>
                <TableCell>Component</TableCell>
                <TableCell>Ack</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {incidents.map((inc) => (
                <TableRow key={inc.id} hover>
                  <TableCell>
                    <Link href={`/admin-console/incidents/${inc.id}`}>{inc.reference}</Link>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={severityColor(inc.severity)}
                      label={inc.severity.toUpperCase()}
                    />
                  </TableCell>
                  <TableCell sx={{ textTransform: 'capitalize' }}>
                    {inc.status.replace('_', ' ')}
                  </TableCell>
                  <TableCell>{inc.title}</TableCell>
                  <TableCell>{inc.component ?? '—'}</TableCell>
                  <TableCell>
                    {inc.acknowledged_at ? 'acknowledged' : ackCountdownLabel(inc.ack_due_at, now)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}

      <DeclareIncidentDialog
        open={declaring}
        onClose={() => setDeclaring(false)}
        onDeclared={() => {
          setDeclaring(false)
          void load()
        }}
      />
    </Box>
  )
}
