'use client'

import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'

export interface SlideOverProps {
  /** Called on backdrop click, Escape, and the header close button. */
  onClose: () => void
  open: boolean
  /** Omit to render a panel with no header (rare — most call sites want a title). */
  title?: React.ReactNode
  children: React.ReactNode
  /** Sticky footer below the scrollable content. Omit for no footer. */
  footer?: React.ReactNode
  width?: number | string
}

/**
 * Shared slide-over primitive — phase 14 of the MUI migration
 * (docs/mui-v9-migration-plan.md). Replaces this app's hand-rolled
 * `fixed inset-0 ... ml-auto` edge-panel pattern (4 call sites: Inventory,
 * Staff, Shift, Appointment). Named `SlideOver` rather than `Drawer` to
 * avoid shadowing the MUI import in this file and to match this app's own
 * existing name for the pattern (the filenames already say "SlideOver").
 *
 * Unlike `Modal`, `open` has no default — all 4 existing call sites already
 * pass a real boolean and keep (or can keep) the component mounted while
 * toggling it, which is the pattern MUI's Drawer is built for: it stays in
 * the DOM through the close transition so the slide-out animation actually
 * plays, instead of vanishing instantly the way `if (!open) return null`
 * does today.
 *
 * `footer` added in phase 16, once a real call site (AppointmentDrawer) had
 * a genuinely sticky action row (unlike the first 3 conversions, whose
 * buttons scroll with the rest of the content) — same shape as `Modal`'s
 * `footer` slot, for the same reason.
 */
export function SlideOver({ onClose, open, title, children, footer, width = 448 }: SlideOverProps) {
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { sx: { width, display: 'flex', flexDirection: 'column' } } }}
    >
      {title && (
        <div className="px-5 py-4 border-b border-border-brand flex items-center justify-between shrink-0">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          <IconButton
            onClick={onClose}
            size="small"
            aria-label="Close"
            sx={{ color: 'text.disabled', '&:hover': { color: 'text.primary' } }}
          >
            {/* matches the inline X used across the existing hand-rolled slide-overs */}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </IconButton>
        </div>
      )}
      <div className="overflow-y-auto flex-1">{children}</div>
      {footer && <div className="px-5 py-4 border-t border-border-brand shrink-0">{footer}</div>}
    </Drawer>
  )
}
