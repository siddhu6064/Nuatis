'use client'

import { useState } from 'react'
import Box from '@mui/material/Box'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import ButtonBase from '@mui/material/ButtonBase'
import Paper from '@mui/material/Paper'
import Typography from '@mui/material/Typography'
import { toCents, toDollars } from '@nuatis/pos-core'
import type { MenuCategoryDto, MenuItemDto } from '@/lib/cart-lines'

interface MenuGridProps {
  categories: MenuCategoryDto[]
  onSelect: (item: MenuItemDto) => void
}

export function MenuGrid({ categories, onSelect }: MenuGridProps) {
  const [active, setActive] = useState(0)
  const current = categories[active]

  if (categories.length === 0) {
    return (
      <Box sx={{ p: 4 }}>
        <Typography color="text.secondary">
          No menu yet. Seed one with <code>seed-pos-demo.ts</code>.
        </Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Tabs
        value={active}
        onChange={(_, v: number) => setActive(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ borderBottom: 1, borderColor: 'divider', flexShrink: 0 }}
      >
        {categories.map((c) => (
          <Tab key={c.id} label={c.name} sx={{ minHeight: 56, fontSize: '1rem' }} />
        ))}
      </Tabs>

      <Box sx={{ flex: 1, overflowY: 'auto', p: 2 }}>
        <Box
          sx={{
            display: 'grid',
            // Fixed minimum rather than a column count: the same grid has to
            // work on a 10" till and a 24" counter screen.
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 2,
          }}
        >
          {(current?.items ?? []).map((item) => (
            <ButtonBase
              key={item.id}
              onClick={() => onSelect(item)}
              disabled={!item.available}
              sx={{ borderRadius: 2, textAlign: 'left', opacity: item.available ? 1 : 0.4 }}
            >
              <Paper
                elevation={0}
                sx={{
                  p: 2,
                  width: '100%',
                  minHeight: 104,
                  border: 1,
                  borderColor: 'divider',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <Typography sx={{ fontWeight: 600, lineHeight: 1.3 }}>{item.name}</Typography>
                <Box
                  sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}
                >
                  <Typography color="primary" sx={{ fontWeight: 700 }}>
                    ${toDollars(toCents(item.price))}
                  </Typography>
                  {item.modifier_groups.length > 0 && (
                    <Typography variant="caption" color="text.secondary">
                      options
                    </Typography>
                  )}
                </Box>
              </Paper>
            </ButtonBase>
          ))}
        </Box>
      </Box>
    </Box>
  )
}
