'use client'

import { useEffect, useState } from 'react'
import type { CustomAutomation, GeneratedAutomation } from '@nuatis/shared'

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

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
  const [step, setStep] = useState<'list' | 'input' | 'review'>('list')
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
          <button
            onClick={() => {
              setSaveError(null)
              setStep('input')
            }}
            className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm font-medium"
          >
            + New Automation
          </button>
        </div>

        {loadError && <p className="text-sm text-red-600 mb-4">{loadError}</p>}
        {actionError && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5">
            <span className="text-sm text-red-700">{actionError}</span>
            <button
              type="button"
              onClick={() => setActionError(null)}
              className="ml-auto text-red-400 hover:text-red-600 text-xs"
            >
              ✕
            </button>
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
                  <tr key={a.id} className="border-b border-border-brand last:border-0">
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
                        <button
                          onClick={() => void handleActivate(a.id)}
                          className="px-3 py-1 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-xs font-medium"
                        >
                          Activate
                        </button>
                      )}
                      {a.status === 'active' && (
                        <button
                          onClick={() => void handlePause(a.id)}
                          className="px-3 py-1 bg-gray-100 text-ink3 rounded-lg hover:bg-gray-200 text-xs font-medium"
                        >
                          Pause
                        </button>
                      )}
                      <button
                        onClick={() => void handleDelete(a.id)}
                        className="px-3 py-1 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 text-xs font-medium"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  // ─── INPUT ───────────────────────────────────────────────────────────────────
  if (step === 'input') {
    return (
      <div className="bg-white rounded-xl border border-border-brand p-6 max-w-2xl">
        <button
          onClick={() => {
            setSaveError(null)
            setStep('list')
          }}
          className="text-sm text-ink3 hover:text-ink mb-4 inline-flex items-center gap-1"
        >
          ← Back
        </button>
        <h2 className="text-base font-semibold text-ink mb-6">Create Custom Automation</h2>

        <div className="mb-4">
          <label className="block text-xs text-ink4 font-medium mb-1">
            Describe your automation
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="e.g. Send a follow-up SMS to contacts who haven't responded in 3 days"
            rows={4}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-teal-400 w-full resize-none"
          />
        </div>

        {saveError && <p className="text-sm text-red-600 mb-4">{saveError}</p>}

        <button
          onClick={() => void handleGenerate()}
          disabled={prompt.trim().length < 10 || generating}
          className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {generating ? 'Generating…' : 'Generate with AI'}
        </button>
      </div>
    )
  }

  // ─── REVIEW ──────────────────────────────────────────────────────────────────
  return (
    <div className="bg-white rounded-xl border border-border-brand p-6 max-w-2xl">
      <button
        onClick={() => {
          setSaveError(null)
          setStep('input')
        }}
        className="text-sm text-ink3 hover:text-ink mb-4 inline-flex items-center gap-1"
      >
        ← Back
      </button>
      <div className="flex items-center gap-3 mb-6">
        <h2 className="text-base font-semibold text-ink">Review Automation</h2>
        {generated && <ConfidenceBadge score={generated.confidence ?? 0} />}
      </div>

      {generated && (
        <div className="space-y-4">
          {/* Editable name */}
          <div>
            <label className="block text-xs text-ink4 font-medium mb-1">Name</label>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-teal-400 w-full"
            />
          </div>

          {/* Editable description */}
          <div>
            <label className="block text-xs text-ink4 font-medium mb-1">Description</label>
            <textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              rows={2}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-teal-400 w-full resize-none"
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
        <button
          onClick={() => void handleSaveDraft()}
          disabled={saving || !editName.trim()}
          className="px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save as Draft'}
        </button>
      </div>
    </div>
  )
}
