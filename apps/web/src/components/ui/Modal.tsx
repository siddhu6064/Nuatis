'use client'

import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import IconButton from '@mui/material/IconButton'

export interface ModalProps {
  /** Called on backdrop click, Escape, and the header close button. */
  onClose: () => void
  /** Omit to render a modal with no header (rare — most call sites want a title). */
  title?: React.ReactNode
  children: React.ReactNode
  /** Footer action row (Cancel/Confirm buttons, etc). Omit for no footer. */
  footer?: React.ReactNode
  /**
   * This app's existing ~30 hand-rolled modals are conditionally *mounted*
   * (`{show && <TheModal .../>}`), not toggled via an open prop — MUI's
   * Dialog wants `open` regardless, so it defaults to true here to match
   * that convention with zero call-site changes beyond the internals.
   */
  open?: boolean
  maxWidth?: 'xs' | 'sm' | 'md' | 'lg'
}

/**
 * Shared modal primitive — phase 4 of the MUI migration
 * (docs/mui-v9-migration-plan.md). Replaces this app's hand-rolled
 * `fixed inset-0 ... bg-black/40` overlay pattern (~30 call sites as of
 * writing), none of which handle Escape-to-close, focus trapping, or
 * aria-modal — MUI's Dialog provides all three for free. Visual styling
 * (rounded-xl panel, border, header/footer border-t/border-b) matches the
 * existing convention exactly rather than introducing a new look.
 */
export function Modal({
  onClose,
  title,
  children,
  footer,
  open = true,
  maxWidth = 'sm',
}: ModalProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={maxWidth}
      fullWidth
      slotProps={{
        paper: {
          sx: {
            borderRadius: '12px',
            border: '1px solid',
            borderColor: 'divider',
            boxShadow: 8,
          },
        },
      }}
    >
      {title && (
        <DialogTitle
          variant="subtitle2"
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid',
            borderColor: 'divider',
            py: 1.5,
            px: 2.5,
            fontWeight: 600,
          }}
        >
          {title}
          <IconButton
            onClick={onClose}
            size="small"
            aria-label="Close"
            sx={{ color: 'text.disabled', '&:hover': { color: 'text.primary' } }}
          >
            {/* matches the inline X svg used across the existing hand-rolled modals */}
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
        </DialogTitle>
      )}
      <DialogContent sx={{ px: 2.5, py: 2.5 }}>{children}</DialogContent>
      {footer && (
        <DialogActions
          sx={{
            px: 2.5,
            py: 2,
            borderTop: '1px solid',
            borderColor: 'divider',
            gap: 1,
          }}
        >
          {footer}
        </DialogActions>
      )}
    </Dialog>
  )
}
