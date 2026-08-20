'use client'

import { useState } from 'react'
import Button from '@mui/material/Button'

interface Props {
  contactId: string
  contactName: string | null
}

interface InviteResult {
  access_token: string
  portal_url: string
}

export default function PortalAccessCard({ contactId, contactName: _contactName }: Props) {
  const [state, setState] = useState<'idle' | 'loading' | 'active'>('idle')
  const [portalUrl, setPortalUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleInvite() {
    setState('loading')
    setError(null)
    try {
      const r = await fetch(`/api/portal/invite/${contactId}`, { method: 'POST' })
      if (r.ok) {
        const d = (await r.json()) as InviteResult
        setPortalUrl(d.portal_url)
        setState('active')
      } else {
        const d = (await r.json().catch(() => ({}))) as { error?: string }
        setError(d.error ?? 'Failed to invite')
        setState('idle')
      }
    } catch {
      setError('Failed to invite')
      setState('idle')
    }
  }

  async function handleRevoke() {
    if (!confirm('Revoke portal access?')) return
    try {
      await fetch(`/api/portal/access/${contactId}`, { method: 'DELETE' })
      setState('idle')
      setPortalUrl(null)
    } catch {
      setError('Failed to revoke')
    }
  }

  async function handleResend() {
    setState('loading')
    try {
      const r = await fetch(`/api/portal/invite/${contactId}`, { method: 'POST' })
      if (r.ok) {
        const d = (await r.json()) as InviteResult
        setPortalUrl(d.portal_url)
      }
    } catch {
      // ignore
    }
    setState('active')
  }

  return (
    <section>
      <h2 className="text-[10px] font-semibold text-ink4 uppercase tracking-wider mb-3">
        Portal Access
      </h2>

      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

      {state === 'idle' && (
        <Button
          onClick={() => void handleInvite()}
          size="small"
          sx={{ bgcolor: '#f0fdfa', textTransform: 'none' }}
          startIcon={
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
          }
        >
          Invite to Portal
        </Button>
      )}

      {state === 'loading' && <p className="text-xs text-ink4">Processing…</p>}

      {state === 'active' && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <svg
              className="w-3.5 h-3.5 text-green-600 shrink-0"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-xs font-medium text-green-700">Portal access active</span>
          </div>
          {portalUrl && <p className="text-[10px] text-ink4 break-all">{portalUrl}</p>}
          <div className="flex items-center gap-3">
            <Button
              onClick={() => void handleResend()}
              size="small"
              sx={{ fontSize: 12, minWidth: 0, textTransform: 'none' }}
            >
              Resend invite
            </Button>
            <span className="text-gray-200">|</span>
            <Button
              onClick={() => void handleRevoke()}
              size="small"
              color="error"
              sx={{ fontSize: 12, minWidth: 0, textTransform: 'none' }}
            >
              Revoke
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
