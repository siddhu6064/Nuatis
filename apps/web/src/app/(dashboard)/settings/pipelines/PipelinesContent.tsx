'use client'

import { useState, useEffect, useCallback } from 'react'

// ── Constants ─────────────────────────────────────────────────────────────────

const PRESET_COLORS = [
  '#007A6E',
  '#0047FF',
  '#7C3AED',
  '#006B3F',
  '#C07D00',
  '#E84A00',
  '#C0003C',
  '#0891B2',
  '#059669',
  '#D97706',
  '#DC2626',
  '#6B7280',
]

// ── Types ─────────────────────────────────────────────────────────────────────

interface Pipeline {
  id: string
  name: string
  is_default: boolean
  pipeline_type: string
  stage_count: number
}

interface Stage {
  id: string
  name: string
  position: number
  color: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function toTitle(slug: string): string {
  return slug
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

// ── Inline stage editor ───────────────────────────────────────────────────────

function StageEditor({ pipelineId }: { pipelineId: string }) {
  const [stages, setStages] = useState<Stage[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [addingName, setAddingName] = useState('')
  const [adding, setAdding] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [colorPickerStageId, setColorPickerStageId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/pipelines/${pipelineId}`, { credentials: 'include' })
    if (res.ok) {
      const data = (await res.json()) as { stages?: Stage[] }
      setStages((data.stages ?? []).sort((a, b) => a.position - b.position))
    }
    setLoading(false)
  }, [pipelineId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setColorPickerStageId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function showErr(msg: string) {
    setErrMsg(msg)
    setTimeout(() => setErrMsg(null), 3500)
  }

  async function renameStage(stageId: string) {
    const name = editingName.trim()
    if (!name) return
    const res = await fetch(`/api/pipelines/${pipelineId}/stages/${stageId}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (res.ok) {
      setStages((prev) => prev.map((s) => (s.id === stageId ? { ...s, name } : s)))
      setEditingId(null)
    } else {
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      showErr(d.error ?? 'Failed to rename stage')
    }
  }

  async function deleteStage(stageId: string, stageName: string) {
    if (!confirm(`Delete stage "${stageName}"?`)) return
    const res = await fetch(`/api/pipelines/${pipelineId}/stages/${stageId}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (res.ok) {
      setStages((prev) => prev.filter((s) => s.id !== stageId))
    } else {
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      showErr(d.error ?? 'Failed to delete stage')
    }
  }

  async function setStageColor(stageId: string, color: string) {
    setStages((prev) => prev.map((s) => (s.id === stageId ? { ...s, color } : s)))
    setColorPickerStageId(null)
    const res = await fetch(`/api/pipelines/${pipelineId}/stages/${stageId}`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ color }),
    })
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      showErr(d.error ?? 'Failed to update color')
      void load()
    }
  }

  async function addStage() {
    const name = addingName.trim()
    if (!name) return
    setAdding(true)
    const res = await fetch(`/api/pipelines/${pipelineId}/stages`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (res.ok) {
      const stage = (await res.json()) as Stage
      setStages((prev) => [...prev, stage])
      setAddingName('')
    } else {
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      showErr(d.error ?? 'Failed to add stage')
    }
    setAdding(false)
  }

  if (loading) {
    return <p className="text-xs text-ink4 py-3">Loading stages...</p>
  }

  return (
    <div className="mt-4 pt-4 border-t border-border-brand space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink4">Stages</p>

      {errMsg && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded px-2.5 py-1.5">
          {errMsg}
        </p>
      )}

      {stages.length === 0 ? (
        <p className="text-xs text-ink4 italic">No stages yet — add one below.</p>
      ) : (
        <div className="space-y-1">
          {stages.map((stage, idx) => (
            <div key={stage.id} className="flex items-center gap-2.5 py-0.5">
              <span className="font-mono text-[10px] text-ink4 w-4 shrink-0 text-right">
                {idx + 1}
              </span>
              {/* Color swatch button */}
              <div className="relative shrink-0">
                <button
                  type="button"
                  title="Change color"
                  className="w-5 h-5 rounded-full border border-rule flex items-center justify-center hover:ring-2 hover:ring-offset-1 hover:ring-teal-400 transition-shadow"
                  style={{ backgroundColor: stage.color || '#007A6E' }}
                  onClick={() =>
                    setColorPickerStageId((prev) => (prev === stage.id ? null : stage.id))
                  }
                />
                {colorPickerStageId === stage.id && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setColorPickerStageId(null)}
                    />
                    <div className="absolute top-7 left-0 z-50 bg-white border border-border-brand rounded-lg p-2 shadow-lg">
                      <div className="grid grid-cols-6 gap-1">
                        {PRESET_COLORS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            title={c}
                            className={`w-6 h-6 rounded-full cursor-pointer transition-shadow hover:ring-2 hover:ring-offset-1 hover:ring-ink3 ${
                              (stage.color || '#007A6E') === c
                                ? 'ring-2 ring-offset-1 ring-teal-600'
                                : ''
                            }`}
                            style={{ backgroundColor: c }}
                            onClick={() => void setStageColor(stage.id, c)}
                          />
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
              {editingId === stage.id ? (
                <input
                  autoFocus
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void renameStage(stage.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  className="flex-1 text-sm border border-teal-400 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-teal-500"
                />
              ) : (
                <span className="flex-1 text-sm text-ink">{stage.name}</span>
              )}

              {editingId === stage.id ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void renameStage(stage.id)}
                    className="text-xs font-medium text-teal-600 hover:text-teal-800"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="text-xs text-ink4 hover:text-ink3"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      setEditingId(stage.id)
                      setEditingName(stage.name)
                    }}
                    className="text-xs text-ink4 hover:text-teal-600 transition-colors"
                  >
                    Rename
                  </button>
                  <button
                    onClick={() => void deleteStage(stage.id, stage.name)}
                    className="text-xs text-ink4 hover:text-red-600 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add stage row */}
      <div className="flex items-center gap-2 pt-1">
        <input
          value={addingName}
          onChange={(e) => setAddingName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addStage()
          }}
          placeholder="New stage name"
          className="flex-1 text-sm border border-border-brand rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-500"
        />
        <button
          onClick={() => void addStage()}
          disabled={adding || !addingName.trim()}
          className="px-3 py-1.5 text-xs font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
        >
          Add stage
        </button>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PipelinesContent({ vertical }: { vertical: string }) {
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3500)
  }

  const loadPipelines = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/pipelines?type=contacts', { credentials: 'include' })
      if (!res.ok) return
      const raw = (await res.json()) as Pipeline[] | { pipelines?: Pipeline[] }
      const all: Pipeline[] = Array.isArray(raw) ? raw : (raw.pipelines ?? [])

      // Same vertical filter logic as the Kanban board
      const verticalLabel = toTitle(vertical)
      const verticalMatches = all.filter((p) =>
        p.name.toLowerCase().includes(verticalLabel.toLowerCase())
      )
      const filtered =
        verticalMatches.length > 0 ? verticalMatches : all.filter((p) => p.is_default)
      setPipelines(filtered.length > 0 ? filtered : all)
    } finally {
      setLoading(false)
    }
  }, [vertical])

  useEffect(() => {
    void loadPipelines()
  }, [loadPipelines])

  async function setDefault(pipelineId: string) {
    const res = await fetch(`/api/pipelines/${pipelineId}/set-default`, {
      method: 'PUT',
      credentials: 'include',
    })
    if (res.ok) {
      setPipelines((prev) => prev.map((p) => ({ ...p, is_default: p.id === pipelineId })))
      showToast('success', 'Default pipeline updated')
    } else {
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      showToast('error', d.error ?? 'Failed to update default')
    }
  }

  async function deletePipeline(pipelineId: string, name: string) {
    if (!confirm(`Delete pipeline "${name}"? This cannot be undone.`)) return
    const res = await fetch(`/api/pipelines/${pipelineId}`, {
      method: 'DELETE',
      credentials: 'include',
    })
    if (res.ok) {
      setPipelines((prev) => prev.filter((p) => p.id !== pipelineId))
      if (expandedId === pipelineId) setExpandedId(null)
      showToast('success', 'Pipeline deleted')
    } else {
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      showToast('error', d.error ?? 'Failed to delete pipeline')
    }
  }

  async function createPipeline() {
    const name = newName.trim()
    if (!name) return
    setSaving(true)
    const res = await fetch('/api/pipelines', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, pipeline_type: 'contacts' }),
    })
    if (res.ok) {
      setNewName('')
      setCreating(false)
      await loadPipelines()
      showToast('success', 'Pipeline created')
    } else {
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      showToast('error', d.error ?? 'Failed to create pipeline')
    }
    setSaving(false)
  }

  return (
    <div className="px-8 py-8 max-w-2xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-ink mb-1">Pipelines</h1>
        <p className="text-sm text-ink3">Manage your pipeline stages and templates.</p>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${
            toast.type === 'success'
              ? 'bg-teal-600 text-white'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Pipeline list */}
      {loading ? (
        <p className="text-sm text-ink4">Loading pipelines...</p>
      ) : pipelines.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-border-brand p-8 text-center">
          <p className="text-sm text-ink4">No pipelines configured for this vertical yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pipelines.map((pipeline) => (
            <div key={pipeline.id} className="bg-white rounded-xl border border-border-brand p-5">
              {/* Card header row */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <h2 className="text-sm font-semibold text-ink">{pipeline.name}</h2>
                  {pipeline.is_default && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 bg-teal-50 text-teal-700 border border-teal-200 rounded shrink-0">
                      Default
                    </span>
                  )}
                  <span className="font-mono text-[10px] text-ink4 shrink-0">
                    {pipeline.stage_count} stage{pipeline.stage_count !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {!pipeline.is_default && (
                    <button
                      onClick={() => void setDefault(pipeline.id)}
                      className="text-xs text-ink4 hover:text-ink3 transition-colors"
                    >
                      Set default
                    </button>
                  )}
                  <button
                    onClick={() =>
                      setExpandedId((prev) => (prev === pipeline.id ? null : pipeline.id))
                    }
                    className="text-xs font-medium text-teal-600 hover:text-teal-800 transition-colors"
                  >
                    {expandedId === pipeline.id ? 'Close' : 'Edit stages'}
                  </button>
                  <button
                    onClick={() => void deletePipeline(pipeline.id, pipeline.name)}
                    className="text-xs text-ink4 hover:text-red-600 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>

              {/* Inline stage editor */}
              {expandedId === pipeline.id && (
                <StageEditor key={pipeline.id} pipelineId={pipeline.id} />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create pipeline */}
      <div className="bg-white rounded-xl border border-border-brand p-5">
        {creating ? (
          <div className="flex items-center gap-3">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createPipeline()
                if (e.key === 'Escape') {
                  setCreating(false)
                  setNewName('')
                }
              }}
              placeholder="Pipeline name"
              className="flex-1 text-sm border border-border-brand rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
            <button
              onClick={() => void createPipeline()}
              disabled={saving || !newName.trim()}
              className="px-4 py-2 text-sm font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Creating...' : 'Create'}
            </button>
            <button
              onClick={() => {
                setCreating(false)
                setNewName('')
              }}
              className="text-sm text-ink4 hover:text-ink3 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="text-sm font-medium text-teal-600 hover:text-teal-800 transition-colors"
          >
            + Create Pipeline
          </button>
        )}
      </div>
    </div>
  )
}
