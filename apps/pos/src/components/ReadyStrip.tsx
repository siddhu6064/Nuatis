'use client'

import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { elapsedLabel, type Ticket } from '@nuatis/pos-web/tickets'
import { callLabel } from '@/lib/ready-orders'

interface ReadyStripProps {
  tickets: Ticket[]
  /** Passed in so every chip on one render agrees and the strip re-renders once
   *  a second, rather than each chip running its own timer. */
  now: number
  onHandOver: (ticket: Ticket) => void
  busyTicketId: string | null
}

/**
 * Orders the kitchen has cooked and the counter has not yet handed over.
 *
 * A horizontal strip rather than a panel: the menu and cart are what a cashier
 * uses continuously, and ringing up the next customer must not get narrower
 * because three orders are waiting. It takes no space at all when nothing is
 * ready, which is most of the time.
 */
export function ReadyStrip({ tickets, now, onHandOver, busyTicketId }: ReadyStripProps) {
  if (tickets.length === 0) return null

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 2,
        py: 1.5,
        bgcolor: 'success.main',
        color: 'common.white',
        overflowX: 'auto',
        flexShrink: 0,
      }}
    >
      <Typography sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
        Ready · {tickets.length}
      </Typography>

      {tickets.map((ticket) => (
        <Button
          key={ticket.id}
          variant="contained"
          color="inherit"
          disabled={busyTicketId === ticket.id}
          onClick={() => onHandOver(ticket)}
          sx={{
            flexShrink: 0,
            bgcolor: 'common.white',
            color: 'success.main',
            height: 56,
            px: 2,
            display: 'flex',
            flexDirection: 'column',
            gap: 0,
            lineHeight: 1.2,
          }}
        >
          <Box component="span" sx={{ fontWeight: 700 }}>
            {callLabel(ticket)}
          </Box>
          {/* How long it has been sitting — the number that decides which one
              to carry out first when three are up at once. */}
          <Box
            component="span"
            sx={{ fontSize: '0.75rem', opacity: 0.75, fontVariantNumeric: 'tabular-nums' }}
          >
            {elapsedLabel(ticket.fired_at, now)}
          </Box>
        </Button>
      ))}
    </Box>
  )
}
