'use client'

import Link from 'next/link'
import Button from '@mui/material/Button'

export function NewQuoteButton() {
  return (
    <Button component={Link} href="/quotes/new" variant="contained">
      + New Quote
    </Button>
  )
}

export function NewQuoteLink() {
  return (
    <Button component={Link} href="/quotes/new" size="small" sx={{ mt: 1.5, fontSize: 12 }}>
      New Quote &rarr;
    </Button>
  )
}
