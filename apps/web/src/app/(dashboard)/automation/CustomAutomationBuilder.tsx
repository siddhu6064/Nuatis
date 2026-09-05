'use client'

import { Fragment, useEffect, useState } from 'react'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import type { CustomAutomation, GeneratedAutomation } from '@nuatis/shared'

const API_URL = ''
const PUBLIC_API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'https://api.nuatis.com'

const ACTION_TYPES = [
  'send_sms',
  'send_email',
  'create_task',
  'add_tag',
  'update_field',
  'send_to_campaign',
  'send_webhook',
] as const

const MAPPING_FIELDS = [
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'first_name', label: 'First name' },
  { key: 'last_name', label: 'Last name' },
] as const

function humanLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function StatusBadge({ status }: { status: CustomAutomation['status'] }) {
  const styles: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    paused: 'bg-amber-100 text-amber-700',
    draft: 'bg-gray-100 text-gray-600',
  }
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${styles[status] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {humanLabel(status)}
    </span>
  )
}

function ConfidenceBadge({ score }: { score: number }) {
  if (score >= 0.8) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
        High confidence
      </span>
    )
  }
  if (score >= 0.5) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">
        Medium confidence
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
      Low confidence
    </span>
  )
}

export default function CustomAutomationBuilder() {
  const [step, setStep] = useState<'list' | 'input' | 'review' | 'webhook-create'>('list')
  const [automations, setAutomations] = useState<CustomAutomation[]>([])
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated] = useState<GeneratedAutomation | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Manual webhook-trigger creation state (no AI review step for this one)
  const [whName, setWhName] = useState('')
  const [whDescription, setWhDescription] = useState('')
  const [whActionType, setWhActionType] = useState<(typeof ACTION_TYPES)[number]>('add_tag')
  const [whActionConfig, setWhActionConfig] = useState('{}')
  const [whMatchBy, setWhMatchBy] = useState<'email' | 'phone'>('email')
  const [whMapping, setWhMapping] = useState<Record<string, string>>({})

  useEffect(() => {
    void loadAutomations()
  }, [])

  async function loadAutomations() {
    setLoadError(null)
    const res = await fetch(`${API_URL}/api/custom-automations`, { credentials: 'include' })
    if (!res.ok) {
      setLoadError('Failed to load automations')
      return
    }
    const json = (await res.json()) as { automations: CustomAutomation[] }
    setAutomations(json.automations)
  }

  async function handleGenerate() {
    setGenerating(true)
    setSaveError(null)
    try {
      const res = await fetch(`${API_URL}/api/custom-automations/generate`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      })
      const result = (await res.json()) as { automation: GeneratedAutomation & { error?: string } }
      if (result.automation.error) {
        setSaveError(result.automation.error)
        return
      }
      setGenerated(result.automation)
      setEditName(result.automation.name)
      setEditDescription(result.automation.description)
      setStep('review')
    } catch {
      setSaveError('Generation failed. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  async function handleSaveDraft() {
    if (!generated) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(`${API_URL}/api/custom-automations`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editName,
          description: editDescription,
          natural_language_prompt: prompt,
          trigger_type: generated.trigger_type,
          trigger_config: generated.trigger_config,
          action_type: generated.action_type,
          action_config: generated.action_config,
        }),
      })
      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        setSaveError(err.error ?? 'Failed to save automation')
        return
      }
      await loadAutomations()
      setStep('list')
      setPrompt('')
      setGenerated(null)
      setEditName('')
      setEditDescription('')
    } catch {
      setSaveError('Failed to save automation. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  function resetWebhookForm() {
    setWhName('')
    setWhDescription('')
    setWhActionType('add_tag')
    setWhActionConfig('{}')
    setWhMatchBy('email')
    setWhMapping({})
  }

  async function handleSaveWebhookTrigger() {
    setSaving(true)
    setSaveError(null)
    let actionConfig: unknown
    try {
      actionConfig = JSON.parse(whActionConfig)
    } catch {
      setSaveError('Action config must be valid JSON')
      setSaving(false)
      return
    }
    try {
      const res = await fetch(`${API_URL}/api/custom-automations`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: whName,
          description: whDescription,
          trigger_type: 'inbound_webhook',
          trigger_config: { match_by: whMatchBy, field_mapping: whMapping },
          action_type: whActionType,
          action_config: actionConfig,
        }),
      })
      if (!res.ok) {
        const err = (await res.json()) as { error?: string }
        setSaveError(err.error ?? 'Failed to save automation')
        return
      }
      await loadAutomations()
      setStep('list')
      resetWebhookForm()
    } catch {
      setSaveError('Failed to save automation. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  function webhookUrlFor(automation: CustomAutomation): string {
    return `${PUBLIC_API_URL}/webhooks/automations/${automation.inbound_webhook_token}`
  }

  async function handleCopyWebhookUrl(automation: CustomAutomation) {
    try {
      await navigator.clipboard.writeText(webhookUrlFor(automation))
      setCopiedId(automation.id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  async function handleActivate(id: string) {
    setActionError(null)
    const res = await fetch(`${API_URL}/api/custom-automations/${id}/activate`, {
      method: 'POST',
      credentials: 'include',
    })
    if (!res.ok) {
      setActionError('Failed to activate automation — please try again')
      return
    }
    await loadAutomations()
  }

  async function handlePause(id: string) {
    setActionError(null)
    const res = await fetch(`${API_URL}/api/custom-automations/${id}/pause`, {
      method: 'POST',
      credentials: 'include',
    })
    if (!res.ok) {
      setActionError('Failed to pause automation — please try again')
      return
    }
    await loadAutomations()
  }

  async function handleDelete(id: string) {
    await fetch(`${API_URL}/api/custom-automations/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    await loadAutomations()
  }

  // ─── LIST ────────────────────────────────────────────────────────────────────
  if (step === 'list') {
    return (
      <div className="bg-white rounded-xl border border-border-brand p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-base font-semibold text-ink">Custom Automations</h2>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                setSaveError(null)
                resetWebhookForm()
                setStep('webhook-create')
              }}
              variant="outlined"
            >
              + Webhook Trigger
            </Button>
            <Button
              onClick={() => {
                setSaveError(null)
                setStep('input')
              }}
              variant="contained"
            >
              + New Automation
            </Button>
          </div>
        </div>

        {loadError && <p className="text-sm text-red-600 mb-4">{loadError}</p>}
        {actionError && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5">
            <span className="text-sm text-red-700">{actionError}</span>
            <IconButton
              onClick={() => setActionError(null)}
              size="small"
              sx={{ ml: 'auto', color: '#f87171', '&:hover': { color: '#dc2626' } }}
            >
              ✕
            </IconButton>
          </div>
        )}

        {automations.length === 0 ? (
          <div className="text-center py-16 text-ink3">
            <p className="text-sm">No custom automations yet. Create one with AI.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-brand">
                  {['Name', 'Trigger', 'Action', 'Status', 'Run Count', 'Last Run', 'Actions'].map(
                    (col) => (
                      <th key={col} className="text-left text-xs text-ink4 font-medium pb-3 pr-4">
                        {col}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {automations.map((a) => (
                  <Fragment key={a.id}>
                    <tr className="border-b border-border-brand last:border-0">
                      <td className="py-3 pr-4 font-medium text-ink">{a.name}</td>
                      <td className="py-3 pr-4 text-ink3">{humanLabel(a.trigger_type)}</td>
                      <td className="py-3 pr-4 text-ink3">{humanLabel(a.action_type)}</td>
                      <td className="py-3 pr-4">
                        <StatusBadge status={a.status} />
                      </td>
                      <td className="py-3 pr-4 text-ink3">{a.run_count ?? 0}</td>
                      <td className="py-3 pr-4 text-ink3">
                        {a.last_run_at ? new Date(a.last_run_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-3 flex gap-2 flex-wrap">
                        {a.status !== 'active' && (
                          <Button
                            onClick={() => void handleActivate(a.id)}
                            size="small"
                            variant="contained"
                            sx={{ fontSize: 12 }}
                          >
                            Activate
                          </Button>
                        )}
                        {a.status === 'active' && (
                          <Button
                            onClick={() => void handlePause(a.id)}
                            size="small"
                            color="inherit"
                            sx={{ fontSize: 12 }}
                          >
                            Pause
                          </Button>
                        )}
                        <Button
                          onClick={() => void handleDelete(a.id)}
                          size="small"
                          color="error"
                          sx={{ fontSize: 12 }}
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                    {a.trigger_type === 'inbound_webhook' && a.inbound_webhook_token && (
                      <tr className="border-b border-border-brand last:border-0">
                        <td colSpan={7} className="pb-3 pr-4">
                          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                            <span className="text-xs text-ink4 font-medium shrink-0">
                              Webhook URL:
                            </span>
                            <code className="text-xs text-ink3 truncate flex-1">
                              {webhookUrlFor(a)}
                            </code>
                            <Button
                              onClick={() => void handleCopyWebhookUrl(a)}
                              size="small"
                              sx={{ fontSize: 11, flexShrink: 0 }}
                            >
                              {copiedId === a.id ? 'Copied!' : 'Copy'}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  // ─── WEBHOOK-CREATE ────────────────────────────────────────────────────────────
  // No AI involved here — the LLM can't know an external system's payload
  // shape, so this trigger is configured manually end-to-end.
  if (step === 'webhook-create') {
    return (
      <div className="bg-white rounded-xl border border-border-brand p-6 max-w-2xl">
        <Button
          onClick={() => {
            setSaveError(null)
            setStep('list')
          }}
          size="small"
          color="inherit"
          sx={{ mb: 2 }}
        >
          ← Back
        </Button>
        <h2 className="text-base font-semibold text-ink mb-1">Create Webhook Trigger</h2>
        <p className="text-sm text-ink3 mb-6">
          Fires when an external system (Zapier, your own script) POSTs to a URL we generate.
          You&apos;ll get the URL after saving.
        </p>

        <div className="space-y-4">
          <TextField
            label="Name"
            value={whName}
            onChange={(e) => setWhName(e.target.value)}
            fullWidth
            size="small"
          />
          <TextField
            label="Description (optional)"
            value={whDescription}
            onChange={(e) => setWhDescription(e.target.value)}
            fullWidth
            size="small"
          />

          <div>
            <label className="block text-xs text-ink4 font-medium mb-1">
              Match incoming leads by
            </label>
            <TextField
              select
              size="small"
              value={whMatchBy}
              onChange={(e) => setWhMatchBy(e.target.value as 'email' | 'phone')}
              fullWidth
            >
              <MenuItem value="email">Email</MenuItem>
              <MenuItem value="phone">Phone</MenuItem>
            </TextField>
          </div>

          <div>
            <label className="block text-xs text-ink4 font-medium mb-1">
              Field mapping — payload key for each contact field you want to read
            </label>
            <div className="grid grid-cols-2 gap-2">
              {MAPPING_FIELDS.map((f) => (
                <TextField
                  key={f.key}
                  label={f.label}
                  placeholder={f.key === whMatchBy ? 'required' : 'optional'}
                  size="small"
                  value={whMapping[f.key] ?? ''}
                  onChange={(e) => setWhMapping((m) => ({ ...m, [f.key]: e.target.value }))}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-ink4 font-medium mb-1">Action</label>
            <TextField
              select
              size="small"
              value={whActionType}
              onChange={(e) => setWhActionType(e.target.value as (typeof ACTION_TYPES)[number])}
              fullWidth
            >
              {ACTION_TYPES.map((t) => (
                <MenuItem key={t} value={t}>
                  {humanLabel(t)}
                </MenuItem>
              ))}
            </TextField>
          </div>

          <TextField
            label="Action config (JSON)"
            value={whActionConfig}
            onChange={(e) => setWhActionConfig(e.target.value)}
            fullWidth
            size="small"
            multiline
            rows={2}
          />
        </div>

        {saveError && <p className="text-sm text-red-600 mt-4">{saveError}</p>}

        <div className="mt-6">
          <Button
            onClick={() => void handleSaveWebhookTrigger()}
            disabled={saving || !whName.trim() || !whMapping[whMatchBy]?.trim()}
            variant="contained"
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    )
  }

  // ─── INPUT ───────────────────────────────────────────────────────────────────
  if (step === 'input') {
    return (
      <div className="bg-white rounded-xl border border-border-brand p-6 max-w-2xl">
        <Button
          onClick={() => {
            setSaveError(null)
            setStep('list')
          }}
          size="small"
          color="inherit"
          sx={{ mb: 2 }}
        >
          ← Back
        </Button>
        <h2 className="text-base font-semibold text-ink mb-6">Create Custom Automation</h2>

        <div className="mb-4">
          <label className="block text-xs text-ink4 font-medium mb-1">
            Describe your automation
          </label>
          <TextField
            multiline
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Send a follow-up SMS to contacts who haven't responded in 3 days"
            fullWidth
            size="small"
          />
        </div>

        {saveError && <p className="text-sm text-red-600 mb-4">{saveError}</p>}

        <Button
          onClick={() => void handleGenerate()}
          disabled={prompt.trim().length < 10 || generating}
          variant="contained"
        >
          {generating ? 'Generating…' : 'Generate with AI'}
        </Button>
      </div>
    )
  }

  // ─── REVIEW ──────────────────────────────────────────────────────────────────
  return (
    <div className="bg-white rounded-xl border border-border-brand p-6 max-w-2xl">
      <Button
        onClick={() => {
          setSaveError(null)
          setStep('input')
        }}
        size="small"
        color="inherit"
        sx={{ mb: 2 }}
      >
        ← Back
      </Button>
      <div className="flex items-center gap-3 mb-6">
        <h2 className="text-base font-semibold text-ink">Review Automation</h2>
        {generated && <ConfidenceBadge score={generated.confidence ?? 0} />}
      </div>

      {generated && (
        <div className="space-y-4">
          {/* Editable name */}
          <div>
            <label className="block text-xs text-ink4 font-medium mb-1">Name</label>
            <TextField
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              fullWidth
              size="small"
            />
          </div>

          {/* Editable description */}
          <div>
            <label className="block text-xs text-ink4 font-medium mb-1">Description</label>
            <TextField
              multiline
              rows={2}
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              fullWidth
              size="small"
            />
          </div>

          {/* Read-only trigger */}
          <div>
            <label className="block text-xs text-ink4 font-medium mb-1">Trigger</label>
            <p className="text-sm text-ink">{humanLabel(generated.trigger_type)}</p>
          </div>

          {/* Read-only action */}
          <div>
            <label className="block text-xs text-ink4 font-medium mb-1">Action</label>
            <p className="text-sm text-ink">{humanLabel(generated.action_type)}</p>
          </div>

          {/* Trigger config */}
          <div>
            <label className="block text-xs text-ink4 font-medium mb-1">Trigger Config</label>
            <pre className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-ink3 overflow-x-auto">
              {JSON.stringify(generated.trigger_config, null, 2)}
            </pre>
          </div>

          {/* Action config */}
          <div>
            <label className="block text-xs text-ink4 font-medium mb-1">Action Config</label>
            <pre className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs text-ink3 overflow-x-auto">
              {JSON.stringify(generated.action_config, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {saveError && <p className="text-sm text-red-600 mt-4">{saveError}</p>}

      <div className="mt-6">
        <Button
          onClick={() => void handleSaveDraft()}
          disabled={saving || !editName.trim()}
          variant="contained"
        >
          {saving ? 'Saving…' : 'Save as Draft'}
        </Button>
      </div>
    </div>
  )
}
