'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import { Modal } from '@/components/ui/Modal'

interface Props {
  quoteId: string
  status: string
  shareToken: string
  approvalStatus?: string | null
  discountPct?: number
}

export default function QuoteActions({
  quoteId,
  status,
  shareToken,
  approvalStatus,
  discountPct,
}: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState('')
  const [copied, setCopied] = useState(false)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectNote, setRejectNote] = useState('')

  async function action(name: string, endpoint: string, method = 'POST', body?: object) {
    setLoading(name)
    try {
      const opts: RequestInit = { method }
      if (body) {
        opts.headers = { 'Content-Type': 'application/json' }
        opts.body = JSON.stringify(body)
      }
      const res = await fetch(endpoint, opts)
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        if (d.error) alert(d.error)
      }
      router.refresh()
    } catch {
      // ignore
    } finally {
      setLoading('')
    }
  }

  function copyLink() {
    const base = process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin
    const shareUrl = `${base}/quotes/view/${shareToken}`
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  function downloadPdf() {
    window.open(`/api/quotes/${quoteId}/pdf`, '_blank')
  }

  const sendBlocked = approvalStatus === 'pending' || approvalStatus === 'rejected'

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <Button onClick={downloadPdf} size="small" color="inherit" variant="outlined">
          Download PDF
        </Button>

        <Button onClick={copyLink} size="small" color="inherit" variant="outlined">
          {copied ? 'Copied!' : 'Copy Link'}
        </Button>

        {approvalStatus === 'pending' && (
          <>
            <Button
              onClick={() => void action('approve', `/api/quotes/${quoteId}/approve`)}
              disabled={loading === 'approve'}
              size="small"
              variant="contained"
              color="success"
            >
              {loading === 'approve' ? 'Approving...' : 'Approve'}
            </Button>
            <Button
              onClick={() => setShowRejectModal(true)}
              disabled={loading === 'reject'}
              size="small"
              variant="contained"
              color="error"
            >
              Reject
            </Button>
          </>
        )}

        {status === 'draft' && (
          <>
            <Button
              onClick={() => void action('send', `/api/quotes/${quoteId}/send`)}
              disabled={loading === 'send' || sendBlocked}
              size="small"
              variant="contained"
              title={sendBlocked ? 'Requires approval' : undefined}
            >
              {loading === 'send'
                ? 'Sending...'
                : sendBlocked
                  ? 'Send (Locked)'
                  : 'Send to Customer'}
            </Button>
            <Button
              onClick={() => void action('dup', `/api/quotes/${quoteId}/duplicate`)}
              disabled={loading === 'dup'}
              size="small"
              color="inherit"
              variant="outlined"
            >
              Duplicate
            </Button>
          </>
        )}

        {(status === 'sent' || status === 'viewed') && (
          <>
            <Button
              onClick={() => void action('send', `/api/quotes/${quoteId}/send`)}
              disabled={loading === 'send'}
              size="small"
              variant="outlined"
            >
              Resend
            </Button>
            <Button
              onClick={() => void action('dup', `/api/quotes/${quoteId}/duplicate`)}
              disabled={loading === 'dup'}
              size="small"
              color="inherit"
              variant="outlined"
            >
              Duplicate
            </Button>
          </>
        )}

        {(status === 'accepted' || status === 'declined') && (
          <Button
            onClick={() => void action('dup', `/api/quotes/${quoteId}/duplicate`)}
            disabled={loading === 'dup'}
            size="small"
            color="inherit"
            variant="outlined"
          >
            Duplicate
          </Button>
        )}
      </div>

      {showRejectModal && (
        <Modal
          onClose={() => {
            setShowRejectModal(false)
            setRejectNote('')
          }}
          title="Reject Quote"
          maxWidth="xs"
          footer={
            <>
              <Button
                onClick={() => {
                  setShowRejectModal(false)
                  setRejectNote('')
                }}
                variant="text"
                color="inherit"
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setShowRejectModal(false)
                  void action('reject', `/api/quotes/${quoteId}/reject`, 'POST', {
                    note: rejectNote || null,
                  })
                  setRejectNote('')
                }}
                variant="contained"
                color="error"
              >
                Reject Quote
              </Button>
            </>
          }
        >
          <p className="text-xs text-ink3 mb-3">
            Quote has a {discountPct ?? 0}% discount. Provide a reason for rejection (optional).
          </p>
          <TextField
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            placeholder="Reason for rejection..."
            multiline
            rows={3}
            fullWidth
            size="small"
          />
        </Modal>
      )}
    </>
  )
}
