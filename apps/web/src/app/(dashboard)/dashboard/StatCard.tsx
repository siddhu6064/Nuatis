'use client'

import Link from 'next/link'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardContent from '@mui/material/CardContent'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'

const COLOR_BG: Record<string, string> = {
  teal: '#f0fdfa',
  blue: '#eff6ff',
  amber: '#fffbeb',
  purple: '#faf5ff',
}
const COLOR_FG: Record<string, string> = {
  teal: '#0d9488',
  blue: '#2563eb',
  amber: '#d97706',
  purple: '#9333ea',
}

export interface StatCardProps {
  label: string
  value: string
  icon: string
  color: string
  href?: string
}

/**
 * Pilot MUI component for the dashboard stat grid — see
 * docs/mui-v9-migration-plan.md phase 2. Same data shape and click
 * behavior as the Tailwind version it replaces; the visual upgrade is
 * MUI's elevation transition on hover (0 -> 2) instead of a border-color
 * swap, and Typography's type scale instead of ad hoc text-* classes.
 */
export function StatCard({ label, value, icon, color, href }: StatCardProps) {
  const content = (
    <CardContent>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
          {label}
        </Typography>
        <Box
          sx={{
            width: 28,
            height: 28,
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
            bgcolor: COLOR_BG[color] ?? COLOR_BG['teal'],
            color: COLOR_FG[color] ?? COLOR_FG['teal'],
          }}
        >
          {icon}
        </Box>
      </Box>
      <Typography variant="h5" color="text.primary" sx={{ fontWeight: 700 }}>
        {value}
      </Typography>
    </CardContent>
  )

  return (
    <Card
      variant="outlined"
      sx={{
        borderRadius: '12px',
        transition: 'box-shadow 150ms, border-color 150ms',
        ...(href && {
          '&:hover': { boxShadow: 2, borderColor: 'primary.light' },
        }),
      }}
    >
      {href ? (
        <CardActionArea component={Link} href={href}>
          {content}
        </CardActionArea>
      ) : (
        content
      )}
    </Card>
  )
}
