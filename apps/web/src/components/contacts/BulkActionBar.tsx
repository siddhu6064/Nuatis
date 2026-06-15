'use client'

import { useState, useEffect } from 'react'
import { getFirstName } from '@nuatis/shared'
import type { FilterState } from './ContactFilters'

interface Contact {
  id: string
  full_name: string
  phone: string | null
  sms_opt_in?: boolean | null
}

interface Stage {
  id: string
  name: string
  color: string
}

interface Props {
  selectedIds: Set<string>
  allMatchingSelected: boolean
  total: number
  filters: FilterState
  contacts: Contact[]
  onClear: () => void
  onComplete: () => void
}

type Modal = null | 'stage' | 'tag' | 'sms' | 'assign' | 'archive'

export default function BulkActionBar({
  selectedIds,
  allMatchingSelected,
  total,
  contacts,
  onClear,
  onComplete,
}: Props) {
  const [modal, setModal] = useState<Modal>(null)
  const [stages, setStages] = useState<Stage[]>([])
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // Stage picker state
  const [selectedStage, setSelectedStage] = useState('')

  // Tag editor state
  const [tagsToAdd, setTagsToAdd] = useState('')
  const [tagsToRemove, setTagsToRemove] = useState('')

  // SMS state
  const [smsMessage, setSmsMessage] = useState('')

  // Assign state
  const [assignTo, setAssignTo] = useState('')

  const count = allMatchingSelected ? total : selectedIds.size
  const ids = [...selectedIds]

  useEffect(() => {
    void fetch('/api/contacts/stages')
      .then((r) => r.json())
      .then((d: { stages: Stage[] }) => setStages(d.stages))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  const showToast = (msg: string) => setToast(msg)

  const handleStage = async () => {
    if (!selectedStage) return
    setLoading(true)
    try {
      const res = await fetch('/api/contacts/bulk/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_ids: ids, pipeline_stage_id: selectedStage }),
      })
      if (res.ok) {
        const data = (await res.json()) as { updated: number }
        const stageName = stages.find((s) => s.id === selectedStage)?.name ?? ''
        showToast(`${data.updated} contacts moved to ${stageName}`)
        setModal(null)
        onComplete()
      }
    } finally {
      setLoading(false)
    }
  }

  const handleTag = async () => {
    const add = tagsToAdd
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
    if (add.length === 0) return
    setLoading(true)
    try {
      const res = await fetch('/api/contacts/bulk-tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactIds: ids, tags: add }),
      })
      if (res.ok) {
        const data = (await res.json()) as { updated: number }
        showToast(`Tagged ${data.updated} contacts`)
        setModal(null)
        setTagsToAdd('')
        setTagsToRemove('')
        onComplete()
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSms = async () => {
    if (!smsMessage.trim()) return
    setLoading(true)
    try {
      const res = await fetch('/api/contacts/bulk-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactIds: ids, message: smsMessage }),
      })
      if (res.ok) {
        const data = (await res.json()) as { queued: number }
        showToast(`Queued ${data.queued} SMS messages`)
        setModal(null)
        setSmsMessage('')
        onComplete()
      }
    } finally {
      setLoading(false)
    }
  }

  const handleAssign = async () => {
    if (!assignTo.trim()) return
    setLoading(true)
    try {
      const res = await fetch('/api/contacts/bulk-assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactIds: ids, assignedTo: assignTo.trim() }),
      })
      if (res.ok) {
        const data = (await res.json()) as { updated: number }
        showToast(`Assigned ${data.updated} contacts`)
        setModal(null)
        setAssignTo('')
        onComplete()
      }
    } finally {
      setLoading(false)
    }
  }

  const handleArchive = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/contacts/bulk/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_ids: ids }),
      })
      if (res.ok) {
        const data = (await res.json()) as { updated: number }
        showToast(`${data.updated} contacts archived`)
        setModal(null)
        onComplete()
      }
    } finally {
      setLoading(false)
    }
  }

  const handleExport = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/contacts/bulk/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_ids: ids }),
      })
      if (res.ok) {
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `contacts-export-${new Date().toISOString().split('T')[0]}.csv`
        a.click()
        URL.revokeObjectURL(url)
        showToast('Export downloaded')
      }
    } finally {
      setLoading(false)
    }
  }

  const selectedContacts = contacts.filter((c) => selectedIds.has(c.id))
  const noPhoneCount = selectedContacts.filter((c) => !c.phone).length
  const optOutCount = selectedContacts.filter((c) => c.sms_opt_in === false).length
  const smsBlockedCount = selectedContacts.filter((c) => !c.phone || c.sms_opt_in === false).length
  const firstContact = selectedContacts[0]
  const firstName = getFirstName(firstContact?.full_name, 'John')

  return (
    <>
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 right-4 z-[60] px-4 py-2 bg-gray-900 text-white text-sm rounded-lg shadow-lg">
          {toast}
        </div>
      )}

      {/* Floating bar */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-white border border-border-brand rounded-xl shadow-xl px-4 py-3 flex items-center gap-3">
        <span className="text-sm font-medium text-ink2">{count} selected</span>
        <div className="w-px h-5 bg-bg3" />
        <button
          onClick={() => setModal('stage')}
          className="px-3 py-1.5 text-xs font-medium text-ink2 bg-bg2 rounded-md hover:bg-bg3"
        >
          Move Stage
        </button>
        <button
          onClick={() => setModal('tag')}
          className="px-3 py-1.5 text-xs font-medium text-ink2 bg-bg2 rounded-md hover:bg-bg3"
        >
          Tag
        </button>
        <button
          onClick={() => setModal('assign')}
          className="px-3 py-1.5 text-xs font-medium text-ink2 bg-bg2 rounded-md hover:bg-bg3"
        >
          Assign
        </button>
        <span title={optOutCount > 0 ? 'Some contacts have opted out' : undefined}>
          <button
            onClick={() => setModal('sms')}
            disabled={optOutCount > 0}
            className="px-3 py-1.5 text-xs font-medium text-ink2 bg-bg2 rounded-md hover:bg-bg3 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Send SMS
          </button>
        </span>
        <button
          onClick={() => void handleExport()}
          disabled={loading}
          className="px-3 py-1.5 text-xs font-medium text-ink2 bg-bg2 rounded-md hover:bg-bg3 disabled:opacity-50"
        >
          Export
        </button>
        <button
          onClick={() => setModal('archive')}
          className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-md hover:bg-red-100"
        >
          Archive
        </button>
        <button onClick={onClear} className="text-ink4 hover:text-ink3 text-sm ml-1">
          &times;
        </button>
      </div>

      {/* Modals */}
      {modal && (
        <div className="fixed inset-0 z-[55] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setModal(null)} />
          <div className="relative bg-white rounded-xl shadow-2xl border border-border-brand w-full max-w-md p-5">
            {modal === 'stage' && (
              <>
                <h3 className="text-sm font-bold text-ink mb-3">Move to Stage</h3>
                <div className="space-y-1 mb-4 max-h-48 overflow-y-auto">
                  {stages.map((s) => (
                    <label
                      key={s.id}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-bg cursor-pointer text-sm"
                    >
                      <input
                        type="radio"
                        name="stage"
                        value={s.id}
                        checked={selectedStage === s.id}
                        onChange={() => setSelectedStage(s.id)}
                        className="text-teal-600"
                      />
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: s.color }}
                      />
                      {s.name}
                    </label>
                  ))}
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setModal(null)} className="px-3 py-1.5 text-xs text-ink3">
                    Cancel
                  </button>
                  <button
                    onClick={() => void handleStage()}
                    disabled={!selectedStage || loading}
                    className="px-4 py-1.5 text-xs font-medium text-white bg-teal-600 rounded-md hover:bg-teal-700 disabled:opacity-50"
                  >
                    {loading ? 'Moving...' : `Move ${count} contacts`}
                  </button>
                </div>
              </>
            )}

            {modal === 'tag' && (
              <>
                <h3 className="text-sm font-bold text-ink mb-3">Edit Tags</h3>
                <div className="space-y-3 mb-4">
                  <div>
                    <label className="text-xs text-ink3 mb-1 block">
                      Add tags (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={tagsToAdd}
                      onChange={(e) => setTagsToAdd(e.target.value)}
                      placeholder="vip, follow-up"
                      className="w-full text-sm border border-border-brand rounded px-3 py-1.5"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-ink3 mb-1 block">
                      Remove tags (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={tagsToRemove}
                      onChange={(e) => setTagsToRemove(e.target.value)}
                      placeholder="old-lead"
                      className="w-full text-sm border border-border-brand rounded px-3 py-1.5"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setModal(null)} className="px-3 py-1.5 text-xs text-ink3">
                    Cancel
                  </button>
                  <button
                    onClick={() => void handleTag()}
                    disabled={loading}
                    className="px-4 py-1.5 text-xs font-medium text-white bg-teal-600 rounded-md hover:bg-teal-700 disabled:opacity-50"
                  >
                    {loading ? 'Updating...' : 'Update tags'}
                  </button>
                </div>
              </>
            )}

            {modal === 'assign' && (
              <>
                <h3 className="text-sm font-bold text-ink mb-3">Assign Contacts</h3>
                <div className="mb-4">
                  <label className="text-xs text-ink3 mb-1 block">Assignee user ID or name</label>
                  <input
                    type="text"
                    value={assignTo}
                    onChange={(e) => setAssignTo(e.target.value)}
                    autoFocus
                    placeholder="User ID..."
                    className="w-full text-sm border border-border-brand rounded px-3 py-1.5"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleAssign()
                    }}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => {
                      setModal(null)
                      setAssignTo('')
                    }}
                    className="px-3 py-1.5 text-xs text-ink3"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => void handleAssign()}
                    disabled={!assignTo.trim() || loading}
                    className="px-4 py-1.5 text-xs font-medium text-white bg-teal-600 rounded-md hover:bg-teal-700 disabled:opacity-50"
                  >
                    {loading ? 'Assigning...' : `Assign ${count} contacts`}
                  </button>
                </div>
              </>
            )}

            {modal === 'sms' && (
              <>
                <h3 className="text-sm font-bold text-ink mb-3">Send Bulk SMS</h3>
                <textarea
                  value={smsMessage}
                  onChange={(e) => setSmsMessage(e.target.value.slice(0, 160))}
                  maxLength={160}
                  rows={4}
                  placeholder="Type your message..."
                  className="w-full text-sm border border-border-brand rounded-lg px-3 py-2 mb-1"
                />
                <div className="flex items-center justify-between mb-3">
                  <button
                    onClick={() =>
                      setSmsMessage((m) =>
                        m.includes('{{first_name}}') ? m : m + '{{first_name}}'
                      )
                    }
                    className="text-[10px] text-teal-600 font-mono bg-teal-50 px-1.5 py-0.5 rounded"
                  >
                    {'{{first_name}}'}
                  </button>
                  <span
                    className={`text-[10px] ${smsMessage.length >= 150 ? 'text-amber-600' : 'text-ink4'}`}
                  >
                    {smsMessage.length}/160
                  </span>
                </div>
                {smsMessage.includes('{{first_name}}') && (
                  <p className="text-[10px] text-ink4 mb-2">
                    Preview: &ldquo;{smsMessage.replace(/\{\{first_name\}\}/g, firstName)}&rdquo;
                  </p>
                )}
                {smsBlockedCount > 0 && (
                  <p className="text-[10px] text-amber-600 mb-2">
                    {noPhoneCount > 0 && `${noPhoneCount} skipped (no phone)`}
                    {noPhoneCount > 0 && optOutCount > 0 && ' · '}
                    {optOutCount > 0 && `${optOutCount} skipped (opted out)`}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <button onClick={() => setModal(null)} className="px-3 py-1.5 text-xs text-ink3">
                    Cancel
                  </button>
                  <button
                    onClick={() => void handleSms()}
                    disabled={!smsMessage.trim() || loading}
                    className="px-4 py-1.5 text-xs font-medium text-white bg-teal-600 rounded-md hover:bg-teal-700 disabled:opacity-50"
                  >
                    {loading ? 'Queuing...' : `Queue ${count - smsBlockedCount} SMS`}
                  </button>
                </div>
              </>
            )}

            {modal === 'archive' && (
              <>
                <h3 className="text-sm font-bold text-ink mb-2">Archive Contacts</h3>
                <p className="text-sm text-ink3 mb-4">
                  Archive {count} contacts? They won&apos;t appear in your contacts list but their
                  history is preserved.
                </p>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setModal(null)} className="px-3 py-1.5 text-xs text-ink3">
                    Cancel
                  </button>
                  <button
                    onClick={() => void handleArchive()}
                    disabled={loading}
                    className="px-4 py-1.5 text-xs font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50"
                  >
                    {loading ? 'Archiving...' : `Archive ${count} contacts`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
