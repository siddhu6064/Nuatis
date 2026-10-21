'use client'

import { useState } from 'react'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import { toDollars } from '@nuatis/pos-core'
import { tipFromBps, TIP_PRESETS_BPS } from '@/lib/checkout-machine'

interface TipPickerProps {
  preTipTotalCents: number
  tipCents: number
  onChange: (tipCents: number) => void
  onContinue: () => void
}

export function TipPicker({ preTipTotalCents, tipCents, onChange, onContinue }: TipPickerProps) {
  const [custom, setCustom] = useState('')

  return (
    <Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Add a tip on ${toDollars(preTipTotalCents)}
      </Typography>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1.5 }}>
        {TIP_PRESETS_BPS.map((bps) => {
          const amount = tipFromBps(preTipTotalCents, bps)
          const active = tipCents === amount && amount > 0
          return (
            <Button
              key={bps}
              variant={active ? 'contained' : 'outlined'}
              onClick={() => {
                setCustom('')
                onChange(amount)
              }}
              sx={{ height: 72, flexDirection: 'column', gap: 0.25 }}
            >
              <Box component="span" sx={{ fontSize: '1.25rem', fontWeight: 700 }}>
                {bps / 100}%
              </Box>
              <Box component="span" sx={{ fontSize: '0.875rem', opacity: 0.8 }}>
                ${toDollars(amount)}
              </Box>
            </Button>
          )
        })}

        <Button
          variant={tipCents === 0 && custom === '' ? 'contained' : 'outlined'}
          onClick={() => {
            setCustom('')
            onChange(0)
          }}
          sx={{ height: 72 }}
        >
          No tip
        </Button>

        <Box
          component="input"
          inputMode="decimal"
          placeholder="Custom $"
          value={custom}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
            const raw = e.target.value.replace(/[^0-9.]/g, '')
            setCustom(raw)
            const parsed = Number(raw)
            // An in-progress "12." is not a number yet — leave the tip alone
            // rather than flickering it to 0 between keystrokes.
            if (raw !== '' && Number.isFinite(parsed)) onChange(Math.round(parsed * 100))
          }}
          sx={{
            height: 72,
            borderRadius: 3,
            border: '1px solid',
            borderColor: 'divider',
            px: 2,
            fontSize: '1.125rem',
            fontFamily: 'inherit',
            bgcolor: 'transparent',
          }}
        />
      </Box>

      <Button fullWidth variant="contained" onClick={onContinue} sx={{ mt: 3, height: 64 }}>
        Continue · ${toDollars(preTipTotalCents + tipCents)}
      </Button>
    </Box>
  )
}
