'use client'

import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { ageTone, elapsedLabel, type Ticket } from '@/lib/ticket-board'

interface TicketCardProps {
  ticket: Ticket
  /** Passed in rather than read from Date.now() so every card on one render
   *  agrees, and so the board drives a single re-render per second. */
  now: number
  onStart: () => void
  onBump: () => void
  busy: boolean
}

const TONE_COLOR = {
  fresh: 'divider',
  warm: 'warning.main',
  late: 'error.main',
} as const

export function TicketCard({ ticket, now, onStart, onBump, busy }: TicketCardProps) {
  const tone = ageTone(ticket.fired_at, now)
  const started = ticket.status === 'in_progress'

  return (
    <Paper
      elevation={0}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        // A 4px line is invisible across a kitchen. The whole card edge carries
        // the lateness signal instead.
        border: 3,
        borderColor: TONE_COLOR[tone],
        borderRadius: 3,
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          px: 2,
          py: 1.5,
          bgcolor: tone === 'fresh' ? 'background.default' : TONE_COLOR[tone],
          color: tone === 'fresh' ? 'text.primary' : 'common.white',
        }}
      >
        <Typography sx={{ fontSize: '1.75rem', fontWeight: 700, lineHeight: 1 }}>
          #{ticket.ticket_number}
        </Typography>
        <Typography
          sx={{ fontSize: '1.5rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}
        >
          {elapsedLabel(ticket.fired_at, now)}
        </Typography>
      </Box>

      {ticket.station && (
        <Typography
          variant="body2"
          sx={{ px: 2, pt: 1, textTransform: 'uppercase', letterSpacing: 1 }}
          color="text.secondary"
        >
          {ticket.station}
        </Typography>
      )}

      <Box sx={{ px: 2, py: 1.5, flex: 1 }}>
        {ticket.items.map((item, index) => (
          // Index fallback only: the API broadcasts stored rows, which have ids.
          // A card that silently collapses two lines into one is worse than a
          // key that is merely stable within a render.
          <Box key={item.id ?? index} sx={{ mb: 1.5 }}>
            <Typography sx={{ fontSize: '1.25rem', fontWeight: 600 }}>
              {Number(item.quantity)} × {item.name}
            </Typography>
            {item.modifiers.length > 0 && (
              <Typography color="text.secondary" sx={{ fontSize: '1.05rem' }}>
                {item.modifiers
                  .map((m) => m.option_name)
                  .filter(Boolean)
                  .join(', ')}
              </Typography>
            )}
            {item.notes && (
              // Allergies and "no onions" live here, so it must not read like
              // the modifiers above it.
              <Typography sx={{ fontSize: '1.05rem', fontWeight: 700 }} color="error.main">
                {item.notes}
              </Typography>
            )}
          </Box>
        ))}
      </Box>

      <Box sx={{ display: 'flex', gap: 1, p: 1.5, pt: 0 }}>
        {!started && (
          <Button variant="outlined" onClick={onStart} disabled={busy} sx={{ flex: 1, height: 64 }}>
            Start
          </Button>
        )}
        <Button
          variant="contained"
          onClick={onBump}
          disabled={busy}
          // The target for someone with full hands, or the back of a knuckle.
          sx={{ flex: 2, height: 64, fontSize: '1.25rem' }}
        >
          Bump
        </Button>
      </Box>
    </Paper>
  )
}
