'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGE_COLORS = [
  { value: '#6b7280', label: 'Gray' },
  { value: '#ef4444', label: 'Red' },
  { value: '#f97316', label: 'Orange' },
  { value: '#eab308', label: 'Yellow' },
  { value: '#22c55e', label: 'Green' },
  { value: '#3b82f6', label: 'Blue' },
  { value: '#8b5cf6', label: 'Purple' },
  { value: '#ec4899', label: 'Pink' },
  { value: '#14b8a6', label: 'Teal' },
]

// ─── Types ────────────────────────────────────────────────────────────────────

type PipelineType = 'contacts' | 'deals'

interface Stage {
  id?: string
  name: string
  color: string
  probability: number
  position?: number
}

interface Pipeline {
  id: string
  name: string
  description?: string
  type: PipelineType
  is_default: boolean
  stage_count: number
}

interface PipelineDetail extends Pipeline {
  stages: (Stage & { id: string; position: number })[]
}

// ─── Stage Row ────────────────────────────────────────────────────────────────

interface StageRowProps {
  stage: Stage
  index: number
  total: number
  onChange: (index: number, patch: Partial<Stage>) => void
  onDelete: (index: number) => void
  onMoveUp: (index: number) => void
  onMoveDown: (index: number) => void
}

function StageRow({
  stage,
  index,
  total,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
}: StageRowProps) {
  const inputCls =
    'px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent'

  return (
    <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg border border-gray-100">
      {/* Move buttons */}
      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          onClick={() => onMoveUp(index)}
          disabled={index === 0}
          className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600 disabled:opacity-25 disabled:cursor-not-allowed text-xs"
          title="Move up"
        >
          ▲
        </button>
        <button
          type="button"
          onClick={() => onMoveDown(index)}
          disabled={index === total - 1}
          className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-gray-600 disabled:opacity-25 disabled:cursor-not-allowed text-xs"
          title="Move down"
        >
          ▼
        </button>
      </div>

      {/* Color swatch + select */}
      <div className="flex items-center gap-1.5">
        <span
          className="w-4 h-4 rounded-full border border-gray-200 shrink-0"
          style={{ backgroundColor: stage.color }}
        />
        <select
          value={stage.color}
          onChange={(e) => onChange(index, { color: e.target.value })}
          className={`${inputCls} w-24 text-xs`}
          title="Stage color"
        >
          {STAGE_COLORS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      {/* Stage name */}
      <input
        type="text"
        value={stage.name}
        onChange={(e) => onChange(index, { name: e.target.value })}
        placeholder="Stage name"
        className={`${inputCls} flex-1 min-w-0`}
      />

      {/* Probability */}
      <div className="flex flex-col gap-1 w-28 shrink-0">
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={stage.probability}
            onChange={(e) =>
              onChange(index, {
                probability: Math.min(100, Math.max(0, parseInt(e.target.value) || 0)),
              })
            }
            min={0}
            max={100}
            className={`${inputCls} w-16 text-right`}
            title="Probability %"
          />
          <span className="text-xs text-gray-400">%</span>
        </div>
        {/* Thin probability bar */}
        <div className="h-1 rounded-full bg-gray-200 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${stage.probability}%`, backgroundColor: stage.color }}
          />
        </div>
      </div>

      {/* Delete */}
      <button
        type="button"
        onClick={() => onDelete(index)}
        className="text-gray-300 hover:text-red-400 transition-colors text-xl leading-none w-5 text-center shrink-0"
        title="Delete stage"
      >
        ×
      </button>
    </div>
  )
}

// ─── Pipeline Modal ───────────────────────────────────────────────────────────

interface PipelineModalProps {
  mode: 'create' | 'edit'
  pipeline?: PipelineDetail | null
  defaultType?: PipelineType
  authHeaders: Record<string, string>
  onClose: () => void
  onSaved: () => void
}

function PipelineModal({
  mode,
  pipeline,
  defaultType = 'contacts',
  authHeaders,
  onClose,
  onSaved,
}: PipelineModalProps) {
  const [name, setName] = useState(pipeline?.name ?? '')
  const [description, setDescription] = useState(pipeline?.description ?? '')
  const [type, setType] = useState<PipelineType>(pipeline?.type ?? defaultType)
  const [stages, setStages] = useState<Stage[]>(
    pipeline?.stages?.length
      ? pipeline.stages.map((s) => ({
          id: s.id,
          name: s.name,
          color: s.color,
          probability: s.probability,
        }))
      : [{ name: '', color: '#6b7280', probability: 0 }]
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addStage() {
    setStages((prev) => [...prev, { name: '', color: '#6b7280', probability: 0 }])
  }

  function handleStageChange(index: number, patch: Partial<Stage>) {
    setStages((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)))
  }

  function handleStageDelete(index: number) {
    setStages((prev) => prev.filter((_, i) => i !== index))
  }

  function handleMoveUp(index: number) {
    if (index === 0) return
    setStages((prev) => {
      const next = [...prev]
      const a = next[index - 1]
      const b = next[index]
      if (a && b) {
        next[index - 1] = b
        next[index] = a
      }
      return next
    })
  }

  function handleMoveDown(index: number) {
    if (index === stages.length - 1) return
    setStages((prev) => {
      const next = [...prev]
      const a = next[index]
      const b = next[index + 1]
      if (a && b) {
        next[index] = b
        next[index + 1] = a
      }
      return next
    })
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setError('Pipeline name is required')
      return
    }
    if (stages.some((s) => !s.name.trim())) {
      setError('All stages must have a name')
      return
    }

    setSaving(true)
    setError(null)

    try {
      if (mode === 'create') {
        const res = await fetch(`/api/pipelines`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim() || undefined,
            type,
            stages: stages.map((s, i) => ({ ...s, position: i })),
          }),
        })
        if (!res.ok) {
          const d = (await res.json().catch(() => ({}))) as { error?: string }
          setError(d.error ?? 'Failed to create pipeline')
          return
        }
      } else if (pipeline) {
        // Update name/description
        const updateRes = await fetch(`/api/pipelines/${pipeline.id}`, {
          method: 'PUT',
          headers: authHeaders,
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim() || undefined,
          }),
        })
        if (!updateRes.ok) {
          const d = (await updateRes.json().catch(() => ({}))) as { error?: string }
          setError(d.error ?? 'Failed to update pipeline')
          return
        }

        // Handle stages: update existing, create new, delete removed
        const originalIds = new Set(pipeline.stages.map((s) => s.id))
        const newIds = new Set(stages.filter((s) => s.id).map((s) => s.id!))

        // Delete removed stages
        for (const origStage of pipeline.stages) {
          if (!newIds.has(origStage.id)) {
            await fetch(`/api/pipelines/${pipeline.id}/stages/${origStage.id}`, {
              method: 'DELETE',
              headers: authHeaders,
            }).catch(() => {})
          }
        }

        // Update existing / create new stages
        for (let i = 0; i < stages.length; i++) {
          const s = stages[i]
          if (!s) continue
          const payload = { name: s.name, color: s.color, probability: s.probability, position: i }
          if (s.id && originalIds.has(s.id)) {
            await fetch(`/api/pipelines/${pipeline.id}/stages/${s.id}`, {
              method: 'PUT',
              headers: authHeaders,
              body: JSON.stringify(payload),
            }).catch(() => {})
          } else {
            await fetch(`/api/pipelines/${pipeline.id}/stages`, {
              method: 'POST',
              headers: authHeaders,
              body: JSON.stringify(payload),
            }).catch(() => {})
          }
        }

        // Reorder
        const stageIds = stages.filter((s) => s.id).map((s) => s.id!)
        if (stageIds.length > 0) {
          await fetch(`/api/pipelines/${pipeline.id}/stages/reorder`, {
            method: 'PUT',
            headers: authHeaders,
            body: JSON.stringify({ stage_ids: stageIds }),
          }).catch(() => {})
        }
      }

      onSaved()
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 overflow-y-auto py-8">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">
            {mode === 'create' ? 'Create Pipeline' : 'Edit Pipeline'}
          </h2>
        </div>

        <form onSubmit={(e) => void handleSave(e)}>
          <div className="px-6 py-5 space-y-4 max-h-[60vh] overflow-y-auto">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sales Pipeline"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                autoFocus
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Brief description of this pipeline"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>

            {/* Type — create only */}
            {mode === 'create' ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <div className="flex gap-3">
                  {(['contacts', 'deals'] as PipelineType[]).map((t) => (
                    <label key={t} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="pipeline-type"
                        value={t}
                        checked={type === t}
                        onChange={() => setType(t)}
                        className="text-teal-600 focus:ring-teal-500"
                      />
                      <span className="text-sm text-gray-700 capitalize">{t}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <p className="text-sm text-gray-500 capitalize">{pipeline?.type}</p>
              </div>
            )}

            {/* Stage Builder */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Stages</label>
              {stages.length === 0 && (
                <p className="text-sm text-gray-400 py-2">No stages yet. Add one below.</p>
              )}
              <div className="space-y-2">
                {stages.map((stage, i) => (
                  <StageRow
                    key={i}
                    stage={stage}
                    index={i}
                    total={stages.length}
                    onChange={handleStageChange}
                    onDelete={handleStageDelete}
                    onMoveUp={handleMoveUp}
                    onMoveDown={handleMoveDown}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={addStage}
                className="mt-3 text-sm text-teal-600 hover:text-teal-700 font-medium flex items-center gap-1"
              >
                <span className="text-base leading-none">+</span> Add Stage
              </button>
            </div>
          </div>

          {error && (
            <div className="px-6 py-2">
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
            </div>
          )}

          <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : mode === 'create' ? 'Create Pipeline' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Delete Confirm Dialog ────────────────────────────────────────────────────

interface DeleteDialogProps {
  pipeline: Pipeline
  authHeaders: Record<string, string>
  onClose: () => void
  onDeleted: () => void
}

function DeleteDialog({ pipeline, authHeaders, onClose, onDeleted }: DeleteDialogProps) {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDelete() {
    setDeleting(true)
    setError(null)
    try {
      const res = await fetch(`/api/pipelines/${pipeline.id}`, {
        method: 'DELETE',
        headers: authHeaders,
      })
      if (res.ok) {
        onDeleted()
      } else {
        const d = (await res.json().catch(() => ({}))) as {
          error?: string
          count?: number
        }
        if (d.count !== undefined) {
          setError(
            `Cannot delete: this pipeline has ${d.count} ${pipeline.type} associated with it.`
          )
        } else {
          setError(d.error ?? 'Failed to delete pipeline')
        }
      }
    } catch {
      setError('Something went wrong. Please try again.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-2">Delete Pipeline</h2>
        <p className="text-sm text-gray-500 mb-4">
          Are you sure you want to delete <strong>{pipeline.name}</strong>? This action cannot be
          undone.
        </p>
        {error && (
          <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg mb-4">{error}</p>
        )}
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleDelete()}
            disabled={deleting || !!error}
            className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Pipeline Card ────────────────────────────────────────────────────────────

interface PipelineCardProps {
  pipeline: Pipeline
  onEdit: (p: Pipeline) => void
  onDelete: (p: Pipeline) => void
  onSetDefault: (p: Pipeline) => void
  settingDefault: boolean
}

function PipelineCard({
  pipeline,
  onEdit,
  onDelete,
  onSetDefault,
  settingDefault,
}: PipelineCardProps) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-gray-900 truncate">{pipeline.name}</p>
          {pipeline.is_default && (
            <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-teal-100 text-teal-700 rounded uppercase tracking-wide shrink-0">
              Default
            </span>
          )}
        </div>
        {pipeline.description && (
          <p className="text-xs text-gray-400 mt-0.5 truncate">{pipeline.description}</p>
        )}
        <p className="text-xs text-gray-400 mt-1">
          {pipeline.stage_count} stage{pipeline.stage_count !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {!pipeline.is_default && (
          <button
            onClick={() => onSetDefault(pipeline)}
            disabled={settingDefault}
            className="px-2.5 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            title="Set as default"
          >
            Set Default
          </button>
        )}
        <button
          onClick={() => onEdit(pipeline)}
          className="px-2.5 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          title="Edit pipeline"
        >
          Edit
        </button>
        <button
          onClick={() => onDelete(pipeline)}
          className="px-2.5 py-1.5 text-xs text-red-400 border border-red-100 rounded-lg hover:bg-red-50 transition-colors"
          title="Delete pipeline"
        >
          Delete
        </button>
      </div>
    </div>
  )
}

// ─── Pipelines Tab Panel ──────────────────────────────────────────────────────

interface PipelinesPanelProps {
  pipelineType: PipelineType
  authHeaders: Record<string, string>
}

function PipelinesPanel({ pipelineType, authHeaders }: PipelinesPanelProps) {
  const [pipelines, setPipelines] = useState<Pipeline[]>([])
  const [loading, setLoading] = useState(true)
  const [settingDefault, setSettingDefault] = useState<string | null>(null)
  const [modal, setModal] = useState<
    | { mode: 'create' }
    | { mode: 'edit'; pipeline: PipelineDetail }
    | { mode: 'delete'; pipeline: Pipeline }
    | null
  >(null)
  const [loadingEdit, setLoadingEdit] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3500)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/pipelines?type=${pipelineType}`, {
        headers: authHeaders,
      })
      if (res.ok) {
        const data = (await res.json()) as Pipeline[]
        setPipelines(data)
      }
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }, [pipelineType, authHeaders])

  useEffect(() => {
    void load()
  }, [load])

  async function handleEdit(p: Pipeline) {
    setLoadingEdit(true)
    try {
      const res = await fetch(`/api/pipelines/${p.id}`, { headers: authHeaders })
      if (res.ok) {
        const detail = (await res.json()) as PipelineDetail
        setModal({ mode: 'edit', pipeline: detail })
      } else {
        showToast('error', 'Failed to load pipeline details')
      }
    } catch {
      showToast('error', 'Failed to load pipeline details')
    } finally {
      setLoadingEdit(false)
    }
  }

  async function handleSetDefault(p: Pipeline) {
    setSettingDefault(p.id)
    try {
      const res = await fetch(`/api/pipelines/${p.id}/set-default`, {
        method: 'PUT',
        headers: authHeaders,
      })
      if (res.ok) {
        setPipelines((prev) => prev.map((pl) => ({ ...pl, is_default: pl.id === p.id })))
        showToast('success', `"${p.name}" set as default`)
      } else {
        showToast('error', 'Failed to set default')
      }
    } catch {
      showToast('error', 'Failed to set default')
    } finally {
      setSettingDefault(null)
    }
  }

  if (loading) {
    return <p className="text-sm text-gray-400 py-4">Loading pipelines...</p>
  }

  return (
    <div className="space-y-4">
      {/* Toast */}
      {toast && (
        <p
          className={`text-sm px-3 py-2 rounded-lg ${
            toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
          }`}
        >
          {toast.msg}
        </p>
      )}

      {/* Pipeline list */}
      {pipelines.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-gray-200 p-8 text-center">
          <p className="text-sm text-gray-400">No {pipelineType} pipelines yet.</p>
          <p className="text-xs text-gray-300 mt-1">Create one to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {pipelines.map((p) => (
            <PipelineCard
              key={p.id}
              pipeline={p}
              onEdit={(pl) => void handleEdit(pl)}
              onDelete={(pl) => setModal({ mode: 'delete', pipeline: pl })}
              onSetDefault={(pl) => void handleSetDefault(pl)}
              settingDefault={settingDefault === p.id}
            />
          ))}
        </div>
      )}

      {/* Create button */}
      <button
        onClick={() => setModal({ mode: 'create' })}
        disabled={loadingEdit}
        className="px-4 py-2 text-sm font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
      >
        + Create Pipeline
      </button>

      {/* Modals */}
      {modal?.mode === 'create' && (
        <PipelineModal
          mode="create"
          defaultType={pipelineType}
          authHeaders={authHeaders}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null)
            showToast('success', 'Pipeline created')
            void load()
          }}
        />
      )}

      {modal?.mode === 'edit' && (
        <PipelineModal
          mode="edit"
          pipeline={modal.pipeline}
          authHeaders={authHeaders}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null)
            showToast('success', 'Pipeline updated')
            void load()
          }}
        />
      )}

      {modal?.mode === 'delete' && (
        <DeleteDialog
          pipeline={modal.pipeline}
          authHeaders={authHeaders}
          onClose={() => setModal(null)}
          onDeleted={() => {
            setModal(null)
            showToast('success', 'Pipeline deleted')
            void load()
          }}
        />
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type TabKey = 'contacts' | 'deals'

const TABS: { key: TabKey; label: string }[] = [
  { key: 'contacts', label: 'Contact Pipelines' },
  { key: 'deals', label: 'Deal Pipelines' },
]

export default function PipelinesSettingsPage() {
  const { data: session } = useSession()
  const token = (session as unknown as Record<string, unknown>)?.accessToken ?? ''
  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token as string}` } : {}),
  }

  const [activeTab, setActiveTab] = useState<TabKey>('contacts')

  return (
    <div className="px-8 py-8 max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900 mb-1">Pipelines</h1>
        <p className="text-sm text-gray-500">
          Manage contact and deal pipelines with customizable stages.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-gray-200">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Panel — key forces remount on tab switch so each has independent state */}
      <PipelinesPanel key={activeTab} pipelineType={activeTab} authHeaders={authHeaders} />
    </div>
  )
}
