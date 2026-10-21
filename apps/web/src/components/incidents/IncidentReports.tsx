'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Box from '@mui/material/Box'
import Paper from '@mui/material/Paper'
import Alert from '@mui/material/Alert'
import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'
import CircularProgress from '@mui/material/CircularProgress'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import { toDollars } from './types'

interface ByType {
  type_key: string
  label: string
  count: number
  cost_cents: number
}
interface ByStaff {
  staff_id: string
  staff_name: string | null
  count: number
  cost_cents: number
}
interface Recurring {
  type_key: string
  label: string
  location_id: string
  count: number
}
interface Summary {
  from: string
  to: string
  byType: ByType[]
  byStaff: ByStaff[]
  recurring: Recurring[]
}

export default function IncidentReports() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/incidents/reports/summary')
      if (res.status === 403) {
        setError('The Incidents module is not enabled on this plan.')
        return
      }
      if (!res.ok) {
        setError('Could not load the report.')
        return
      }
      setSummary((await res.json()) as Summary)
    } catch {
      setError('Could not reach the server.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (!summary) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">{error ?? 'Could not load the report.'}</Alert>
      </Box>
    )
  }

  const total = summary.byType.reduce((sum, t) => sum + t.cost_cents, 0)
  const count = summary.byType.reduce((sum, t) => sum + t.count, 0)

  return (
    <Box sx={{ p: 3, maxWidth: 1000 }}>
      <Link href="/incidents">← All incidents</Link>

      <Typography variant="h4" sx={{ mt: 2 }}>
        Incident report
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3 }}>
        {new Date(summary.from).toLocaleDateString()} – {new Date(summary.to).toLocaleDateString()}{' '}
        · {count} incident
        {count === 1 ? '' : 's'} · ${toDollars(total)}
      </Typography>

      {/*
        Per-staff first, deliberately.

        The authorisation threshold has a known weakness: a cashier who learns
        it is $10 can comp $9.99 all shift and never once need a manager. The
        mitigation was never a lower threshold — it was making the pattern
        visible. Sorted by total descending by the API, so the outlier is the
        first row of the first table on the page.
      */}
      <Typography variant="h6" sx={{ mb: 1 }}>
        By staff member
      </Typography>
      <Paper elevation={0} sx={{ border: 1, borderColor: 'divider', mb: 4 }}>
        {summary.byStaff.length === 0 ? (
          <Typography sx={{ p: 2 }} color="text.secondary">
            Nothing reported from a register this period.
          </Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Staff member</TableCell>
                <TableCell align="right">Incidents</TableCell>
                <TableCell align="right">Total</TableCell>
                <TableCell align="right">Average</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {summary.byStaff.map((row, i) => (
                <TableRow key={row.staff_id} hover>
                  <TableCell>
                    {row.staff_name ?? 'Unknown'}
                    {/* The top row is only worth flagging when there is
                        something to compare it against. */}
                    {i === 0 && summary.byStaff.length > 1 && (
                      <Chip size="small" label="Highest" sx={{ ml: 1 }} />
                    )}
                  </TableCell>
                  <TableCell align="right">{row.count}</TableCell>
                  <TableCell align="right">${toDollars(row.cost_cents)}</TableCell>
                  <TableCell align="right">
                    ${toDollars(Math.round(row.cost_cents / row.count))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>

      <Typography variant="h6" sx={{ mb: 1 }}>
        By type
      </Typography>
      <Paper elevation={0} sx={{ border: 1, borderColor: 'divider', mb: 4 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Type</TableCell>
              <TableCell align="right">Incidents</TableCell>
              <TableCell align="right">Cost</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {summary.byType.map((row) => (
              <TableRow key={row.type_key} hover>
                <TableCell>{row.label}</TableCell>
                <TableCell align="right">{row.count}</TableCell>
                <TableCell align="right">
                  {row.cost_cents > 0 ? `$${toDollars(row.cost_cents)}` : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      <Typography variant="h6" sx={{ mb: 1 }}>
        Recurring
      </Typography>
      <Paper elevation={0} sx={{ border: 1, borderColor: 'divider' }}>
        {summary.recurring.length === 0 ? (
          <Typography sx={{ p: 2 }} color="text.secondary">
            No pattern yet. Three of the same thing at one location starts looking like one.
          </Typography>
        ) : (
          <Table size="small">
            <TableBody>
              {summary.recurring.map((row) => (
                <TableRow key={`${row.type_key}-${row.location_id}`} hover>
                  <TableCell>
                    <strong>{row.label}</strong> happened {row.count} times at one location
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Paper>
    </Box>
  )
}
