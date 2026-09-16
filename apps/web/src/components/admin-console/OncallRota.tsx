'use client'

import { useCallback, useEffect, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import FormControlLabel from '@mui/material/FormControlLabel'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

interface Shift {
  id: string
  user_id: string
  starts_at: string
  ends_at: string
  is_override: boolean
  note: string | null
}

interface OnCallNow {
  user_id: string | null
  user: { id: string; full_name: string } | null
}

export function OncallRota() {
  const [shifts, setShifts] = useState<Shift[]>([])
  const [now, setNow] = useState<OnCallNow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [userId, setUserId] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [isOverride, setIsOverride] = useState(false)

  const load = useCallback(async () => {
    try {
      const [shiftsRes, nowRes] = await Promise.all([
        fetch('/api/admin-console/oncall'),
        fetch('/api/admin-console/oncall/now'),
      ])
      if (!shiftsRes.ok || !nowRes.ok) {
        setError(shiftsRes.status === 403 ? 'Not authorized.' : 'Could not load the rota.')
        return
      }
      const shiftsBody = (await shiftsRes.json()) as { shifts: Shift[] }
      const nowBody = (await nowRes.json()) as OnCallNow
      setShifts(shiftsBody.shifts)
      setNow(nowBody)
      setError(null)
    } catch {
      setError('Could not reach the server.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function addShift() {
    setBusy(true)
    try {
      const res = await fetch('/api/admin-console/oncall', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          user_id: userId.trim(),
          // datetime-local gives a local wall-clock string with no zone; the
          // API stores timestamptz, so convert explicitly rather than letting
          // Postgres guess.
          starts_at: new Date(startsAt).toISOString(),
          ends_at: new Date(endsAt).toISOString(),
          is_override: isOverride,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? 'Could not add the shift.')
        return
      }
      setUserId('')
      setStartsAt('')
      setEndsAt('')
      setIsOverride(false)
      setError(null)
      await load()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  async function removeShift(id: string) {
    setBusy(true)
    try {
      await fetch(`/api/admin-console/oncall/${id}`, { method: 'DELETE' })
      await load()
    } finally {
      setBusy(false)
    }
  }

  const canAdd =
    userId.trim() !== '' &&
    startsAt !== '' &&
    endsAt !== '' &&
    Number.isFinite(Date.parse(startsAt)) &&
    Number.isFinite(Date.parse(endsAt)) &&
    Date.parse(endsAt) > Date.parse(startsAt)

  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box>
      <Typography variant="h5" sx={{ mb: 2 }}>
        On-call rota
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* An empty rota is a real operational state, so it is stated rather than
          rendered as a blank name. */}
      <Alert severity={now?.user_id ? 'info' : 'warning'} sx={{ mb: 3 }}>
        {now?.user_id
          ? `On call now: ${now.user?.full_name ?? now.user_id}`
          : 'Nobody is on call. New incidents will be declared with no assignee.'}
      </Alert>

      <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>
          Add a shift
        </Typography>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ alignItems: 'center' }}>
          <TextField
            label="User id"
            size="small"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            sx={{ minWidth: 260 }}
            helperText="Must be a platform-team user"
          />
          <TextField
            label="Starts"
            type="datetime-local"
            size="small"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="Ends"
            type="datetime-local"
            size="small"
            value={endsAt}
            onChange={(e) => setEndsAt(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <FormControlLabel
            control={
              <Switch checked={isOverride} onChange={(e) => setIsOverride(e.target.checked)} />
            }
            label="Override"
          />
          <Button variant="contained" disabled={busy || !canAdd} onClick={() => void addShift()}>
            Add
          </Button>
        </Stack>
      </Paper>

      {shifts.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">
            No shifts on the rota. Until one exists, incidents are declared unassigned.
          </Typography>
        </Paper>
      ) : (
        <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Who</TableCell>
                <TableCell>Starts</TableCell>
                <TableCell>Ends</TableCell>
                <TableCell>Kind</TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {shifts.map((s) => (
                <TableRow key={s.id} hover>
                  <TableCell>{s.user_id}</TableCell>
                  <TableCell>{new Date(s.starts_at).toLocaleString()}</TableCell>
                  <TableCell>{new Date(s.ends_at).toLocaleString()}</TableCell>
                  <TableCell>
                    {/* Overrides render distinctly — the whole point of the flag
                        is that a reader can see the swap. */}
                    {s.is_override ? (
                      <Chip size="small" color="warning" label="override" />
                    ) : (
                      <Chip size="small" label="regular" />
                    )}
                  </TableCell>
                  <TableCell align="right">
                    <Button size="small" disabled={busy} onClick={() => void removeShift(s.id)}>
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Paper>
      )}
    </Box>
  )
}
