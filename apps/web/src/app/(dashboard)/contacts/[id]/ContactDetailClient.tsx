'use client'

import { useState, useCallback, useEffect } from 'react'
import AddNoteForm from '@/components/contacts/AddNoteForm'
import ContactTasks from '@/components/contacts/ContactTasks'
import ActivityTimeline from '@/components/contacts/ActivityTimeline'

interface Props {
  contactId: string
}

export default function ContactDetailClient({ contactId }: Props) {
  const [refreshKey, setRefreshKey] = useState(0)

  // Referral fields
  const [referralSource, setReferralSource] = useState('')
  const [referralSuggestions, setReferralSuggestions] = useState<string[]>([])
  const [showReferralSuggestions, setShowReferralSuggestions] = useState(false)
  const [referredByName, setReferredByName] = useState<string | null>(null)
  const [referredById, setReferredById] = useState<string | null>(null)
  const [editingReferral, setEditingReferral] = useState(false)

  // Load contact referral data
  useEffect(() => {
    void fetch(`/api/contacts/${contactId}`)
      .then((r) => r.json())
      .then((c: { referral_source_detail?: string; referred_by_contact_id?: string }) => {
        if (c.referral_source_detail) setReferralSource(c.referral_source_detail)
        if (c.referred_by_contact_id) {
          setReferredById(c.referred_by_contact_id)
          // Fetch referred-by contact name
          void fetch(`/api/contacts/${c.referred_by_contact_id}`)
            .then((r2) => r2.json())
            .then((ref: { full_name?: string }) => {
              if (ref.full_name) setReferredByName(ref.full_name)
            })
            .catch(() => {})
        }
      })
      .catch(() => {})
  }, [contactId])

  // Fetch referral source autocomplete
  useEffect(() => {
    void fetch('/api/contacts/referral-sources')
      .then((r) => r.json())
      .then((d: { sources: string[] }) => setReferralSuggestions(d.sources))
      .catch(() => {})
  }, [])

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

  return (
    <>
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

      {/* Add Note */}
      <div className="mb-6">
        <AddNoteForm contactId={contactId} onNoteAdded={handleNoteAdded} />
      </div>

      {/* Tasks */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-6">
        <ContactTasks contactId={contactId} />
      </div>

      {/* Activity Timeline */}
      <div className="bg-white rounded-xl border border-gray-100">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Activity</h2>
        </div>
        <ActivityTimeline contactId={contactId} refreshKey={refreshKey} />
      </div>
    </>
  )
}
