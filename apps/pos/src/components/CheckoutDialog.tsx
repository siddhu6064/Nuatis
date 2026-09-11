'use client'

import { useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'
import CircularProgress from '@mui/material/CircularProgress'
import Divider from '@mui/material/Divider'
import { toDollars } from '@nuatis/pos-core'
import { TipPicker } from './TipPicker'
import { TenderAmount } from './TenderAmount'
import type { TenderMethod } from '@nuatis/pos-core'
import type { UseCheckout } from '@/lib/useCheckout'

interface CheckoutDialogProps {
  checkout: UseCheckout
  preTipTotalCents: number
  /** Null when no drawer is open — cash is refused in that case. */
  drawerSessionId: string | null
  onDone: () => void
}

/**
 * Tip → tender → receipt.
 *
 * There is no separate "split payment" mode: the tender stage simply accepts
 * more than one leg, so a split is what happens when the first payment does
 * not cover the balance. That is one flow to build and one for a cashier to
 * learn, rather than a mode they have to decide to enter up front. Capped at
 * five legs.
 *
 * Card has two routes on purpose. "Card · $X" charges the whole balance in one
 * tap, which is nearly every sale. "Card — part of the balance" opens amount
 * entry, because "put $10 on this one and the rest on another" is an ordinary
 * request that a button hard-wired to the full balance cannot express.
 */
export function CheckoutDialog({
  checkout,
  preTipTotalCents,
  drawerSessionId,
  onDone,
}: CheckoutDialogProps) {
  const { state, totalDueCents, balanceCents, isSettled, busy } = checkout
  // Which method is having an amount entered, or null while choosing.
  const [entering, setEntering] = useState<TenderMethod | null>(null)

  const open = state.stage !== 'idle'

  function close() {
    setEntering(null)
    checkout.cancel()
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : close} fullWidth maxWidth="xs">
      <DialogTitle>
        {state.stage === 'tip' && 'Add a tip'}
        {state.stage === 'tender' && (entering === null ? 'Payment' : 'Amount')}
        {state.stage === 'processing' && 'Processing'}
        {state.stage === 'receipt' && 'Paid'}
      </DialogTitle>

      <DialogContent dividers>
        {state.error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {state.error}
          </Alert>
        )}

        {state.stage === 'tip' && (
          <TipPicker
            preTipTotalCents={preTipTotalCents}
            tipCents={state.tipCents}
            onChange={checkout.setTip}
            onContinue={checkout.toTender}
          />
        )}

        {state.stage === 'tender' && entering === null && (
          <Box>
            <Summary
              preTipTotalCents={preTipTotalCents}
              tipCents={state.tipCents}
              totalDueCents={totalDueCents}
            />

            {state.legs.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Divider sx={{ mb: 1 }} />
                {state.legs.map((leg, i) => (
                  <Box
                    key={`${leg.method}-${i}`}
                    sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5 }}
                  >
                    <Typography sx={{ textTransform: 'capitalize' }}>
                      {leg.method.replace('_', ' ')}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography>${toDollars(leg.amountCents)}</Typography>
                      <Button size="small" onClick={() => checkout.removeLeg(i)}>
                        Remove
                      </Button>
                    </Box>
                  </Box>
                ))}
                <Divider sx={{ mt: 1 }} />
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
                  <Typography sx={{ fontWeight: 700 }}>
                    {balanceCents > 0 ? 'Balance' : 'Change due'}
                  </Typography>
                  <Typography sx={{ fontWeight: 700 }}>
                    ${toDollars(Math.abs(balanceCents))}
                  </Typography>
                </Box>
              </Box>
            )}

            {!isSettled && (
              <Box sx={{ display: 'grid', gap: 1.5, mt: 2 }}>
                <Button
                  variant="contained"
                  disabled={busy}
                  onClick={() => void checkout.takeCard(balanceCents)}
                  sx={{ height: 64 }}
                >
                  Card · ${toDollars(balanceCents)}
                </Button>
                <Button
                  variant="outlined"
                  disabled={busy}
                  onClick={() => setEntering('card')}
                  sx={{ height: 56 }}
                >
                  Card — part of the balance
                </Button>
                <Button
                  variant="outlined"
                  disabled={busy || drawerSessionId === null}
                  onClick={() => setEntering('cash')}
                  sx={{ height: 64 }}
                >
                  Cash
                </Button>
                {drawerSessionId === null && (
                  <Typography variant="body2" color="text.secondary">
                    Open the cash drawer before taking cash, so the close-out balances.
                  </Typography>
                )}
              </Box>
            )}
          </Box>
        )}

        {state.stage === 'tender' && entering !== null && (
          <TenderAmount
            method={entering}
            balanceCents={balanceCents}
            onTake={(amount) => {
              if (entering === 'cash') checkout.takeCash(amount)
              else void checkout.takeCard(amount)
              setEntering(null)
            }}
            onBack={() => setEntering(null)}
          />
        )}

        {state.stage === 'processing' && (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 4, gap: 2 }}>
            <CircularProgress />
            <Typography color="text.secondary">Approving card…</Typography>
          </Box>
        )}

        {state.stage === 'receipt' && (
          <Box sx={{ py: 2 }}>
            <Typography variant="h4" sx={{ mb: 1 }}>
              ${toDollars(totalDueCents)}
            </Typography>
            {state.changeDueCents > 0 && (
              <Alert severity="info" sx={{ mt: 2 }}>
                Change due <strong>${toDollars(state.changeDueCents)}</strong>
              </Alert>
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 2 }}>
        {state.stage === 'receipt' ? (
          <Button fullWidth variant="contained" onClick={onDone} sx={{ height: 60 }}>
            New order
          </Button>
        ) : (
          <>
            <Button onClick={close} disabled={busy}>
              Cancel
            </Button>
            {state.stage === 'tender' && entering === null && (
              <Button variant="contained" disabled={!isSettled || busy} onClick={checkout.complete}>
                Finish
              </Button>
            )}
          </>
        )}
      </DialogActions>

      {busy && (
        <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
          <Box
            sx={{
              bgcolor: 'background.paper',
              px: 3,
              py: 2,
              borderRadius: 2,
              display: 'flex',
              gap: 2,
              alignItems: 'center',
              boxShadow: 3,
            }}
          >
            <CircularProgress size={24} />
            <Typography>Approving card…</Typography>
          </Box>
        </Box>
      )}
    </Dialog>
  )
}

function Summary({
  preTipTotalCents,
  tipCents,
  totalDueCents,
}: {
  preTipTotalCents: number
  tipCents: number
  totalDueCents: number
}) {
  return (
    <Box sx={{ mb: 1 }}>
      <Row label="Order" value={preTipTotalCents} />
      {tipCents > 0 && <Row label="Tip" value={tipCents} />}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
        <Typography variant="h6">Due</Typography>
        <Typography variant="h6">${toDollars(totalDueCents)}</Typography>
      </Box>
    </Box>
  )
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
      <Typography color="text.secondary">{label}</Typography>
      <Typography color="text.secondary">${toDollars(value)}</Typography>
    </Box>
  )
}
