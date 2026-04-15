'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  quoteId: string
  status: string
  shareUrl: string
  approvalStatus?: string | null
  discountPct?: number
}

export default function QuoteActions({
  quoteId,
  status,
  shareUrl,
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
        {/* Download PDF */}
        <button
          onClick={downloadPdf}
          className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 px-2.5 py-1.5 rounded-lg"
        >
          Download PDF
        </button>

        {/* Copy share link */}
        <button
          onClick={copyLink}
          className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 px-2.5 py-1.5 rounded-lg"
        >
          {copied ? 'Copied!' : 'Copy Link'}
        </button>

        {/* Approve / Reject buttons for pending approval */}
        {approvalStatus === 'pending' && (
          <>
            <button
              onClick={() => action('approve', `/api/quotes/${quoteId}/approve`)}
              disabled={loading === 'approve'}
              className="text-xs text-white bg-green-600 hover:bg-green-700 px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
            >
              {loading === 'approve' ? 'Approving...' : 'Approve'}
            </button>
            <button
              onClick={() => setShowRejectModal(true)}
              disabled={loading === 'reject'}
              className="text-xs text-white bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
            >
              Reject
            </button>
          </>
        )}

        {status === 'draft' && (
          <>
            <button
              onClick={() => action('send', `/api/quotes/${quoteId}/send`)}
              disabled={loading === 'send' || sendBlocked}
              className="text-xs text-white bg-teal-600 hover:bg-teal-700 px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
              title={sendBlocked ? 'Requires approval' : undefined}
            >
              {loading === 'send'
                ? 'Sending...'
                : sendBlocked
                  ? 'Send (Locked)'
                  : 'Send to Customer'}
            </button>
            <button
              onClick={() => action('dup', `/api/quotes/${quoteId}/duplicate`)}
              disabled={loading === 'dup'}
              className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 px-2.5 py-1.5 rounded-lg"
            >
              Duplicate
            </button>
          </>
        )}

        {(status === 'sent' || status === 'viewed') && (
          <>
            <button
              onClick={() => action('send', `/api/quotes/${quoteId}/send`)}
              disabled={loading === 'send'}
              className="text-xs text-teal-600 hover:text-teal-700 border border-teal-200 px-2.5 py-1.5 rounded-lg"
            >
              Resend
            </button>
            <button
              onClick={() => action('dup', `/api/quotes/${quoteId}/duplicate`)}
              disabled={loading === 'dup'}
              className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 px-2.5 py-1.5 rounded-lg"
            >
              Duplicate
            </button>
          </>
        )}

        {(status === 'accepted' || status === 'declined') && (
          <button
            onClick={() => action('dup', `/api/quotes/${quoteId}/duplicate`)}
            disabled={loading === 'dup'}
            className="text-xs text-gray-500 hover:text-gray-700 border border-gray-200 px-2.5 py-1.5 rounded-lg"
          >
            Duplicate
          </button>
        )}
      </div>

      {/* Reject modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-96 shadow-xl">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Reject Quote</h3>
            <p className="text-xs text-gray-500 mb-3">
              Quote has a {discountPct ?? 0}% discount. Provide a reason for rejection (optional).
            </p>
            <textarea
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="Reason for rejection..."
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 mb-4"
              rows={3}
            />
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => {
                  setShowRejectModal(false)
                  setRejectNote('')
                }}
                className="text-xs text-gray-500 px-3 py-1.5 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowRejectModal(false)
                  action('reject', `/api/quotes/${quoteId}/reject`, 'POST', {
                    note: rejectNote || null,
                  })
                  setRejectNote('')
                }}
                className="text-xs text-white bg-red-600 hover:bg-red-700 px-3 py-1.5 rounded-lg font-medium"
              >
                Reject Quote
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
