'use client'

import Link from 'next/link'
import Button from '@mui/material/Button'

interface Props {
  page: number
  pages: number
  prevHref: string
  nextHref: string
}

export default function CallsPagination({ page, pages, prevHref, nextHref }: Props) {
  return (
    <div className="flex items-center justify-between mt-6">
      <Button component={Link} href={prevHref} disabled={page <= 1} size="small" color="inherit">
        Previous
      </Button>
      <span className="text-xs text-ink4">
        Page {page} of {pages}
      </span>
      <Button
        component={Link}
        href={nextHref}
        disabled={page >= pages}
        size="small"
        color="inherit"
      >
        Next
      </Button>
    </div>
  )
}
