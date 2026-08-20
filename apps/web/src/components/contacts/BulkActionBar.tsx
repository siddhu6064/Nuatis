'use client'

import { useState, useEffect } from 'react'
import TextField from '@mui/material/TextField'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import FormControlLabel from '@mui/material/FormControlLabel'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import { getFirstName } from '@nuatis/shared'
import type { FilterState } from './ContactFilters'
import { Modal } from '@/components/ui/Modal'

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

// Named ModalKind, not Modal, to avoid shadowing the imported Modal primitive.
type ModalKind = null | 'stage' | 'tag' | 'sms' | 'assign' | 'archive'

export default function BulkActionBar({
  selectedIds,
  allMatchingSelected,
  total,
  contacts,
  onClear,
  onComplete,
}: Props) {
  const [modal, setModal] = useState<ModalKind>(null)
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

  const modalTitle: Record<Exclude<ModalKind, null>, string> = {
    stage: 'Move to Stage',
    tag: 'Edit Tags',
    assign: 'Assign Contacts',
    sms: 'Send Bulk SMS',
    archive: 'Archive Contacts',
  }

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
        <Button
          onClick={() => setModal('stage')}
          size="small"
          color="inherit"
          sx={{ bgcolor: 'action.hover' }}
        >
          Move Stage
        </Button>
        <Button
          onClick={() => setModal('tag')}
          size="small"
          color="inherit"
          sx={{ bgcolor: 'action.hover' }}
        >
          Tag
        </Button>
        <Button
          onClick={() => setModal('assign')}
          size="small"
          color="inherit"
          sx={{ bgcolor: 'action.hover' }}
        >
          Assign
        </Button>
        <span title={optOutCount > 0 ? 'Some contacts have opted out' : undefined}>
          <Button
            onClick={() => setModal('sms')}
            disabled={optOutCount > 0}
            size="small"
            color="inherit"
            sx={{ bgcolor: 'action.hover' }}
          >
            Send SMS
          </Button>
        </span>
        <Button
          onClick={() => void handleExport()}
          disabled={loading}
          size="small"
          color="inherit"
          sx={{ bgcolor: 'action.hover' }}
        >
          Export
        </Button>
        <Button
          onClick={() => setModal('archive')}
          size="small"
          color="error"
          sx={{ bgcolor: '#fef2f2' }}
        >
          Archive
        </Button>
        <IconButton onClick={onClear} size="small" aria-label="Clear selection" sx={{ ml: 0.5 }}>
          <span className="text-ink4 text-sm">&times;</span>
        </IconButton>
      </div>

      {/* Modals */}
      {modal && (
        <Modal
          onClose={() => setModal(null)}
          title={modalTitle[modal]}
          maxWidth="xs"
          footer={
            <>
              {modal === 'stage' && (
                <>
                  <Button onClick={() => setModal(null)} variant="text" color="inherit">
                    Cancel
                  </Button>
                  <Button
                    onClick={() => void handleStage()}
                    disabled={!selectedStage || loading}
                    variant="contained"
                  >
                    {loading ? 'Moving…' : `Move ${count} contacts`}
                  </Button>
                </>
              )}
              {modal === 'tag' && (
                <>
                  <Button onClick={() => setModal(null)} variant="text" color="inherit">
                    Cancel
                  </Button>
                  <Button onClick={() => void handleTag()} disabled={loading} variant="contained">
                    {loading ? 'Updating…' : 'Update tags'}
                  </Button>
                </>
              )}
              {modal === 'assign' && (
                <>
                  <Button
                    onClick={() => {
                      setModal(null)
                      setAssignTo('')
                    }}
                    variant="text"
                    color="inherit"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={() => void handleAssign()}
                    disabled={!assignTo.trim() || loading}
                    variant="contained"
                  >
                    {loading ? 'Assigning…' : `Assign ${count} contacts`}
                  </Button>
                </>
              )}
              {modal === 'sms' && (
                <>
                  <Button onClick={() => setModal(null)} variant="text" color="inherit">
                    Cancel
                  </Button>
                  <Button
                    onClick={() => void handleSms()}
                    disabled={!smsMessage.trim() || loading}
                    variant="contained"
                  >
                    {loading ? 'Queuing…' : `Queue ${count - smsBlockedCount} SMS`}
                  </Button>
                </>
              )}
              {modal === 'archive' && (
                <>
                  <Button onClick={() => setModal(null)} variant="text" color="inherit">
                    Cancel
                  </Button>
                  <Button
                    onClick={() => void handleArchive()}
                    disabled={loading}
                    variant="contained"
                    color="error"
                  >
                    {loading ? 'Archiving…' : `Archive ${count} contacts`}
                  </Button>
                </>
              )}
            </>
          }
        >
          {modal === 'stage' && (
            <div className="max-h-48 overflow-y-auto">
              <RadioGroup value={selectedStage} onChange={(e) => setSelectedStage(e.target.value)}>
                {stages.map((s) => (
                  <FormControlLabel
                    key={s.id}
                    value={s.id}
                    control={<Radio size="small" />}
                    label={
                      <span className="flex items-center gap-2 text-sm">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: s.color }}
                        />
                        {s.name}
                      </span>
                    }
                  />
                ))}
              </RadioGroup>
            </div>
          )}

          {modal === 'tag' && (
            <div className="space-y-3">
              <TextField
                label="Add tags (comma-separated)"
                value={tagsToAdd}
                onChange={(e) => setTagsToAdd(e.target.value)}
                placeholder="vip, follow-up"
                fullWidth
                size="small"
              />
              <TextField
                label="Remove tags (comma-separated)"
                value={tagsToRemove}
                onChange={(e) => setTagsToRemove(e.target.value)}
                placeholder="old-lead"
                fullWidth
                size="small"
              />
            </div>
          )}

          {modal === 'assign' && (
            <TextField
              label="Assignee user ID or name"
              value={assignTo}
              onChange={(e) => setAssignTo(e.target.value)}
              autoFocus
              placeholder="User ID…"
              fullWidth
              size="small"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleAssign()
              }}
            />
          )}

          {modal === 'sms' && (
            <div>
              <TextField
                value={smsMessage}
                onChange={(e) => setSmsMessage(e.target.value.slice(0, 160))}
                multiline
                rows={4}
                placeholder="Type your message…"
                fullWidth
                size="small"
                slotProps={{ htmlInput: { maxLength: 160 } }}
              />
              <div className="flex items-center justify-between mt-1 mb-3">
                <Button
                  onClick={() =>
                    setSmsMessage((m) => (m.includes('{{first_name}}') ? m : m + '{{first_name}}'))
                  }
                  size="small"
                  sx={{
                    fontSize: 10,
                    fontFamily: 'monospace',
                    minWidth: 0,
                    py: 0.25,
                    px: 0.75,
                    bgcolor: '#f0fdfa',
                  }}
                >
                  {'{{first_name}}'}
                </Button>
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
            </div>
          )}

          {modal === 'archive' && (
            <p className="text-sm text-ink3">
              {`Archive ${count} contacts? They won't appear in your contacts list but their history is preserved.`}
            </p>
          )}
        </Modal>
      )}
    </>
  )
}
