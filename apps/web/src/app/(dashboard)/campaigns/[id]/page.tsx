'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'

// ── Types ──────────────────────────────────────────────────────────────────────

interface CampaignMessage {
  id: string
  channel: string
  subject: string | null
  body: string
  approved: boolean
  ai_generated: boolean
}

interface Campaign {
  id: string
  name: string
  status: string
  objective: string | null
  channels: string[] | null
  segment_id: string | null
  contact_count: number | null
  schedule_at: string | null
  sent_at: string | null
  created_at: string
  // legacy fields still present on the row
  type?: string
  sent_count?: number
  recipient_count?: number
}

interface PerformanceRow {
  channel: string
  total_sent: number
  delivered: number
  opened: number
  clicked: number
  opted_out: number
  failed: number
}

interface DetailResponse {
  campaign: Campaign
  messages: CampaignMessage[]
  performance: PerformanceRow[]
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const CHANNEL_LABEL: Record<string, string> = { sms: 'SMS', email: 'Email', social: 'Social' }

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'long',
    timeStyle: 'short',
  })
}

function minLocalDatetime(): string {
  return new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 16)
}

// ── Spinner ────────────────────────────────────────────────────────────────────

function Spinner({ small }: { small?: boolean }) {
  return (
    <svg
      className={`${small ? 'w-3.5 h-3.5' : 'w-4 h-4'} animate-spin shrink-0`}
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  )
}

// ── Confirm modal ──────────────────────────────────────────────────────────────

interface ConfirmModalProps {
  title: string
  body: string
  confirmLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmModal({
  title,
  body,
  confirmLabel = 'Confirm',
  destructive,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl border border-border-brand w-full max-w-md mx-4 p-6 space-y-4">
        <h3 className="text-base font-bold text-ink">{title}</h3>
        <p className="text-sm text-ink2 whitespace-pre-line">{body}</p>
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-ink2 border border-border-brand rounded-lg hover:bg-bg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors text-white ${
              destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-600 hover:bg-teal-700'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Status banner ──────────────────────────────────────────────────────────────

function StatusBanner({ campaign }: { campaign: Campaign }) {
  const cls: Record<string, string> = {
    running: 'bg-blue-50 border-blue-200 text-blue-800',
    complete: 'bg-green-50 border-green-200 text-green-800',
    cancelled: 'bg-gray-100 border-gray-200 text-gray-600',
    paused: 'bg-orange-50 border-orange-200 text-orange-800',
  }
  const icon: Record<string, string> = {
    running: '🔄',
    complete: '✅',
    cancelled: '🚫',
    paused: '⏸',
  }
  const text: Record<string, string> = {
    running: `Campaign is sending — ${campaign.sent_count ?? 0} sent so far`,
    complete: `Campaign complete — sent ${campaign.sent_at ? `on ${new Date(campaign.sent_at).toLocaleDateString()}` : ''}`,
    cancelled: 'Campaign cancelled',
    paused: 'Campaign paused — check delivery errors and retry manually',
  }
  const s = campaign.status
  return (
    <div
      className={`flex items-center gap-3 px-5 py-3.5 rounded-xl border ${cls[s] ?? 'bg-gray-50 border-gray-200 text-gray-600'}`}
    >
      <span className="text-xl">{icon[s] ?? 'ℹ'}</span>
      <p className="text-sm font-medium">{text[s] ?? s}</p>
      {s === 'running' && (
        <span className="ml-auto flex items-center gap-1.5 text-xs font-medium text-blue-700">
          <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
          Live
        </span>
      )}
    </div>
  )
}

// ── Read-only copy preview ─────────────────────────────────────────────────────

function CopyPreview({ messages, channels }: { messages: CampaignMessage[]; channels: string[] }) {
  if (messages.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-border-brand px-6 py-8 text-center text-sm text-ink3">
        No copy generated yet.
      </div>
    )
  }
  return (
    <div className="space-y-4">
      {channels.map((ch) => {
        const msg = messages.find((m) => m.channel === ch)
        if (!msg) return null
        return (
          <div key={ch} className="bg-white rounded-xl border border-border-brand p-5 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-ink3 uppercase tracking-wide">
                {CHANNEL_LABEL[ch] ?? ch}
              </span>
              {msg.approved ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-50 text-green-700 text-xs font-medium">
                  <svg
                    className="w-3 h-3"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  Approved
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 text-xs">
                  Not approved
                </span>
              )}
            </div>
            {msg.subject && (
              <div>
                <p className="text-xs text-ink3 mb-1">Subject</p>
                <p className="text-sm font-medium text-ink">{msg.subject}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-ink3 mb-1">Body</p>
              <p className="text-sm text-ink whitespace-pre-wrap">{msg.body}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Channel editor tab ─────────────────────────────────────────────────────────

interface ChannelEditorProps {
  channel: string
  msg: CampaignMessage | undefined
  localBody: string
  localSubject: string
  onBodyChange: (v: string) => void
  onSubjectChange: (v: string) => void
  onBlurBody: () => void
  onBlurSubject: () => void
  saving: boolean
  approving: boolean
  regenerating: boolean
  onApprove: () => void
  onRegenerate: () => void
}

function ChannelEditor({
  channel,
  msg,
  localBody,
  localSubject,
  onBodyChange,
  onSubjectChange,
  onBlurBody,
  onBlurSubject,
  saving,
  approving,
  regenerating,
  onApprove,
  onRegenerate,
}: ChannelEditorProps) {
  const bodyLimit = channel === 'sms' ? 160 : channel === 'social' ? 100 : 0
  const subjectLimit = 50
  const bodyLen = localBody.length
  const subjectLen = localSubject.length
  const isApproved = msg?.approved ?? false

  if (!msg) {
    return (
      <div className="py-8 text-center text-sm text-ink3">
        No copy yet — click Regenerate to generate copy for this channel.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Subject (email only) */}
      {channel === 'email' && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-medium text-ink2">Subject line</label>
            <span
              className={`text-xs ${subjectLen > subjectLimit ? 'text-red-600 font-semibold' : 'text-ink3'}`}
            >
              {subjectLen}/{subjectLimit}
            </span>
          </div>
          <input
            type="text"
            value={localSubject}
            onChange={(e) => onSubjectChange(e.target.value)}
            onBlur={onBlurSubject}
            disabled={isApproved || saving}
            placeholder="Email subject…"
            className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-colors ${
              isApproved
                ? 'bg-gray-50 text-ink3 border-border-brand cursor-not-allowed'
                : 'bg-white text-ink border-border-brand'
            }`}
          />
        </div>
      )}

      {/* Body */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-medium text-ink2">
            {channel === 'email' ? 'Body' : 'Message'}
          </label>
          <div className="flex items-center gap-2">
            {saving && <Spinner small />}
            {bodyLimit > 0 && (
              <span
                className={`text-xs ${bodyLen > bodyLimit ? 'text-red-600 font-semibold' : 'text-ink3'}`}
              >
                {bodyLen}/{bodyLimit}
              </span>
            )}
          </div>
        </div>
        <textarea
          value={localBody}
          onChange={(e) => onBodyChange(e.target.value)}
          onBlur={onBlurBody}
          disabled={isApproved || saving}
          rows={channel === 'email' ? 10 : 5}
          placeholder={
            channel === 'sms'
              ? 'SMS message body…'
              : channel === 'email'
                ? 'Email body…'
                : 'Social post…'
          }
          className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent resize-y transition-colors ${
            isApproved
              ? 'bg-gray-50 text-ink3 border-border-brand cursor-not-allowed'
              : 'bg-white text-ink border-border-brand'
          } ${bodyLimit > 0 && bodyLen > bodyLimit ? 'border-red-300 focus:ring-red-400' : ''}`}
        />
      </div>

      {/* Social note */}
      {channel === 'social' && (
        <p className="text-xs text-ink3 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          ℹ Social posting not yet available — copy saved for future use.
        </p>
      )}

      {/* Approval indicator */}
      <div className="flex items-center justify-between">
        <div>
          {isApproved ? (
            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700">
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Approved
            </span>
          ) : (
            <span className="text-sm text-ink3">Not approved</span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRegenerate}
            disabled={isApproved || regenerating}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-ink2 border border-border-brand rounded-lg hover:bg-bg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {regenerating && <Spinner small />}
            Regenerate
          </button>
          {!isApproved && (
            <button
              type="button"
              onClick={onApprove}
              disabled={approving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
            >
              {approving && <Spinner small />}
              Approve {CHANNEL_LABEL[channel] ?? channel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Copy editor (tabbed) ───────────────────────────────────────────────────────

interface CopyEditorProps {
  campaignId: string
  channels: string[]
  messages: CampaignMessage[]
  onReload: () => Promise<void>
}

function CopyEditor({ campaignId, channels, messages, onReload }: CopyEditorProps) {
  const [activeChannel, setActiveChannel] = useState(channels[0] ?? 'sms')
  const [localEdits, setLocalEdits] = useState<Record<string, { body: string; subject: string }>>(
    {}
  )
  const [savingChannel, setSavingChannel] = useState<string | null>(null)
  const [approving, setApproving] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [confirmRegen, setConfirmRegen] = useState(false)
  const [actionErr, setActionErr] = useState<string | null>(null)

  // Sync local edits when messages change
  useEffect(() => {
    const edits: Record<string, { body: string; subject: string }> = {}
    for (const msg of messages) {
      edits[msg.channel] = { body: msg.body, subject: msg.subject ?? '' }
    }
    setLocalEdits(edits)
  }, [messages])

  async function saveEdit(channel: string) {
    const msg = messages.find((m) => m.channel === channel)
    const edit = localEdits[channel]
    if (!msg || !edit) return
    if (edit.body === msg.body && edit.subject === (msg.subject ?? '')) return
    setSavingChannel(channel)
    try {
      await fetch(`/api/campaigns/${campaignId}/messages/${msg.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: edit.body,
          ...(edit.subject ? { subject: edit.subject } : {}),
        }),
      })
      await onReload()
    } catch {
      // silently fail on blur-save; user will see stale indicator
    } finally {
      setSavingChannel(null)
    }
  }

  async function handleApprove() {
    setApproving(true)
    setActionErr(null)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/approve`, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setActionErr((d as { error?: string }).error ?? 'Approval failed')
        return
      }
      await onReload()
    } catch {
      setActionErr('Approval failed — please try again')
    } finally {
      setApproving(false)
    }
  }

  async function handleRegenerate() {
    setConfirmRegen(false)
    setRegenerating(true)
    setActionErr(null)
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setActionErr((d as { error?: string }).error ?? 'Regeneration failed')
        return
      }
      await onReload()
    } catch {
      setActionErr('Regeneration failed — please try again')
    } finally {
      setRegenerating(false)
    }
  }

  const allApproved = channels.every((ch) => messages.find((m) => m.channel === ch)?.approved)

  return (
    <div className="bg-white rounded-xl border border-border-brand overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-border-brand">
        {channels.map((ch) => {
          const msg = messages.find((m) => m.channel === ch)
          const approved = msg?.approved ?? false
          return (
            <button
              key={ch}
              type="button"
              onClick={() => setActiveChannel(ch)}
              className={`px-5 py-3 text-sm font-medium border-b-2 -mb-px transition-colors flex items-center gap-2 ${
                activeChannel === ch
                  ? 'border-teal-600 text-teal-700'
                  : 'border-transparent text-ink3 hover:text-ink2'
              }`}
            >
              {CHANNEL_LABEL[ch] ?? ch}
              {approved && <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />}
            </button>
          )
        })}
      </div>

      {/* Channel content */}
      <div className="p-6">
        {actionErr && (
          <div className="mb-4 px-4 py-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
            {actionErr}
          </div>
        )}

        {channels.map((ch) => (
          <div key={ch} className={activeChannel === ch ? '' : 'hidden'}>
            <ChannelEditor
              channel={ch}
              msg={messages.find((m) => m.channel === ch)}
              localBody={localEdits[ch]?.body ?? ''}
              localSubject={localEdits[ch]?.subject ?? ''}
              onBodyChange={(v) =>
                setLocalEdits((prev) => ({ ...prev, [ch]: { ...prev[ch]!, body: v } }))
              }
              onSubjectChange={(v) =>
                setLocalEdits((prev) => ({ ...prev, [ch]: { ...prev[ch]!, subject: v } }))
              }
              onBlurBody={() => saveEdit(ch)}
              onBlurSubject={() => saveEdit(ch)}
              saving={savingChannel === ch}
              approving={approving}
              regenerating={regenerating}
              onApprove={handleApprove}
              onRegenerate={() => setConfirmRegen(true)}
            />
          </div>
        ))}
      </div>

      {/* Approve all */}
      <div className="px-6 pb-5 flex justify-end">
        <button
          type="button"
          onClick={handleApprove}
          disabled={allApproved || approving}
          className={`flex items-center gap-2 px-4 py-2 text-sm font-semibold rounded-lg transition-colors ${
            allApproved
              ? 'bg-green-50 text-green-700 border border-green-200 cursor-default'
              : 'bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50'
          }`}
        >
          {allApproved ? (
            <>
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              All approved
            </>
          ) : approving ? (
            <>
              <Spinner />
              Approving…
            </>
          ) : (
            'Approve all'
          )}
        </button>
      </div>

      {/* Regenerate confirm */}
      {confirmRegen && (
        <ConfirmModal
          title="Regenerate copy?"
          body="This will overwrite all current copy with new AI-generated content. Any manual edits will be lost and all approvals will be reset."
          confirmLabel="Regenerate"
          onConfirm={handleRegenerate}
          onCancel={() => setConfirmRegen(false)}
        />
      )}
    </div>
  )
}

// ── Schedule section ───────────────────────────────────────────────────────────

interface ScheduleSectionProps {
  campaign: Campaign
  messages: CampaignMessage[]
  onReload: () => Promise<void>
  onCancelled: () => void
}

function ScheduleSection({ campaign, messages, onReload, onCancelled }: ScheduleSectionProps) {
  const channels = campaign.channels ?? []
  const allApproved = channels.every((ch) => messages.find((m) => m.channel === ch)?.approved)

  const [scheduleAt, setScheduleAt] = useState(
    campaign.schedule_at ? new Date(campaign.schedule_at).toISOString().slice(0, 16) : ''
  )
  const [showConfirm, setShowConfirm] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const isFuture = scheduleAt && new Date(scheduleAt).getTime() > Date.now()
  const canSchedule = allApproved && isFuture

  let disabledReason = ''
  if (!allApproved) disabledReason = 'Approve all messages to enable scheduling'
  else if (!scheduleAt || !isFuture) disabledReason = 'Select a future send date and time'

  async function handleScheduleConfirm() {
    setShowConfirm(false)
    setScheduling(true)
    setErr(null)
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule_at: new Date(scheduleAt).toISOString() }),
      })
      const d = await res.json()
      if (!res.ok) {
        setErr((d as { error?: string }).error ?? 'Failed to schedule')
        return
      }
      await onReload()
    } catch {
      setErr('Failed to schedule campaign')
    } finally {
      setScheduling(false)
    }
  }

  async function handleCancel() {
    setShowCancelConfirm(false)
    setCancelling(true)
    setErr(null)
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/cancel`, { method: 'POST' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setErr((d as { error?: string }).error ?? 'Failed to cancel')
        return
      }
      onCancelled()
      await onReload()
    } catch {
      setErr('Failed to cancel campaign')
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border-brand p-6 space-y-5">
      <h2 className="text-sm font-semibold text-ink">Schedule your campaign</h2>

      {err && (
        <div className="px-4 py-3 bg-red-50 text-red-600 text-sm rounded-lg border border-red-100">
          {err}
        </div>
      )}

      {campaign.status === 'scheduled' ? (
        /* Scheduled view */
        <div className="space-y-4">
          <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
            <span className="text-amber-600 text-lg">🗓</span>
            <div>
              <p className="text-xs font-medium text-amber-700 mb-0.5">Scheduled for</p>
              <p className="text-sm font-semibold text-amber-900">
                {fmtDateTime(campaign.schedule_at)}
              </p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink2 mb-1.5">Change schedule</label>
            <input
              type="datetime-local"
              value={scheduleAt}
              min={minLocalDatetime()}
              onChange={(e) => setScheduleAt(e.target.value)}
              className="w-full px-3 py-2 text-sm text-ink border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setShowCancelConfirm(true)}
              disabled={cancelling}
              className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-red-600 border border-red-200 bg-red-50 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors"
            >
              {cancelling && <Spinner small />}
              Cancel campaign
            </button>

            <button
              type="button"
              onClick={() => isFuture && setShowConfirm(true)}
              disabled={!isFuture || scheduling}
              className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {scheduling && <Spinner />}
              Update schedule
            </button>
          </div>
        </div>
      ) : (
        /* Draft view */
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink2 mb-1.5">Send date and time</label>
            <input
              type="datetime-local"
              value={scheduleAt}
              min={minLocalDatetime()}
              onChange={(e) => setScheduleAt(e.target.value)}
              className="w-full px-3 py-2 text-sm text-ink border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </div>

          {disabledReason && (
            <p className="text-xs text-ink3 flex items-center gap-1.5">
              <span>ℹ</span>
              {disabledReason}
            </p>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setShowConfirm(true)}
              disabled={!canSchedule || scheduling}
              className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {scheduling && <Spinner />}
              Schedule campaign
            </button>
          </div>
        </div>
      )}

      {/* Schedule confirm modal */}
      {showConfirm && (
        <ConfirmModal
          title="Schedule campaign?"
          body={[
            campaign.contact_count
              ? `${campaign.contact_count.toLocaleString()} contacts will receive this campaign on ${fmtDateTime(scheduleAt ? new Date(scheduleAt).toISOString() : null)}.`
              : `This campaign will send on ${fmtDateTime(scheduleAt ? new Date(scheduleAt).toISOString() : null)}.`,
            'This action cannot be undone.',
          ].join('\n\n')}
          confirmLabel="Schedule"
          onConfirm={handleScheduleConfirm}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      {/* Cancel confirm modal */}
      {showCancelConfirm && (
        <ConfirmModal
          title="Cancel this campaign?"
          body="The scheduled send will be removed. This action cannot be undone."
          confirmLabel="Yes, cancel"
          destructive
          onConfirm={handleCancel}
          onCancel={() => setShowCancelConfirm(false)}
        />
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function CampaignDetailPage() {
  const params = useParams()
  const router = useRouter()
  const id = params?.id as string

  const [campaign, setCampaign] = useState<Campaign | null>(null)
  const [messages, setMessages] = useState<CampaignMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState(false)

  const loadCampaign = useCallback(async () => {
    if (!id) return
    try {
      const res = await fetch(`/api/campaigns/${id}`)
      if (!res.ok) throw new Error('Not found')
      const data = (await res.json()) as DetailResponse
      setCampaign(data.campaign)
      setMessages(data.messages)
    } catch {
      setError('Failed to load campaign.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    setLoading(true)
    void loadCampaign()
  }, [loadCampaign])

  async function handleCancelRunning() {
    if (!campaign) return
    if (!confirm('Cancel this campaign? This cannot be undone.')) return
    setCancelling(true)
    const res = await fetch(`/api/campaigns/${campaign.id}/cancel`, { method: 'POST' })
    setCancelling(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      alert((d as { error?: string }).error ?? 'Failed to cancel')
      return
    }
    await loadCampaign()
  }

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="px-8 py-8 space-y-4 animate-pulse">
        <div className="h-7 bg-gray-200 rounded w-48 mb-2" />
        <div className="h-4 bg-gray-100 rounded w-32" />
        <div className="h-40 bg-white border border-border-brand rounded-xl mt-6" />
        <div className="h-64 bg-white border border-border-brand rounded-xl" />
      </div>
    )
  }

  // ── Error ───────────────────────────────────────────────────────────────────
  if (error || !campaign) {
    return (
      <div className="px-8 py-8">
        <Link href="/campaigns" className="text-sm text-teal-700 hover:text-teal-800 font-medium">
          ← All Campaigns
        </Link>
        <div className="mt-6 bg-white border border-border-brand rounded-xl px-6 py-12 text-center">
          <p className="text-sm text-red-600">{error ?? 'Campaign not found.'}</p>
        </div>
      </div>
    )
  }

  const channels = campaign.channels ?? []
  const isP13 = channels.length > 0
  const editingMode = campaign.status === 'draft' || campaign.status === 'scheduled'
  const runningMode = campaign.status === 'running'
  const doneMode =
    campaign.status === 'complete' ||
    campaign.status === 'cancelled' ||
    campaign.status === 'paused'

  return (
    <div className="px-8 py-8 space-y-6 max-w-3xl">
      {/* Back + header */}
      <div>
        <Link href="/campaigns" className="text-sm text-teal-700 hover:text-teal-800 font-medium">
          ← All Campaigns
        </Link>
        <div className="mt-3 flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold text-ink truncate">{campaign.name}</h1>
            {campaign.objective && (
              <p className="text-sm text-ink3 mt-0.5 capitalize">
                {campaign.objective.replace(/_/g, ' ')}
              </p>
            )}
          </div>
          {campaign.status === 'scheduled' && (
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
              Scheduled
            </span>
          )}
          {campaign.status === 'draft' && (
            <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">
              Draft
            </span>
          )}
        </div>
      </div>

      {/* ── Running mode ─────────────────────────────────────────────────────── */}
      {runningMode && (
        <>
          <StatusBanner campaign={campaign} />
          {isP13 && (
            <>
              <CopyPreview messages={messages} channels={channels} />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleCancelRunning}
                  disabled={cancelling}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 border border-red-200 bg-red-50 rounded-lg hover:bg-red-100 disabled:opacity-50 transition-colors"
                >
                  {cancelling && <Spinner />}
                  Cancel campaign
                </button>
              </div>
            </>
          )}
        </>
      )}

      {/* ── Complete / cancelled / paused mode ───────────────────────────────── */}
      {doneMode && (
        <>
          <StatusBanner campaign={campaign} />
          <div className="flex gap-3">
            <Link
              href={`/campaigns/${campaign.id}/performance`}
              className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
            >
              View performance →
            </Link>
          </div>
          {isP13 && <CopyPreview messages={messages} channels={channels} />}
        </>
      )}

      {/* ── Draft / Scheduled mode (editing) ─────────────────────────────────── */}
      {editingMode && (
        <>
          {isP13 ? (
            <CopyEditor
              campaignId={campaign.id}
              channels={channels}
              messages={messages}
              onReload={loadCampaign}
            />
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-sm text-amber-800">
              Legacy campaign — use the old editor flow.{' '}
              <button
                type="button"
                onClick={() => router.push(`/campaigns/new?id=${campaign.id}`)}
                className="underline font-medium"
              >
                Open editor →
              </button>
            </div>
          )}

          {isP13 && (
            <ScheduleSection
              campaign={campaign}
              messages={messages}
              onReload={loadCampaign}
              onCancelled={() => router.push('/campaigns')}
            />
          )}
        </>
      )}
    </div>
  )
}
