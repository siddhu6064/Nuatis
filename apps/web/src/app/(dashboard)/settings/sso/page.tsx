'use client'

import { useState, useEffect } from 'react'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Switch from '@mui/material/Switch'

interface SsoConnection {
  configured: boolean
  enabled: boolean
  domain: string | null
  hasOrganization: boolean
}

export default function SsoSettingsPage() {
  const [connection, setConnection] = useState<SsoConnection | null>(null)
  const [loading, setLoading] = useState(true)
  const [domain, setDomain] = useState('')
  const [saving, setSaving] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  function load() {
    setLoading(true)
    fetch('/api/sso/connection')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: SsoConnection | null) => {
        if (data) {
          setConnection(data)
          setDomain(data.domain ?? '')
        }
      })
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  async function handleSaveDomain() {
    setSaving(true)
    try {
      const res = await fetch('/api/sso/connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed to save')
      setToast({ type: 'success', msg: 'Login domain saved' })
      load()
    } catch (err) {
      setToast({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to save' })
    } finally {
      setSaving(false)
    }
  }

  async function handleOpenPortal() {
    setPortalLoading(true)
    try {
      const res = await fetch('/api/sso/connection/portal-link')
      const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (!res.ok || !data.url) throw new Error(data.error ?? 'Failed to generate setup link')
      window.open(data.url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setToast({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to open setup' })
    } finally {
      setPortalLoading(false)
    }
  }

  async function handleToggleEnabled(enabled: boolean) {
    setSaving(true)
    try {
      const res = await fetch('/api/sso/connection', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Failed to update')
      setToast({ type: 'success', msg: enabled ? 'SSO enabled' : 'SSO disabled' })
      load()
    } catch (err) {
      setToast({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to update' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="px-8 py-8 max-w-2xl">
      <h1 className="text-xl font-bold text-ink mb-1">Single Sign-On</h1>
      <p className="text-sm text-ink4 mb-6">
        Let your team log in through your own identity provider (SAML or OIDC) instead of a
        password.
      </p>

      {loading ? (
        <p className="text-sm text-ink4">Loading…</p>
      ) : !connection?.configured ? (
        <div className="bg-white rounded-xl border border-border-brand p-5">
          <p className="text-sm text-ink3">SSO is not configured on this server yet.</p>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-xl border border-border-brand mb-6">
            <div className="px-5 py-4 border-b border-border-brand">
              <h2 className="text-sm font-semibold text-ink">1. Login domain</h2>
              <p className="text-xs text-ink4 mt-0.5">
                Anyone signing in with an email at this domain will be offered SSO instead of a
                password.
              </p>
            </div>
            <div className="px-5 py-4 flex items-center gap-2">
              <TextField
                size="small"
                placeholder="acme.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                sx={{ maxWidth: 260 }}
              />
              <Button variant="outlined" size="small" disabled={saving} onClick={handleSaveDomain}>
                Save
              </Button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-border-brand mb-6">
            <div className="px-5 py-4 border-b border-border-brand">
              <h2 className="text-sm font-semibold text-ink">2. Connect your identity provider</h2>
              <p className="text-xs text-ink4 mt-0.5">
                Opens a hosted setup page where you paste your IdP&apos;s SAML metadata or OIDC
                client credentials.
              </p>
            </div>
            <div className="px-5 py-4">
              <Button
                variant="outlined"
                size="small"
                disabled={!connection.hasOrganization || portalLoading}
                onClick={handleOpenPortal}
              >
                {portalLoading ? 'Opening…' : 'Open setup'}
              </Button>
              {!connection.hasOrganization && (
                <p className="text-xs text-ink4 mt-2">Save a login domain first.</p>
              )}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-border-brand">
            <div className="px-5 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-ink">3. Turn on SSO login</h2>
                <p className="text-xs text-ink4 mt-0.5">
                  Flip this once your identity provider connection is live.
                </p>
              </div>
              <Switch
                checked={connection.enabled}
                onChange={(e) => void handleToggleEnabled(e.target.checked)}
                disabled={saving || !connection.hasOrganization}
                slotProps={{ input: { 'aria-label': 'Toggle SSO login' } }}
              />
            </div>
          </div>
        </>
      )}

      {toast && (
        <div
          className={`fixed top-4 right-4 z-[60] px-4 py-2 text-sm rounded-lg shadow-lg ${
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
