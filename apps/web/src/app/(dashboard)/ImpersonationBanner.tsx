'use client'

import { useState, useEffect } from 'react'
import { signOut } from 'next-auth/react'

interface ImpersonationInfo {
  sessionId: string
  platformUserEmail: string
  expiresAt: string
}

// Persistent banner while a platform-support "log in as this tenant" session
// is active — always visible so the platform admin can never mistake this
// for their own account, and can end it explicitly. Ending signs out rather
// than "returning" to the platform admin's own session — there's no stored
// second session to pop back to, just the short TTL doing its job either way.
export default function ImpersonationBanner() {
  const [info, setInfo] = useState<ImpersonationInfo | null>(null)
  const [ending, setEnding] = useState(false)

  useEffect(() => {
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then((session: { impersonation?: ImpersonationInfo }) => {
        if (session?.impersonation) setInfo(session.impersonation)
      })
      .catch(() => {})
  }, [])

  if (!info) return null

  async function handleEnd() {
    setEnding(true)
    try {
      await fetch(`/api/admin-console/impersonate/${info!.sessionId}/end`, { method: 'POST' })
    } finally {
      await signOut({ callbackUrl: '/sign-in' })
    }
  }

  const expires = new Date(info.expiresAt)

  return (
    <div className="bg-red-600 text-white px-4 py-2 flex items-center gap-3 text-sm">
      <span className="font-semibold uppercase tracking-wide text-xs bg-red-800 px-1.5 py-0.5 rounded">
        Impersonating
      </span>
      <span>
        Logged in as this tenant by {info.platformUserEmail} — expires{' '}
        {expires.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
      </span>
      <button
        type="button"
        onClick={() => void handleEnd()}
        disabled={ending}
        className="ml-auto font-medium underline hover:no-underline disabled:opacity-50"
      >
        {ending ? 'Ending…' : 'End session'}
      </button>
    </div>
  )
}
