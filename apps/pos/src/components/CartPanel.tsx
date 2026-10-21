'use client'

import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import { toDollars, lineTotalCents, type CartLine, type CartTotals } from '@nuatis/pos-core'

interface CartPanelProps {
  lines: CartLine[]
  totals: CartTotals
  onSetQuantity: (index: number, quantity: number) => void
  onClear: () => void
  onCharge: () => void
}

export function CartPanel({ lines, totals, onSetQuantity, onClear, onCharge }: CartPanelProps) {
  const empty = lines.length === 0

  return (
    <Box
      sx={{
        width: 380,
        flexShrink: 0,
        borderLeft: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
      }}
    >
      <Box sx={{ p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">Order</Typography>
        <Button size="small" onClick={onClear} disabled={empty} sx={{ minHeight: 36 }}>
          Clear
        </Button>
      </Box>
      <Divider />

      <Box sx={{ flex: 1, overflowY: 'auto', p: empty ? 3 : 1 }}>
        {empty ? (
          <Typography color="text.secondary">Tap an item to start an order.</Typography>
        ) : (
          lines.map((line, index) => (
            <Box key={`${line.menuItemId}-${index}`} sx={{ px: 1, py: 1.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                <Typography sx={{ fontWeight: 600 }}>{line.name}</Typography>
                <Typography sx={{ fontWeight: 600 }}>${toDollars(lineTotalCents(line))}</Typography>
              </Box>

              {line.modifiers.length > 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {line.modifiers.map((m) => m.name).join(', ')}
                </Typography>
              )}

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                <IconButton
                  aria-label={`Decrease ${line.name}`}
                  onClick={() => onSetQuantity(index, line.quantity - 1)}
                  sx={{ border: 1, borderColor: 'divider' }}
                >
                  −
                </IconButton>
                <Typography sx={{ minWidth: 32, textAlign: 'center', fontWeight: 600 }}>
                  {line.quantity}
                </Typography>
                <IconButton
                  aria-label={`Increase ${line.name}`}
                  onClick={() => onSetQuantity(index, line.quantity + 1)}
                  sx={{ border: 1, borderColor: 'divider' }}
                >
                  +
                </IconButton>
              </Box>
            </Box>
          ))
        )}
      </Box>

      <Divider />
      <Box sx={{ p: 2 }}>
        <Row label="Subtotal" value={totals.subtotalCents} />
        <Row label="Tax" value={totals.taxCents} />
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1.5 }}>
          <Typography variant="h6">Total</Typography>
          <Typography variant="h6">${toDollars(totals.totalCents)}</Typography>
        </Box>
        <Button
          fullWidth
          variant="contained"
          disabled={empty}
          onClick={onCharge}
          sx={{ mt: 2, height: 64 }}
        >
          Charge ${toDollars(totals.totalCents)}
        </Button>
      </Box>
    </Box>
  )
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography color="text.secondary">${toDollars(value)}</Typography>
    </Box>
  )
}
