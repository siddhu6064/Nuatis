'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'
import Snackbar from '@mui/material/Snackbar'
import CircularProgress from '@mui/material/CircularProgress'
import { TicketCard } from '@/components/TicketCard'
import { StationFilter } from '@/components/StationFilter'
import { ReportTicketIssueDialog, type IncidentType } from '@/components/ReportTicketIssueDialog'
import { usePosSocket } from '@nuatis/pos-web/ui'
import {
  applyEvent,
  filterByStation,
  sortTickets,
  stationsOf,
  type SocketStatus,
  type Ticket,
} from '@nuatis/pos-web/tickets'

const LOCATION_ID = process.env.NEXT_PUBLIC_POS_LOCATION_ID ?? ''
const API_ORIGIN = process.env.NEXT_PUBLIC_API_ORIGIN ?? 'http://localhost:3001'
const SOCKET_URL = `${API_ORIGIN.replace(/^http/, 'ws')}/ws/pos`

const STATUS_TEXT: Record<SocketStatus, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
  offline: 'Offline — retrying',
}

export default function BoardPage() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [station, setStation] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyTicketId, setBusyTicketId] = useState<string | null>(null)
  const [incidentTypes, setIncidentTypes] = useState<IncidentType[]>([])
  const [reportingTicket, setReportingTicket] = useState<Ticket | null>(null)
  const [reportedRef, setReportedRef] = useState<string | null>(null)
  // One clock for the whole board rather than a timer per card: fifty cards
  // each running their own interval is fifty re-renders a second.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  /**
   * Load the board over HTTP first, then let the socket apply changes on top.
   *
   * Socket-only would show an empty kitchen to any screen that connects after
   * a ticket was fired — which is every screen that reboots mid-service.
   */
  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const params = new URLSearchParams({ location_id: LOCATION_ID })
        const [res, typesRes] = await Promise.all([
          fetch(`/api/pos/tickets?${params.toString()}`),
          fetch('/api/pos/incidents/types'),
        ])

        // A failure here costs the report button, not the board. A kitchen
        // display that will not show tickets because a reporting feature failed
        // would be a poor trade.
        if (typesRes.ok) {
          const body = (await typesRes.json()) as { types: IncidentType[] }
          setIncidentTypes(body.types)
        }

        if (res.status === 401) {
          // The 12h session ran out. Back to the PIN screen rather than an
          // empty board that looks like a quiet kitchen.
          window.location.assign('/sign-in')
          return
        }
        if (!res.ok) {
          setError(
            res.status === 403
              ? 'The POS module is not enabled for this business.'
              : 'Could not load tickets.'
          )
          return
        }

        const body = (await res.json()) as { tickets: Ticket[] }
        if (cancelled) return
        // Bumped tickets are done; the board shows what still has to be cooked.
        setTickets(sortTickets(body.tickets.filter((t) => t.status !== 'bumped')))
      } catch {
        if (!cancelled) setError('Could not reach the server.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const onEvent = useCallback((event: { type: string; ticket: unknown }) => {
    setTickets((current) => applyEvent(current, event, LOCATION_ID))
  }, [])

  const status = usePosSocket({ url: SOCKET_URL, onEvent })

  const setStatus = useCallback(
    async (ticket: Ticket, next: 'in_progress' | 'ready' | 'bumped') => {
      setBusyTicketId(ticket.id)
      // Optimistic: a cook who taps Bump and watches the ticket sit there taps
      // it again. The socket echo re-applies the same change, and applyEvent
      // upserts, so the round trip is idempotent.
      const previous = tickets
      setTickets((current) =>
        applyEvent(
          current,
          { type: 'ticket.updated', ticket: { ...ticket, status: next } },
          LOCATION_ID
        )
      )

      try {
        const res = await fetch(`/api/pos/tickets/${ticket.id}/status`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: next }),
        })
        if (!res.ok) {
          setTickets(previous)
          setError('That did not save — the kitchen display may be out of date.')
        }
      } catch {
        setTickets(previous)
        setError('That did not save — the kitchen display may be out of date.')
      } finally {
        setBusyTicketId(null)
      }
    },
    [tickets]
  )

  const stations = useMemo(() => stationsOf(tickets), [tickets])
  const visible = useMemo(() => filterByStation(tickets, station), [tickets, station])

  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box component="main" sx={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <Box
        sx={{
          px: 3,
          py: 2,
          borderBottom: 1,
          borderColor: 'divider',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 2,
          flexWrap: 'wrap',
        }}
      >
        <Typography variant="h4">Kitchen</Typography>
        <StationFilter stations={stations} selected={station} onSelect={setStation} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box
            sx={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              bgcolor: status === 'live' ? 'success.main' : 'warning.main',
            }}
          />
          <Typography color="text.secondary">{STATUS_TEXT[status]}</Typography>
        </Box>
      </Box>

      {error && (
        <Alert severity="warning" onClose={() => setError(null)} sx={{ m: 2 }}>
          {error}
        </Alert>
      )}

      {visible.length === 0 ? (
        <Box sx={{ display: 'grid', placeItems: 'center', flex: 1 }}>
          <Typography variant="h5" color="text.secondary">
            No tickets.
          </Typography>
        </Box>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 2,
            p: 2,
          }}
        >
          {visible.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              now={now}
              busy={busyTicketId === ticket.id}
              onStart={() => void setStatus(ticket, 'in_progress')}
              onReady={() => void setStatus(ticket, 'ready')}
              onBump={() => void setStatus(ticket, 'bumped')}
              onReportIssue={() => setReportingTicket(ticket)}
            />
          ))}
        </Box>
      )}

      <ReportTicketIssueDialog
        ticket={reportingTicket}
        types={incidentTypes}
        onClose={() => setReportingTicket(null)}
        onReported={setReportedRef}
      />

      <Snackbar
        open={reportedRef !== null}
        autoHideDuration={4000}
        onClose={() => setReportedRef(null)}
        message={`Reported as ${reportedRef}`}
      />
    </Box>
  )
}
