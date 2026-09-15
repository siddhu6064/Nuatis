'use client'

import { useMemo, useState } from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Chip from '@mui/material/Chip'
import { toDollars, toCents } from '@nuatis/pos-core'
import { unsatisfiedGroups, type MenuItemDto, type MenuOptionDto } from '@/lib/cart-lines'

interface ModifierDialogProps {
  item: MenuItemDto | null
  onCancel: () => void
  onConfirm: (item: MenuItemDto, options: MenuOptionDto[]) => void
}

/**
 * Choose modifiers before an item reaches the cart.
 *
 * Add cannot be pressed while a required group is unsatisfied — the API models
 * `required` and `min_select`, and a cart that ignores them sends the kitchen a
 * ticket it cannot make ("steak, no temperature").
 */
export function ModifierDialog({ item, onCancel, onConfirm }: ModifierDialogProps) {
  const [chosen, setChosen] = useState<Record<string, MenuOptionDto[]>>({})

  const chosenFlat = useMemo(() => Object.values(chosen).flat(), [chosen])
  const missing = item ? unsatisfiedGroups(item, chosenFlat) : []

  const runningTotal = useMemo(() => {
    if (!item) return 0
    return toCents(item.price) + chosenFlat.reduce((s, o) => s + toCents(o.price_delta), 0)
  }, [item, chosenFlat])

  function toggle(groupId: string, option: MenuOptionDto, maxSelect: number) {
    setChosen((current) => {
      const picked = current[groupId] ?? []
      const already = picked.some((o) => o.id === option.id)
      if (already) return { ...current, [groupId]: picked.filter((o) => o.id !== option.id) }
      // A single-select group replaces rather than refusing — tapping "Medium"
      // after "Rare" should mean you changed your mind, not that nothing
      // happened.
      if (maxSelect <= 1) return { ...current, [groupId]: [option] }
      if (picked.length >= maxSelect) return current
      return { ...current, [groupId]: [...picked, option] }
    })
  }

  function close() {
    setChosen({})
    onCancel()
  }

  return (
    <Dialog open={item !== null} onClose={close} fullWidth maxWidth="sm">
      {item && (
        <>
          <DialogTitle>{item.name}</DialogTitle>
          <DialogContent dividers>
            {item.modifier_groups.map((group) => {
              const picked = chosen[group.id] ?? []
              const isMissing = missing.some((g) => g.id === group.id)
              return (
                <Box key={group.id} sx={{ mb: 3 }}>
                  <Typography variant="subtitle1" sx={{ mb: 1 }}>
                    {group.name}
                    {group.required && (
                      <Typography
                        component="span"
                        variant="body2"
                        sx={{ ml: 1 }}
                        color={isMissing ? 'error.main' : 'text.secondary'}
                      >
                        required
                      </Typography>
                    )}
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                    {group.options.map((option) => {
                      const on = picked.some((o) => o.id === option.id)
                      const delta = toCents(option.price_delta)
                      return (
                        <Chip
                          key={option.id}
                          label={delta === 0 ? option.name : `${option.name} +$${toDollars(delta)}`}
                          onClick={() => toggle(group.id, option, group.max_select)}
                          color={on ? 'primary' : 'default'}
                          variant={on ? 'filled' : 'outlined'}
                          sx={{ height: 44, fontSize: '1rem', px: 1 }}
                        />
                      )
                    })}
                  </Box>
                </Box>
              )
            })}
          </DialogContent>
          <DialogActions sx={{ p: 2, gap: 1 }}>
            <Button onClick={close} variant="text">
              Cancel
            </Button>
            <Button
              variant="contained"
              disabled={missing.length > 0}
              onClick={() => {
                onConfirm(item, chosenFlat)
                setChosen({})
              }}
            >
              {missing.length > 0
                ? `Choose ${missing[0]?.name}`
                : `Add · $${toDollars(runningTotal)}`}
            </Button>
          </DialogActions>
        </>
      )}
    </Dialog>
  )
}
