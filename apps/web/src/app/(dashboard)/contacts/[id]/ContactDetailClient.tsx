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

  useEffect(() => {
    void fetch(`/api/contacts/${contactId}`)
      .then((r) => r.json())
      .then(
        (c: {
          referral_source_detail?: string
          referred_by_contact_id?: string
          email?: string
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
        }
      )
      .catch(() => {})

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
