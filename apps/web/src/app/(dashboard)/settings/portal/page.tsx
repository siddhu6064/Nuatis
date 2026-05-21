'use client'

import { useState, useEffect } from 'react'

interface PortalSettings {
  portal_enabled: boolean
  portal_slug: string | null
  portal_url: string | null
  access_count: number
}

interface PortalClient {
  contact_id: string
  email: string
  last_accessed_at: string | null
  created_at: string
  contacts: { full_name: string | null } | null
}

export default function PortalSettingsPage() {
  const [settings, setSettings] = useState<PortalSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(false)
  const [clients, setClients] = useState<PortalClient[]>([])
  const [clientsLoading, setClientsLoading] = useState(false)
  const [inviteSearch, setInviteSearch] = useState('')
  const [inviting, setInviting] = useState<string | null>(null) // contactId being invited
  const [inviteResult, setInviteResult] = useState<{ contactId: string; url: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Search results for invite typeahead
  const [searchResults, setSearchResults] = useState<
    Array<{ id: string; full_name: string | null; email: string | null }>
  >([])
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    fetch('/api/portal/settings')
      .then((r) => (r.ok ? (r.json() as Promise<PortalSettings>) : Promise.reject()))
      .then((data) => {
        setSettings(data)
        if (data.portal_enabled) loadClients()
      })
      .catch(() => setError('Failed to load portal settings'))
      .finally(() => setLoading(false))
  }, [])

  function loadClients() {
    setClientsLoading(true)
    fetch('/api/portal/clients')
      .then((r) => r.json() as Promise<{ clients: PortalClient[] }>)
      .then((data) => setClients(data.clients))
      .catch(() => {})
      .finally(() => setClientsLoading(false))
  }

  async function handleToggle() {
    if (!settings) return
    setToggling(true)
    try {
      if (settings.portal_enabled) {
        const r = await fetch('/api/portal/disable', { method: 'POST' })
        if (r.ok) setSettings((s) => (s ? { ...s, portal_enabled: false } : s))
      } else {
        const r = await fetch('/api/portal/enable', { method: 'POST' })
        if (r.ok) {
          const d = (await r.json()) as { portal_slug: string; portal_url: string }
          setSettings((s) =>
            s
              ? { ...s, portal_enabled: true, portal_slug: d.portal_slug, portal_url: d.portal_url }
              : s
          )
          loadClients()
        }
      }
    } catch {
      // ignore toggle errors — UI stays in current state
    }
    setToggling(false)
  }

  function handleCopyUrl() {
    if (!settings?.portal_url) return
    void navigator.clipboard.writeText(settings.portal_url).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  // Typeahead search for contacts
  useEffect(() => {
    if (!inviteSearch.trim() || inviteSearch.length < 2) {
      setSearchResults([])
      return
    }
    const timeout = setTimeout(() => {
      setSearching(true)
      fetch(`/api/contacts?q=${encodeURIComponent(inviteSearch)}&limit=5`)
        .then(
          (r) =>
            r.json() as Promise<{
              contacts: Array<{ id: string; full_name: string | null; email: string | null }>
            }>
        )
        .then((d) => setSearchResults(d.contacts ?? []))
        .catch(() => setSearchResults([]))
        .finally(() => setSearching(false))
    }, 300)
    return () => clearTimeout(timeout)
  }, [inviteSearch])

  async function handleInvite(contactId: string) {
    setInviting(contactId)
    setInviteResult(null)
    try {
      const r = await fetch(`/api/portal/invite/${contactId}`, { method: 'POST' })
      if (r.ok) {
        const d = (await r.json()) as { portal_url: string }
        setInviteResult({ contactId, url: d.portal_url })
        setInviteSearch('')
        setSearchResults([])
        loadClients()
      }
    } catch {
      // ignore invite errors
    }
    setInviting(null)
  }

  async function handleRevoke(contactId: string) {
    if (!confirm('Revoke portal access for this client?')) return
    await fetch(`/api/portal/access/${contactId}`, { method: 'DELETE' })
    setClients((prev) => prev.filter((c) => c.contact_id !== contactId))
    setSettings((s) => (s ? { ...s, access_count: Math.max(0, s.access_count - 1) } : s))
  }

  if (loading) {
    return (
      <div className="px-8 py-8">
        <h1 className="text-xl font-bold text-ink mb-6">Client Portal</h1>
        <div className="animate-pulse space-y-4">
          <div className="h-24 bg-gray-100 rounded-xl" />
          <div className="h-48 bg-gray-100 rounded-xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="px-8 py-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-ink">Client Portal</h1>
        <p className="text-sm text-ink3 mt-0.5">
          Give clients self-service access to their appointments, quotes, and invoices
        </p>
      </div>

      {error && (
        <div className="mb-4 px-4 py-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>
      )}

      {/* Enable/disable toggle card */}
      <div className="bg-white rounded-xl border border-border-brand p-6 mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">Enable Client Portal</h2>
            <p className="text-xs text-ink4 mt-0.5">
              Allow clients to view their data via a private link
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleToggle()}
            disabled={toggling}
            className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors duration-200 focus:outline-none disabled:opacity-50 ${
              settings?.portal_enabled ? 'bg-teal-600' : 'bg-gray-200'
            }`}
          >
            <span
              className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform duration-200 mt-0.5 ${
                settings?.portal_enabled ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        {settings?.portal_enabled && settings.portal_url && (
          <div className="mt-4 pt-4 border-t border-border-brand">
            <p className="text-xs text-ink4 mb-2">Portal URL</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-xs bg-bg2 px-3 py-2 rounded-lg text-ink2 truncate">
                {settings.portal_url}
              </code>
              <button
                type="button"
                onClick={handleCopyUrl}
                className="shrink-0 px-3 py-2 text-xs font-medium bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <a
                href={settings.portal_url}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 px-3 py-2 text-xs font-medium text-teal-700 bg-teal-50 hover:bg-teal-100 rounded-lg transition-colors"
              >
                Preview →
              </a>
            </div>
          </div>
        )}
      </div>

      {/* Invite client */}
      {settings?.portal_enabled && (
        <div className="bg-white rounded-xl border border-border-brand p-6 mb-6">
          <h2 className="text-sm font-semibold text-ink mb-4">Invite Client</h2>

          {inviteResult && (
            <div className="mb-4 px-4 py-3 bg-teal-50 text-teal-700 text-sm rounded-lg">
              Invite sent! Link: <code className="text-xs break-all">{inviteResult.url}</code>
            </div>
          )}

          <div className="relative">
            <input
              type="text"
              value={inviteSearch}
              onChange={(e) => setInviteSearch(e.target.value)}
              placeholder="Search contacts by name or email…"
              className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            {searching && (
              <div className="absolute right-3 top-2.5">
                <div className="w-4 h-4 border border-gray-300 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {searchResults.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-border-brand rounded-lg shadow-lg overflow-hidden">
                {searchResults.map((contact) => (
                  <button
                    key={contact.id}
                    type="button"
                    onClick={() => void handleInvite(contact.id)}
                    disabled={inviting === contact.id}
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
                  >
                    <div>
                      <p className="text-sm font-medium text-ink">{contact.full_name ?? '—'}</p>
                      <p className="text-xs text-ink4">{contact.email ?? 'No email'}</p>
                    </div>
                    <span className="text-xs text-teal-600 font-medium">
                      {inviting === contact.id ? 'Inviting…' : 'Invite →'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Client access table */}
      {settings?.portal_enabled && (
        <div className="bg-white rounded-xl border border-border-brand overflow-hidden">
          <div className="px-6 py-4 border-b border-border-brand flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">
              Client Access
              {settings.access_count > 0 && (
                <span className="ml-2 text-xs font-normal text-ink4">
                  ({settings.access_count})
                </span>
              )}
            </h2>
          </div>
          {clientsLoading ? (
            <div className="px-6 py-8 text-center">
              <div className="w-5 h-5 border-2 border-gray-200 border-t-teal-500 rounded-full animate-spin mx-auto" />
            </div>
          ) : clients.length === 0 ? (
            <div className="px-6 py-8 text-center">
              <p className="text-sm text-ink4">No clients have portal access yet.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-brand">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-ink3 uppercase">
                    Contact
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase">
                    Email
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase">
                    Invited
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ink3 uppercase">
                    Last Accessed
                  </th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {clients.map((client) => (
                  <tr key={client.contact_id} className="hover:bg-gray-50/50">
                    <td className="px-6 py-3 font-medium text-ink">
                      {client.contacts?.full_name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-ink3">{client.email}</td>
                    <td className="px-4 py-3 text-ink3 text-xs">
                      {new Date(client.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-ink3 text-xs">
                      {client.last_accessed_at
                        ? new Date(client.last_accessed_at).toLocaleDateString()
                        : 'Never'}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => void handleRevoke(client.contact_id)}
                        className="text-xs text-red-600 hover:text-red-700 font-medium"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}
