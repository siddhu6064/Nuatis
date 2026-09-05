'use client'

import { useState, useEffect, useCallback } from 'react'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Button from '@mui/material/Button'
import Switch from '@mui/material/Switch'
import { Modal } from '@/components/ui/Modal'

type Channel = 'sms' | 'email'

interface Step {
  id?: string
  channel: Channel
  days_after: number
  template: string
  subject?: string | null
}

interface Sequence {
  id: string
  name: string
  enabled: boolean
  steps: Step[]
  active_enrollments: number
}

interface Enrollment {
  id: string
  contact_id: string
  current_step: number
  status: 'active' | 'completed' | 'stopped'
  last_sent_at: string | null
  enrolled_at: string
  contacts: { id: string; full_name: string; phone: string | null; email: string | null } | null
}

interface ContactSearchResult {
  id: string
  full_name: string
}

const EMPTY_STEP: Step = { channel: 'sms', days_after: 1, template: '' }

export default function OutreachSequencesClient() {
  const [sequences, setSequences] = useState<Sequence[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [steps, setSteps] = useState<Step[]>([{ ...EMPTY_STEP }])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [enrollments, setEnrollments] = useState<Enrollment[]>([])
  const [enrollSearch, setEnrollSearch] = useState('')
  const [enrollResults, setEnrollResults] = useState<ContactSearchResult[]>([])

  const fetchSequences = useCallback(async () => {
    const res = await fetch('/api/outreach-sequences')
    if (res.ok) {
      const data = (await res.json()) as { data: Sequence[] }
      setSequences(data.data)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchSequences()
  }, [fetchSequences])

  useEffect(() => {
    if (!enrollSearch.trim()) {
      setEnrollResults([])
      return
    }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/contacts?search=${encodeURIComponent(enrollSearch)}&limit=5`)
      if (res.ok) {
        const data = (await res.json()) as { contacts: ContactSearchResult[] }
        setEnrollResults(data.contacts ?? [])
      }
    }, 300)
    return () => clearTimeout(t)
  }, [enrollSearch])

  function openCreate() {
    setEditingId(null)
    setName('')
    setSteps([{ ...EMPTY_STEP }])
    setError('')
    setShowForm(true)
  }

  function openEdit(seq: Sequence) {
    setEditingId(seq.id)
    setName(seq.name)
    setSteps(seq.steps.length > 0 ? seq.steps.map((s) => ({ ...s })) : [{ ...EMPTY_STEP }])
    setError('')
    setShowForm(true)
  }

  async function handleSave() {
    setError('')
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    if (steps.some((s) => !s.template.trim())) {
      setError('Every step needs a message')
      return
    }

    setSaving(true)
    try {
      const body = { name: name.trim(), steps }
      const res = await fetch(
        editingId ? `/api/outreach-sequences/${editingId}` : '/api/outreach-sequences',
        {
          method: editingId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      )
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error ?? 'Failed to save sequence')
      }
      setShowForm(false)
      await fetchSequences()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save sequence')
    } finally {
      setSaving(false)
    }
  }

  async function toggleEnabled(seq: Sequence) {
    const res = await fetch(`/api/outreach-sequences/${seq.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !seq.enabled }),
    })
    if (res.ok) await fetchSequences()
  }

  async function handleDelete(seq: Sequence) {
    if (!confirm(`Delete "${seq.name}"? Active enrollments will stop.`)) return
    const res = await fetch(`/api/outreach-sequences/${seq.id}`, { method: 'DELETE' })
    if (res.ok) await fetchSequences()
  }

  async function toggleExpand(seq: Sequence) {
    if (expandedId === seq.id) {
      setExpandedId(null)
      return
    }
    setExpandedId(seq.id)
    setEnrollSearch('')
    setEnrollResults([])
    const res = await fetch(`/api/outreach-sequences/${seq.id}/enrollments`)
    if (res.ok) {
      const data = (await res.json()) as { data: Enrollment[] }
      setEnrollments(data.data)
    }
  }

  async function enrollContact(sequenceId: string, contactId: string) {
    const res = await fetch(`/api/outreach-sequences/${sequenceId}/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_id: contactId }),
    })
    if (res.ok) {
      setEnrollSearch('')
      setEnrollResults([])
      const refreshed = await fetch(`/api/outreach-sequences/${sequenceId}/enrollments`)
      if (refreshed.ok) {
        const data = (await refreshed.json()) as { data: Enrollment[] }
        setEnrollments(data.data)
      }
      await fetchSequences()
    }
  }

  async function stopEnrollment(sequenceId: string, enrollmentId: string) {
    const res = await fetch(
      `/api/outreach-sequences/${sequenceId}/enrollments/${enrollmentId}/stop`,
      { method: 'POST' }
    )
    if (res.ok) {
      setEnrollments((rows) =>
        rows.map((r) => (r.id === enrollmentId ? { ...r, status: 'stopped' } : r))
      )
      await fetchSequences()
    }
  }

  function updateStep(i: number, patch: Partial<Step>) {
    setSteps((rows) => rows.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }

  const STATUS_LABEL: Record<Enrollment['status'], string> = {
    active: 'Active',
    completed: 'Completed',
    stopped: 'Stopped',
  }

  const STATUS_PILL: Record<Enrollment['status'], string> = {
    active: 'bg-green-50 text-green-700',
    completed: 'bg-blue-50 text-blue-700',
    stopped: 'bg-gray-100 text-gray-500',
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="contained" onClick={openCreate}>
          + New Sequence
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-ink4">Loading…</p>
      ) : sequences.length === 0 ? (
        <div className="bg-white rounded-xl border border-border-brand p-8 text-center">
          <p className="text-sm text-ink4">No outreach sequences yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sequences.map((seq) => (
            <div
              key={seq.id}
              className="bg-white rounded-xl border border-border-brand transition-shadow hover:shadow-md"
            >
              <div className="px-5 py-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-ink">{seq.name}</p>
                  <p className="text-xs text-ink4 mt-0.5">
                    {seq.steps.length} step{seq.steps.length === 1 ? '' : 's'} ·{' '}
                    {seq.active_enrollments} active enrollment
                    {seq.active_enrollments === 1 ? '' : 's'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={seq.enabled}
                    onChange={() => void toggleEnabled(seq)}
                    size="small"
                    slotProps={{ input: { 'aria-label': 'Toggle sequence enabled' } }}
                  />
                  <Button size="small" variant="outlined" onClick={() => toggleExpand(seq)}>
                    {expandedId === seq.id ? 'Hide' : 'Manage'}
                  </Button>
                  <Button size="small" onClick={() => openEdit(seq)}>
                    Edit
                  </Button>
                  <Button size="small" color="error" onClick={() => void handleDelete(seq)}>
                    Delete
                  </Button>
                </div>
              </div>

              {expandedId === seq.id && (
                <div className="border-t border-border-brand px-5 py-4 space-y-3">
                  <div className="relative">
                    <TextField
                      size="small"
                      placeholder="Search contacts to enroll..."
                      value={enrollSearch}
                      onChange={(e) => setEnrollSearch(e.target.value)}
                      fullWidth
                    />
                    {enrollResults.length > 0 && (
                      <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-border-brand rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto">
                        {enrollResults.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => void enrollContact(seq.id, c.id)}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-bg text-ink2"
                          >
                            {c.full_name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {enrollments.length === 0 ? (
                    <p className="text-xs text-ink4">No enrollments yet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {enrollments.map((e) => (
                        <div
                          key={e.id}
                          className="flex items-center justify-between text-sm py-1.5 border-b border-gray-50 last:border-0"
                        >
                          <span className="text-ink2">{e.contacts?.full_name ?? '—'}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-ink4">
                              step {e.current_step}/{seq.steps.length}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STATUS_PILL[e.status]}`}
                            >
                              {STATUS_LABEL[e.status]}
                            </span>
                            {e.status === 'active' && (
                              <Button
                                size="small"
                                color="error"
                                onClick={() => void stopEnrollment(seq.id, e.id)}
                              >
                                Stop
                              </Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showForm && (
        <Modal
          onClose={() => setShowForm(false)}
          title={editingId ? 'Edit Sequence' : 'New Sequence'}
          footer={
            <>
              <Button onClick={() => setShowForm(false)} disabled={saving}>
                Cancel
              </Button>
              <Button variant="contained" onClick={() => void handleSave()} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </>
          }
        >
          <div className="space-y-4 pt-1">
            {error && <p className="text-sm text-red-700">{error}</p>}

            <TextField
              label="Sequence name"
              placeholder="e.g. Cold lead nurture"
              value={name}
              onChange={(e) => setName(e.target.value)}
              fullWidth
            />

            <div className="space-y-3">
              {steps.map((step, i) => (
                <div key={i} className="border border-border-brand rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-ink4">Step {i + 1}</span>
                    {steps.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setSteps((rows) => rows.filter((_, idx) => idx !== i))}
                        className="text-xs text-red-500"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <TextField
                      select
                      size="small"
                      label="Channel"
                      value={step.channel}
                      onChange={(e) => updateStep(i, { channel: e.target.value as Channel })}
                    >
                      <MenuItem value="sms">SMS</MenuItem>
                      <MenuItem value="email">Email</MenuItem>
                    </TextField>
                    <TextField
                      size="small"
                      type="number"
                      label="Days after prior step"
                      value={step.days_after}
                      onChange={(e) => updateStep(i, { days_after: Number(e.target.value) || 0 })}
                      slotProps={{ htmlInput: { min: 0 } }}
                    />
                  </div>
                  {step.channel === 'email' && (
                    <TextField
                      size="small"
                      label="Subject"
                      value={step.subject ?? ''}
                      onChange={(e) => updateStep(i, { subject: e.target.value })}
                      fullWidth
                    />
                  )}
                  <TextField
                    size="small"
                    label="Message"
                    placeholder="Hi {name}, ..."
                    value={step.template}
                    onChange={(e) => updateStep(i, { template: e.target.value })}
                    multiline
                    minRows={2}
                    fullWidth
                  />
                </div>
              ))}
              <Button
                size="small"
                variant="outlined"
                onClick={() => setSteps((rows) => [...rows, { ...EMPTY_STEP }])}
              >
                + Add step
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
