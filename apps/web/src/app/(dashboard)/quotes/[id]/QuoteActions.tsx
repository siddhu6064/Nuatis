'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  quoteId: string
  status: string
  shareUrl: string
}

export default function QuoteActions({ quoteId, status, shareUrl }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState('')
  const [copied, setCopied] = useState(false)

  async function action(name: string, endpoint: string, method = 'POST') {
    setLoading(name)
    try {
      await fetch(endpoint, { method })
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

  return (
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

      {status === 'draft' && (
        <>
          <button
            onClick={() => action('send', `/api/quotes/${quoteId}/send`)}
            disabled={loading === 'send'}
            className="text-xs text-white bg-teal-600 hover:bg-teal-700 px-3 py-1.5 rounded-lg font-medium disabled:opacity-50"
          >
            {loading === 'send' ? 'Sending...' : 'Send to Customer'}
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
  )
}
