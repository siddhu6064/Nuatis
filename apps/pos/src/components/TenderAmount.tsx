'use client'

import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { toDollars } from '@nuatis/pos-core'
import type { TenderMethod } from '@nuatis/pos-core'

interface TenderAmountProps {
  method: TenderMethod
  balanceCents: number
  onTake: (amountCents: number) => void
  onBack: () => void
}

/** Notes a cashier actually reaches for, above the balance. */
function quickAmounts(balanceCents: number): number[] {
  const notes = [500, 1000, 2000, 5000, 10000]
  return [balanceCents, ...notes.filter((n) => n > balanceCents).slice(0, 3)]
}

const METHOD_LABEL: Record<TenderMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  gift_card: 'Gift card',
}

/**
 * Amount entry for one payment.
 *
 * Used for both cash and card so any leg can be a partial amount — "put $10 on
 * this card and the rest on another" is an ordinary request, and a card button
 * hard-wired to the full balance cannot express it.
 *
 * Card is pre-filled with the balance, since charging the whole thing is the
 * common case and the cashier can just confirm. Cash starts empty: the number
 * that matters is what the customer actually handed over, and pre-filling it
 * invites tapping through without counting.
 *
 * Only cash may exceed the balance — that is change. Overcharging a card is a
 * refund waiting to happen, so the confirm button refuses it.
 */
export function TenderAmount({ method, balanceCents, onTake, onBack }: TenderAmountProps) {
  const isCash = method === 'cash'
  const [entry, setEntry] = useState(isCash ? '' : String(balanceCents))

  const entered = entry === '' ? 0 : Number(entry)
  const change = isCash && entered > balanceCents ? entered - balanceCents : 0
  const short = entered > 0 && entered < balanceCents ? balanceCents - entered : 0
  const overOnCard = !isCash && entered > balanceCents

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
            ${toDollars(short)} left after this — the rest can go on another payment
          </Typography>
        )}
        {overOnCard && (
          <Typography color="error">A card cannot be charged above the balance</Typography>
        )}
      </Box>

      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
        {(isCash ? quickAmounts(balanceCents) : [balanceCents]).map((amount, i) => (
          <Button
            key={`${amount}-${i}`}
            variant="outlined"
            onClick={() => setEntry(String(amount))}
            sx={{ flex: '1 1 0', minWidth: 88 }}
          >
            {i === 0 ? `Full $${toDollars(amount)}` : `$${toDollars(amount)}`}
          </Button>
        ))}
        <Button variant="text" onClick={() => setEntry('')} sx={{ minWidth: 72 }}>
          Clear
        </Button>
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
          disabled={entered <= 0 || overOnCard}
          onClick={() => onTake(entered)}
          sx={{ height: 60 }}
        >
          {METHOD_LABEL[method]} ${toDollars(entered)}
        </Button>
      </Box>
    </Box>
  )
}
