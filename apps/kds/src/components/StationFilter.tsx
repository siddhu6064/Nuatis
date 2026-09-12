'use client'

import Box from '@mui/material/Box'
import Button from '@mui/material/Button'

interface StationFilterProps {
  stations: string[]
  /** Null means every station. */
  selected: string | null
  onSelect: (station: string | null) => void
}

/** An empty-string station is the unrouted bucket — see the schema's NULL station. */
function label(station: string): string {
  return station === '' ? 'Unrouted' : station
}

export function StationFilter({ stations, selected, onSelect }: StationFilterProps) {
  return (
    <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
      <Button
        variant={selected === null ? 'contained' : 'outlined'}
        onClick={() => onSelect(null)}
        size="small"
      >
        All
      </Button>
      {stations
        .filter((s) => s !== '')
        .map((station) => (
          <Button
            key={station}
            variant={selected === station ? 'contained' : 'outlined'}
            onClick={() => onSelect(station)}
            size="small"
            sx={{ textTransform: 'capitalize' }}
          >
            {label(station)}
          </Button>
        ))}
    </Box>
  )
}
