'use client'

import { Suspense, useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'

interface EmailAccount {
  id: string
  provider: 'gmail' | 'outlook'
  email: string
  is_default: boolean
}

function GmailIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M22 6C22 4.9 21.1 4 20 4H4C2.9 4 2 4.9 2 6V18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V6ZM20 6L12 11L4 6H20ZM20 18H4V8L12 13L20 8V18Z"
        fill="#EA4335"
      />
      <path d="M4 6L12 11L20 6H4Z" fill="#FBBC05" />
    </svg>
  )
}

function OutlookIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#0078D4" />
      <path d="M13 7H20V10L17 12L20 14V17H13V14L16 12L13 10V7Z" fill="white" fillOpacity="0.9" />
      <rect x="4" y="8" width="8" height="8" rx="1" fill="white" fillOpacity="0.9" />
      <ellipse cx="8" cy="12" rx="2.5" ry="3" fill="#0078D4" />
    </svg>
  )
}

export default function IntegrationsPage() {
  return (
    <Suspense fallback={null}>
      <IntegrationsContent />
    </Suspense>
  )
}

function IntegrationsContent() {
  const { data: session } = useSession()
  const searchParams = useSearchParams()

  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [accountsLoading, setAccountsLoading] = useState(true)
  const [connectingProvider, setConnectingProvider] = useState<'gmail' | 'outlook' | null>(null)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)

  const [bccAddress, setBccAddress] = useState<string | null>(null)
  const [bccLoading, setBccLoading] = useState(true)
  const [generatingBcc, setGeneratingBcc] = useState(false)
  const [copied, setCopied] = useState(false)

  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }

  const token = (session as { accessToken?: string } | null)?.accessToken

  const fetchAccounts = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`/api/email-integrations`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data: EmailAccount[] = await res.json()
        setAccounts(data)
      }
    } catch {
      // silently fail on load
    } finally {
      setAccountsLoading(false)
    }
  }, [token])

  const fetchBcc = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`/api/settings/bcc-logging`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data: { bcc_logging_address?: string } = await res.json()
        setBccAddress(data.bcc_logging_address ?? null)
      }
    } catch {
      // silently fail on load
    } finally {
      setBccLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (token) {
      fetchAccounts()
      fetchBcc()
    }
  }, [token, fetchAccounts, fetchBcc])

  // Show success toast if redirected back after OAuth
  useEffect(() => {
    if (searchParams.get('email') === 'connected') {
      showToast('success', 'Email account connected successfully')
    }
  }, [searchParams])

  async function connectProvider(provider: 'gmail' | 'outlook') {
    if (!token) return
    setConnectingProvider(provider)
    try {
      const res = await fetch(`/api/email-integrations/${provider}/auth-url`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data: { url: string } = await res.json()
        window.location.href = data.url
      } else {
        showToast('error', `Failed to get ${provider} auth URL`)
        setConnectingProvider(null)
      }
    } catch {
      showToast('error', `Could not connect to ${provider}`)
      setConnectingProvider(null)
    }
  }

  async function disconnectAccount(id: string, email: string) {
    if (!confirm(`Disconnect ${email}? This cannot be undone.`)) return
    if (!token) return
    setDisconnecting(id)
    try {
      const res = await fetch(`/api/email-integrations/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        setAccounts((prev) => prev.filter((a) => a.id !== id))
        showToast('success', `Disconnected ${email}`)
      } else {
        showToast('error', 'Failed to disconnect account')
      }
    } catch {
      showToast('error', 'Failed to disconnect account')
    } finally {
      setDisconnecting(null)
    }
  }

  async function generateBccAddress() {
    if (!token) return
    setGeneratingBcc(true)
    try {
      const res = await fetch(`/api/settings/bcc-logging/enable`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data: { bcc_logging_address?: string } = await res.json()
        setBccAddress(data.bcc_logging_address ?? null)
        showToast('success', 'BCC address generated')
      } else {
        showToast('error', 'Failed to generate BCC address')
      }
    } catch {
      showToast('error', 'Failed to generate BCC address')
    } finally {
      setGeneratingBcc(false)
    }
  }

  async function copyBcc() {
    if (!bccAddress) return
    try {
      await navigator.clipboard.writeText(bccAddress)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      showToast('error', 'Could not copy to clipboard')
    }
  }

  const providerLabel = (provider: 'gmail' | 'outlook') =>
    provider === 'gmail' ? 'Gmail' : 'Outlook'

  return (
    <div className="px-8 py-8 max-w-2xl space-y-8">
      <div>
        <h1 className="text-xl font-bold text-gray-900 mb-1">Integrations</h1>
        <p className="text-sm text-gray-500">Connect external services to your workspace</p>
      </div>

      {/* Email Accounts */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Email Accounts</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Connect an email account to send and track emails from within the CRM
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => connectProvider('gmail')}
            disabled={connectingProvider === 'gmail'}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <GmailIcon />
            {connectingProvider === 'gmail' ? 'Redirecting…' : 'Connect Gmail'}
          </button>

          <button
            onClick={() => connectProvider('outlook')}
            disabled={connectingProvider === 'outlook'}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <OutlookIcon />
            {connectingProvider === 'outlook' ? 'Redirecting…' : 'Connect Outlook'}
          </button>
        </div>

        <div className="bg-white rounded-xl border border-gray-100">
          {accountsLoading ? (
            <div className="px-6 py-4 text-sm text-gray-400">Loading accounts…</div>
          ) : accounts.length === 0 ? (
            <div className="px-6 py-4 text-sm text-gray-400">No email accounts connected yet.</div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {accounts.map((account) => (
                <li key={account.id} className="px-6 py-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="shrink-0">
                      {account.provider === 'gmail' ? <GmailIcon /> : <OutlookIcon />}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{account.email}</p>
                      <p className="text-xs text-gray-400">{providerLabel(account.provider)}</p>
                    </div>
                    {account.is_default && (
                      <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-teal-50 text-teal-700 border border-teal-100">
                        Default
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => disconnectAccount(account.id, account.email)}
                    disabled={disconnecting === account.id}
                    className="shrink-0 text-xs text-red-500 hover:text-red-700 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {disconnecting === account.id ? 'Disconnecting…' : 'Disconnect'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* BCC Email Logging */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-gray-900">BCC Email Logging</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Log emails sent from any client by adding a unique BCC address
          </p>
        </div>

        {bccLoading ? (
          <div className="text-sm text-gray-400">Loading…</div>
        ) : bccAddress ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <code className="flex-1 min-w-0 px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm font-mono text-gray-800 truncate">
                {bccAddress}
              </code>
              <button
                onClick={copyBcc}
                className="shrink-0 px-3 py-2.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <p className="text-xs text-gray-400">
              Add this address to the BCC field of any email you send — it will automatically be
              logged under the matching contact in your CRM.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">
              Generate a unique BCC address to start logging emails automatically.
            </p>
            <button
              onClick={generateBccAddress}
              disabled={generatingBcc}
              className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generatingBcc ? 'Generating…' : 'Generate BCC Address'}
            </button>
          </div>
        )}
      </section>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${
            toast.type === 'success'
              ? 'bg-teal-600 text-white'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}
