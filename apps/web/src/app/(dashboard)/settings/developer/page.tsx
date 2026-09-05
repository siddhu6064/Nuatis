'use client'

import { useState, useEffect, useCallback } from 'react'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import TextField from '@mui/material/TextField'
import { Modal } from '@/components/ui/Modal'

// ── Types ──────────────────────────────────────────────────────────────────────

interface WebhookSubscription {
  id: string
  url: string
  event_types: string[]
  is_active: boolean
  created_at: string
}

interface Delivery {
  id: string
  event_type: string
  status: 'pending' | 'delivered' | 'failed'
  attempt_count: number
  last_attempted_at: string | null
  response_status: number | null
  error_message: string | null
  created_at: string
}

interface ApiKey {
  id: string
  name: string
  key_prefix: string
  last_used_at: string | null
  revoked_at: string | null
  created_at: string
}

const STATUS_PILL: Record<Delivery['status'], string> = {
  pending: 'bg-amber-50 text-amber-700',
  delivered: 'bg-green-50 text-green-700',
  failed: 'bg-red-50 text-red-700',
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function DeveloperSettingsPage() {
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }

  return (
    <div className="px-8 py-8 max-w-2xl space-y-10">
      <div>
        <h1 className="text-xl font-bold text-ink mb-1">Developer</h1>
        <p className="text-sm text-ink3">
          Let other tools react to what happens in your account — outbound webhooks and API keys for
          managing them from a script.
        </p>
      </div>

      <WebhooksSection showToast={showToast} />
      <ApiKeysSection showToast={showToast} />

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

// ── Webhooks ───────────────────────────────────────────────────────────────────

function WebhooksSection({
  showToast,
}: {
  showToast: (type: 'success' | 'error', msg: string) => void
}) {
  const [subs, setSubs] = useState<WebhookSubscription[]>([])
  const [loading, setLoading] = useState(true)
  const [eventTypes, setEventTypes] = useState<string[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [newUrl, setNewUrl] = useState('')
  const [newEvents, setNewEvents] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [createdSecret, setCreatedSecret] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deliveries, setDeliveries] = useState<Delivery[]>([])
  const [deliveriesLoading, setDeliveriesLoading] = useState(false)
  const [deliveriesError, setDeliveriesError] = useState(false)

  const fetchSubs = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/webhooks')
      if (res.ok) {
        const data: { subscriptions: WebhookSubscription[] } = await res.json()
        setSubs(data.subscriptions ?? [])
      }
    } catch {
      // silently fail on load
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSubs()
    fetch('/api/webhooks/event-types')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { event_types: string[] } | null) => setEventTypes(d?.event_types ?? []))
      .catch(() => {})
  }, [fetchSubs])

  async function handleCreate() {
    if (!newUrl.trim() || newEvents.length === 0) return
    setCreating(true)
    try {
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newUrl.trim(), event_types: newEvents }),
      })
      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        throw new Error(err.error ?? 'Failed to create webhook')
      }
      const data: { secret: string } = await res.json()
      setCreatedSecret(data.secret)
      setNewUrl('')
      setNewEvents([])
      void fetchSubs()
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to create webhook')
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Deactivate this webhook? It will stop receiving events.')) return
    try {
      const res = await fetch(`/api/webhooks/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to deactivate webhook')
      showToast('success', 'Webhook deactivated')
      void fetchSubs()
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to deactivate webhook')
    }
  }

  async function toggleDeliveries(id: string) {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    setDeliveriesLoading(true)
    setDeliveriesError(false)
    try {
      const res = await fetch(`/api/webhooks/${id}/deliveries`)
      if (!res.ok) throw new Error('Failed to load delivery log')
      const data: { deliveries: Delivery[] } = await res.json()
      setDeliveries(data.deliveries ?? [])
    } catch {
      setDeliveries([])
      setDeliveriesError(true)
    } finally {
      setDeliveriesLoading(false)
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-ink">Webhooks</h2>
          <p className="text-sm text-ink3 mt-0.5">
            Get a signed HTTP POST whenever one of these events happens in your account.
          </p>
        </div>
        <Button
          onClick={() => setShowCreate(true)}
          variant="contained"
          color="inherit"
          sx={{ flexShrink: 0, bgcolor: 'grey.900', '&:hover': { bgcolor: 'grey.800' } }}
        >
          + New Webhook
        </Button>
      </div>

      <div className="bg-white rounded-xl border border-border-brand">
        {loading ? (
          <div className="px-6 py-4 text-sm text-ink4">Loading webhooks…</div>
        ) : subs.length === 0 ? (
          <div className="px-6 py-4 text-sm text-ink4">No webhooks configured yet.</div>
        ) : (
          <ul className="divide-y divide-border-brand">
            {subs.map((sub) => (
              <li key={sub.id} className="px-6 py-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink truncate font-mono">{sub.url}</p>
                    <p className="text-xs text-ink4 mt-0.5">
                      {sub.event_types.join(', ')} · {sub.is_active ? 'active' : 'inactive'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button onClick={() => toggleDeliveries(sub.id)} size="small" color="inherit">
                      {expandedId === sub.id ? 'Hide log' : 'Delivery log'}
                    </Button>
                    <Button onClick={() => handleDelete(sub.id)} size="small" color="error">
                      Deactivate
                    </Button>
                  </div>
                </div>

                {expandedId === sub.id && (
                  <div className="mt-3 bg-bg rounded-lg border border-border-brand overflow-hidden">
                    {deliveriesLoading ? (
                      <div className="px-4 py-3 text-xs text-ink4">Loading…</div>
                    ) : deliveriesError ? (
                      <div className="px-4 py-3 text-xs text-red-600">
                        Couldn't load the delivery log. Try again.
                      </div>
                    ) : deliveries.length === 0 ? (
                      <div className="px-4 py-3 text-xs text-ink4">No deliveries yet.</div>
                    ) : (
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border-brand">
                            <th className="text-left px-4 py-2 font-medium text-ink4">Event</th>
                            <th className="text-left px-4 py-2 font-medium text-ink4">Status</th>
                            <th className="text-left px-4 py-2 font-medium text-ink4">Attempts</th>
                            <th className="text-left px-4 py-2 font-medium text-ink4">Last try</th>
                          </tr>
                        </thead>
                        <tbody>
                          {deliveries.map((d) => (
                            <tr key={d.id} className="border-b border-border-brand last:border-0">
                              <td className="px-4 py-2 font-mono text-ink2">{d.event_type}</td>
                              <td className="px-4 py-2">
                                <span
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_PILL[d.status]}`}
                                >
                                  {d.status}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-ink3">{d.attempt_count}</td>
                              <td className="px-4 py-2 text-ink3">
                                {formatDate(d.last_attempted_at)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {showCreate && (
        <Modal
          onClose={() => {
            setShowCreate(false)
            setCreatedSecret(null)
          }}
          title="New Webhook"
          maxWidth="sm"
          footer={
            createdSecret ? (
              <Button
                onClick={() => {
                  setShowCreate(false)
                  setCreatedSecret(null)
                }}
                variant="contained"
              >
                Done
              </Button>
            ) : (
              <>
                <Button onClick={() => setShowCreate(false)} color="inherit">
                  Cancel
                </Button>
                <Button
                  onClick={() => void handleCreate()}
                  disabled={creating || !newUrl.trim() || newEvents.length === 0}
                  variant="contained"
                >
                  {creating ? 'Creating…' : 'Create Webhook'}
                </Button>
              </>
            )
          }
        >
          {createdSecret ? (
            <div className="space-y-3">
              <p className="text-sm text-ink2">
                Webhook created. Use this signing secret to verify the{' '}
                <code className="font-mono text-xs">X-Webhook-Signature</code> header — it's shown
                only once.
              </p>
              <code className="block px-4 py-2.5 bg-bg border border-border-brand rounded-lg text-sm font-mono text-ink break-all">
                {createdSecret}
              </code>
            </div>
          ) : (
            <div className="space-y-4">
              <TextField
                label="Endpoint URL"
                placeholder="https://example.com/webhooks/nuatis"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                fullWidth
                size="small"
              />
              <div>
                <p className="text-sm font-medium text-ink mb-2">Events</p>
                <div className="grid grid-cols-2 gap-1">
                  {eventTypes.map((et) => (
                    <label key={et} className="flex items-center gap-1.5 text-sm text-ink2">
                      <Checkbox
                        size="small"
                        checked={newEvents.includes(et)}
                        onChange={(e) =>
                          setNewEvents((prev) =>
                            e.target.checked ? [...prev, et] : prev.filter((x) => x !== et)
                          )
                        }
                      />
                      <span className="font-mono text-xs">{et}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </Modal>
      )}
    </section>
  )
}

// ── API Keys ───────────────────────────────────────────────────────────────────

function ApiKeysSection({
  showToast,
}: {
  showToast: (type: 'success' | 'error', msg: string) => void
}) {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createdKey, setCreatedKey] = useState<string | null>(null)

  const fetchKeys = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/api-keys')
      if (res.ok) {
        const data: { keys: ApiKey[] } = await res.json()
        setKeys(data.keys ?? [])
      }
    } catch {
      // silently fail on load
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchKeys()
  }, [fetchKeys])

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const res = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      })
      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        throw new Error(err.error ?? 'Failed to create key')
      }
      const data: { key: string } = await res.json()
      setCreatedKey(data.key)
      setNewName('')
      void fetchKeys()
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to create key')
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm('Revoke this API key? Any script using it will stop working immediately.')) return
    try {
      const res = await fetch(`/api/api-keys/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to revoke key')
      showToast('success', 'API key revoked')
      void fetchKeys()
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to revoke key')
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-ink">API Keys</h2>
          <p className="text-sm text-ink3 mt-0.5">
            Manage your webhooks from a script instead of this page — pass a key via the{' '}
            <code className="font-mono text-xs">X-API-Key</code> header.
          </p>
        </div>
        <Button
          onClick={() => setShowCreate(true)}
          variant="outlined"
          color="inherit"
          sx={{ flexShrink: 0 }}
        >
          + New Key
        </Button>
      </div>

      <div className="bg-white rounded-xl border border-border-brand">
        {loading ? (
          <div className="px-6 py-4 text-sm text-ink4">Loading keys…</div>
        ) : keys.length === 0 ? (
          <div className="px-6 py-4 text-sm text-ink4">No API keys yet.</div>
        ) : (
          <ul className="divide-y divide-border-brand">
            {keys.map((key) => (
              <li key={key.id} className="px-6 py-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink truncate">
                    {key.name}
                    {key.revoked_at && (
                      <span className="ml-2 text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                        Revoked
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-ink4 mt-0.5 font-mono">
                    {key.key_prefix}… · last used {formatDate(key.last_used_at)}
                  </p>
                </div>
                {!key.revoked_at && (
                  <Button
                    onClick={() => handleRevoke(key.id)}
                    size="small"
                    color="error"
                    sx={{ flexShrink: 0 }}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {showCreate && (
        <Modal
          onClose={() => {
            setShowCreate(false)
            setCreatedKey(null)
          }}
          title="New API Key"
          maxWidth="xs"
          footer={
            createdKey ? (
              <Button
                onClick={() => {
                  setShowCreate(false)
                  setCreatedKey(null)
                }}
                variant="contained"
              >
                Done
              </Button>
            ) : (
              <>
                <Button onClick={() => setShowCreate(false)} color="inherit">
                  Cancel
                </Button>
                <Button
                  onClick={() => void handleCreate()}
                  disabled={creating || !newName.trim()}
                  variant="contained"
                >
                  {creating ? 'Creating…' : 'Create Key'}
                </Button>
              </>
            )
          }
        >
          {createdKey ? (
            <div className="space-y-3">
              <p className="text-sm text-ink2">Copy this key now — it won't be shown again.</p>
              <code className="block px-4 py-2.5 bg-bg border border-border-brand rounded-lg text-sm font-mono text-ink break-all">
                {createdKey}
              </code>
            </div>
          ) : (
            <TextField
              label="Key name"
              placeholder="e.g. Zapier integration"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              fullWidth
              size="small"
            />
          )}
        </Modal>
      )}
    </section>
  )
}
