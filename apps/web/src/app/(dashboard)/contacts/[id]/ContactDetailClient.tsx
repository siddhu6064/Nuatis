'use client'

import { useState, useCallback, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import AddNoteForm from '@/components/contacts/AddNoteForm'
import ContactTasks from '@/components/contacts/ContactTasks'
import ActivityTimeline from '@/components/contacts/ActivityTimeline'
import FileAttachments from '@/components/contacts/FileAttachments'
import SmsThread from '@/components/contacts/SmsThread'
import ContactDeals from '@/components/contacts/ContactDeals'
import EmailComposeModal from '../../../../components/contacts/EmailComposeModal'

type Tab = 'activity' | 'messages' | 'files'

interface Props {
  contactId: string
  contactName: string
}

export default function ContactDetailClient({ contactId, contactName }: Props) {
  const searchParams = useSearchParams()
  const initialTab = (searchParams.get('tab') as Tab) ?? 'activity'
  const [activeTab, setActiveTab] = useState<Tab>(initialTab)
  const [refreshKey, setRefreshKey] = useState(0)
  const [smsUnread, setSmsUnread] = useState(0)
  const [fileCount, setFileCount] = useState(0)
  const [showEmailModal, setShowEmailModal] = useState(false)
  const [contactEmail, setContactEmail] = useState('')

  // Referral fields
  const [referralSource, setReferralSource] = useState('')
  const [referralSuggestions, setReferralSuggestions] = useState<string[]>([])
  const [showReferralSuggestions, setShowReferralSuggestions] = useState(false)
  const [referredByName, setReferredByName] = useState<string | null>(null)
  const [referredById, setReferredById] = useState<string | null>(null)
  const [editingReferral, setEditingReferral] = useState(false)

  // Lifecycle & lead score fields
  type LifecycleStage =
    | 'subscriber'
    | 'lead'
    | 'marketing_qualified'
    | 'sales_qualified'
    | 'opportunity'
    | 'customer'
    | 'evangelist'
    | 'other'
  const [lifecycleStage, setLifecycleStage] = useState<LifecycleStage | null>(null)
  const [leadScore, setLeadScore] = useState<number | null>(null)
  const [leadGrade, setLeadGrade] = useState<string | null>(null)
  const [leadScoreUpdatedAt, setLeadScoreUpdatedAt] = useState<string | null>(null)
  const [recalculating, setRecalculating] = useState(false)

  const fetchContactData = () => {
    void fetch(`/api/contacts/${contactId}`)
      .then((r) => r.json())
      .then(
        (c: {
          referral_source_detail?: string
          referred_by_contact_id?: string
          email?: string
          lifecycle_stage?: LifecycleStage
          lead_score?: number
          lead_grade?: string
          lead_score_updated_at?: string
        }) => {
          if (c.email) setContactEmail(c.email)
          if (c.referral_source_detail) setReferralSource(c.referral_source_detail)
          if (c.referred_by_contact_id) {
            setReferredById(c.referred_by_contact_id)
            void fetch(`/api/contacts/${c.referred_by_contact_id}`)
              .then((r2) => r2.json())
              .then((ref: { full_name?: string }) => {
                if (ref.full_name) setReferredByName(ref.full_name)
              })
              .catch(() => {})
          }
          if (c.lifecycle_stage) setLifecycleStage(c.lifecycle_stage)
          if (c.lead_score !== undefined && c.lead_score !== null) setLeadScore(c.lead_score)
          if (c.lead_grade) setLeadGrade(c.lead_grade)
          if (c.lead_score_updated_at) setLeadScoreUpdatedAt(c.lead_score_updated_at)
        }
      )
      .catch(() => {})
  }

  useEffect(() => {
    fetchContactData()

    void fetch('/api/contacts/referral-sources')
      .then((r) => r.json())
      .then((d: { sources: string[] }) => setReferralSuggestions(d.sources))
      .catch(() => {})

    // Fetch unread SMS count
    void fetch(`/api/contacts/${contactId}/sms`)
      .then((r) => r.json())
      .then((d: { unread_count: number }) => setSmsUnread(d.unread_count))
      .catch(() => {})

    // Fetch file count
    void fetch(`/api/contacts/${contactId}/attachments`)
      .then((r) => r.json())
      .then((d: { attachments: unknown[] }) => setFileCount(d.attachments.length))
      .catch(() => {})
  }, [contactId])

  const handleNoteAdded = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  const saveReferralSource = async (value: string) => {
    setReferralSource(value)
    setEditingReferral(false)
    setShowReferralSuggestions(false)
    await fetch(`/api/contacts/${contactId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referral_source_detail: value || null }),
    })
  }

  const removeReferredBy = async () => {
    setReferredById(null)
    setReferredByName(null)
    await fetch(`/api/contacts/${contactId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ referred_by_contact_id: null }),
    })
  }

  const lifecycleOptions: Array<{ value: LifecycleStage; label: string }> = [
    { value: 'subscriber', label: 'Subscriber' },
    { value: 'lead', label: 'Lead' },
    { value: 'marketing_qualified', label: 'Marketing Qualified' },
    { value: 'sales_qualified', label: 'Sales Qualified' },
    { value: 'opportunity', label: 'Opportunity' },
    { value: 'customer', label: 'Customer' },
    { value: 'evangelist', label: 'Evangelist' },
    { value: 'other', label: 'Other' },
  ]

  const lifecycleBadgeClass = (stage: LifecycleStage | null): string => {
    switch (stage) {
      case 'subscriber':
        return 'bg-gray-100 text-gray-700'
      case 'lead':
        return 'bg-blue-100 text-blue-700'
      case 'marketing_qualified':
        return 'bg-purple-100 text-purple-700'
      case 'sales_qualified':
        return 'bg-orange-100 text-orange-700'
      case 'opportunity':
        return 'bg-yellow-100 text-yellow-700'
      case 'customer':
        return 'bg-green-100 text-green-700'
      case 'evangelist':
        return 'bg-emerald-100 text-emerald-700'
      case 'other':
        return 'bg-gray-100 text-gray-700'
      default:
        return 'bg-gray-100 text-gray-500'
    }
  }

  const lifecycleLabel = (stage: LifecycleStage | null): string => {
    return lifecycleOptions.find((o) => o.value === stage)?.label ?? 'Not set'
  }

  const gradeBadgeClass = (grade: string | null): string => {
    switch (grade) {
      case 'A':
        return 'bg-green-100 text-green-700'
      case 'B':
        return 'bg-blue-100 text-blue-700'
      case 'C':
        return 'bg-yellow-100 text-yellow-700'
      case 'D':
        return 'bg-orange-100 text-orange-700'
      case 'F':
        return 'bg-red-100 text-red-700'
      default:
        return 'bg-gray-100 text-gray-500'
    }
  }

  const formatRelativeTime = (iso: string | null): string => {
    if (!iso) return 'Never'
    const date = new Date(iso)
    const diffMs = Date.now() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    const diffHours = Math.floor(diffMins / 60)
    if (diffHours < 24) return `${diffHours}h ago`
    const diffDays = Math.floor(diffHours / 24)
    if (diffDays < 30) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  const handleLifecycleChange = async (newStage: LifecycleStage) => {
    setLifecycleStage(newStage)
    await fetch(`/api/contacts/${contactId}/lifecycle`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lifecycle_stage: newStage }),
    }).catch(() => {})
  }

  const handleRecalculate = async () => {
    setRecalculating(true)
    await fetch(`/api/contacts/${contactId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }).catch(() => {})
    setTimeout(() => {
      fetchContactData()
      setRecalculating(false)
    }, 3000)
  }

  const filteredSuggestions = referralSuggestions.filter(
    (s) => s.toLowerCase().includes(referralSource.toLowerCase()) && s !== referralSource
  )

  const tabs: Array<{ key: Tab; label: string; badge?: number }> = [
    { key: 'activity', label: 'Activity' },
    { key: 'messages', label: 'Messages', badge: smsUnread > 0 ? smsUnread : undefined },
    { key: 'files', label: 'Files', badge: fileCount > 0 ? fileCount : undefined },
  ]

  return (
    <>
      {/* Send Email button */}
      <div className="mb-4">
        <button
          onClick={() => setShowEmailModal(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
        >
          Send Email
        </button>
      </div>

      {/* Referral info */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Referral Info</h2>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-400 text-xs">Referral Source</span>
            {editingReferral ? (
              <div className="relative">
                <input
                  type="text"
                  value={referralSource}
                  onChange={(e) => {
                    setReferralSource(e.target.value)
                    setShowReferralSuggestions(true)
                  }}
                  onBlur={() => {
                    setTimeout(() => setShowReferralSuggestions(false), 200)
                    void saveReferralSource(referralSource)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveReferralSource(referralSource)
                    if (e.key === 'Escape') setEditingReferral(false)
                  }}
                  placeholder="e.g. Google, Instagram, Friend"
                  autoFocus
                  className="w-full text-sm border border-gray-200 rounded px-2 py-1 mt-0.5"
                />
                {showReferralSuggestions && filteredSuggestions.length > 0 && (
                  <div className="absolute top-full left-0 w-full mt-1 bg-white border border-gray-200 rounded shadow-lg z-10 max-h-32 overflow-y-auto">
                    {filteredSuggestions.slice(0, 5).map((s) => (
                      <button
                        key={s}
                        onMouseDown={() => void saveReferralSource(s)}
                        className="block w-full text-left text-xs px-2 py-1.5 hover:bg-gray-50 text-gray-600"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p
                className="text-gray-700 cursor-pointer hover:text-teal-600 mt-0.5"
                onClick={() => setEditingReferral(true)}
              >
                {referralSource || '\u2014'}
              </p>
            )}
          </div>
          <div>
            <span className="text-gray-400 text-xs">Referred By</span>
            {referredByName && referredById ? (
              <div className="flex items-center gap-1.5 mt-0.5">
                <a
                  href={`/contacts/${referredById}`}
                  className="text-sm text-teal-600 hover:text-teal-700 font-medium"
                >
                  {referredByName}
                </a>
                <button
                  onClick={() => void removeReferredBy()}
                  className="text-gray-400 hover:text-red-500 text-xs"
                >
                  &times;
                </button>
              </div>
            ) : (
              <p className="text-gray-700 mt-0.5">{'\u2014'}</p>
            )}
          </div>
        </div>
      </div>

      {/* Lifecycle Stage */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Lifecycle Stage</h2>
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold ${lifecycleBadgeClass(lifecycleStage)}`}
          >
            {lifecycleLabel(lifecycleStage)}
          </span>
          <select
            value={lifecycleStage ?? ''}
            onChange={(e) => {
              if (e.target.value) void handleLifecycleChange(e.target.value as LifecycleStage)
            }}
            className="text-sm border border-gray-200 rounded px-2 py-1 text-gray-600 bg-white focus:outline-none focus:ring-1 focus:ring-teal-500"
          >
            <option value="" disabled>
              Change stage…
            </option>
            {lifecycleOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Lead Score */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Lead Score</h2>
        <div className="flex items-center gap-3 mb-2">
          <span className="text-4xl font-bold text-gray-800">
            {leadScore !== null ? leadScore : '—'}
          </span>
          {leadGrade && (
            <span
              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-sm font-bold ${gradeBadgeClass(leadGrade)}`}
            >
              {leadGrade}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-400 mb-3">
          Last updated: {formatRelativeTime(leadScoreUpdatedAt)}
        </p>
        <button
          onClick={() => void handleRecalculate()}
          disabled={recalculating}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {recalculating ? 'Recalculating…' : 'Recalculate'}
        </button>
      </div>

      {/* Add Note (always visible) */}
      <div className="mb-6">
        <AddNoteForm contactId={contactId} onNoteAdded={handleNoteAdded} />
      </div>

      {/* Tasks */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-6">
        <ContactTasks contactId={contactId} />
      </div>

      {/* Deals */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-6">
        <ContactDeals contactId={contactId} />
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-gray-100">
        <div className="flex border-b border-gray-100">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key)
                if (tab.key === 'messages') setSmsUnread(0)
              }}
              className={`px-4 py-3 text-sm font-medium transition-colors relative ${
                activeTab === tab.key
                  ? 'text-teal-700 border-b-2 border-teal-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span
                  className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                    tab.key === 'messages' ? 'bg-red-500 text-white' : 'bg-gray-200 text-gray-600'
                  }`}
                >
                  {tab.badge > 99 ? '99+' : tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        <div>
          {activeTab === 'activity' && (
            <ActivityTimeline contactId={contactId} refreshKey={refreshKey} />
          )}
          {activeTab === 'messages' && (
            <SmsThread contactId={contactId} contactName={contactName} />
          )}
          {activeTab === 'files' && <FileAttachments contactId={contactId} />}
        </div>
      </div>

      {/* Email compose modal */}
      {showEmailModal && (
        <EmailComposeModal
          contactId={contactId}
          contactEmail={contactEmail}
          contactName={contactName}
          onClose={() => setShowEmailModal(false)}
          onSent={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </>
  )
}
