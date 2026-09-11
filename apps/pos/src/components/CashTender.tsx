'use client'

import { useMemo, useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { toCents, toDollars } from '@nuatis/pos-core'

interface CashTenderProps {
  balanceCents: number
  onTake: (amountCents: number) => void
  onBack: () => void
}

/** Notes a cashier actually reaches for. */
function quickAmounts(balanceCents: number): number[] {
  const exact = balanceCents
  const notes = [500, 1000, 2000, 5000, 10000]
  // Next note up from the balance, so the buttons are plausible tenders
  // rather than a fixed list that is useless on a $90 order.
  const useful = notes.filter((n) => n > exact).slice(0, 3)
  return [exact, ...useful]
}

export function CashTender({ balanceCents, onTake, onBack }: CashTenderProps) {
  const [entry, setEntry] = useState('')

  const entered = useMemo(() => {
    if (entry === '') return 0
    // Keypad entry is in cents: typing 1 2 3 4 means $12.34, which is how
    // every till behaves — no decimal point to hunt for.
    return Number(entry)
  }, [entry])

  const change = entered > balanceCents ? entered - balanceCents : 0
  const short = entered > 0 && entered < balanceCents ? balanceCents - entered : 0

  function press(key: string) {
    setEntry((current) => {
      if (key === 'back') return current.slice(0, -1)
      // Cap the length so a stuck finger cannot enter a five-figure tender.
      if (current.length >= 7) return current
      return current === '0' ? key : current + key
    })
  }

  return (
    <Box>
      <Typography variant="body2" color="text.secondary">
        Balance ${toDollars(balanceCents)}
      </Typography>

      <Box sx={{ my: 2, textAlign: 'right' }}>
        <Typography sx={{ fontSize: '2.5rem', fontWeight: 700, lineHeight: 1.1 }}>
          ${toDollars(entered)}
        </Typography>
        {change > 0 && (
          <Typography color="primary" sx={{ fontWeight: 600 }}>
            Change due ${toDollars(change)}
          </Typography>
        )}
        {short > 0 && (
          <Typography color="text.secondary">
            ${toDollars(short)} still owing — this will be a split payment
          </Typography>
        )}
      </Box>

      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        {quickAmounts(balanceCents).map((amount, i) => (
          <Button
            key={`${amount}-${i}`}
            variant="outlined"
            onClick={() => setEntry(String(amount))}
            sx={{ flex: '1 1 0', minWidth: 88 }}
          >
            {i === 0 ? `Exact $${toDollars(amount)}` : `$${toDollars(amount)}`}
          </Button>
        ))}
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'back'].map((key) => (
          <Button
            key={key}
            variant="outlined"
            onClick={() => press(key)}
            sx={{ height: 64, fontSize: '1.25rem' }}
          >
            {key === 'back' ? '⌫' : key}
          </Button>
        ))}
      </Box>

      <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
        <Button variant="text" onClick={onBack} sx={{ height: 60 }}>
          Back
        </Button>
        <Button
          fullWidth
          variant="contained"
          disabled={entered <= 0}
          onClick={() => {
            onTake(entered)
            setEntry('')
          }}
          sx={{ height: 60 }}
        >
          Take ${toDollars(entered)}
        </Button>
      </Box>
    </Box>
  )
}

export { toCents }
