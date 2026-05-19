'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import ActivityTimeline from '@/components/contacts/ActivityTimeline'

const TAG_COLORS = [
  'bg-teal-50 text-teal-700 border-teal-200',
  'bg-blue-50 text-blue-700 border-blue-200',
  'bg-purple-50 text-purple-700 border-purple-200',
  'bg-amber-50 text-amber-700 border-amber-200',
  'bg-green-50 text-green-700 border-green-200',
]

function tagColorClass(tag: string): string {
  let hash = 0
  for (let i = 0; i < tag.length; i++) {
    hash = ((hash << 5) - hash + tag.charCodeAt(i)) | 0
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length]!
}

interface DealContact {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  role: string | null
}

interface Deal {
  id: string
  title: string
  value: number
  pipeline_stage_id: string | null
  contact_id: string | null
  company_id: string | null
  close_date: string | null
  probability: number
  notes: string | null
  is_closed_won: boolean
  is_closed_lost: boolean
  stage_name: string | null
  stage_color: string | null
  contact_name: string | null
  company_name: string | null
  tags: string[]
  deal_contacts?: DealContact[]
}

interface Stage {
  id: string
  name: string
  color: string
}

interface Calendar {
  id: string
  name: string
}

interface Props {
  dealId: string
}

function getTomorrow() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

const TIME_SLOTS: { value: string; label: string }[] = (() => {
  const slots: { value: string; label: string }[] = []
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const hh = String(h).padStart(2, '0')
      const mm = String(m).padStart(2, '0')
      const ampm = h < 12 ? 'AM' : 'PM'
      const hour = h === 0 ? 12 : h > 12 ? h - 12 : h
      slots.push({ value: `${hh}:${mm}`, label: `${hour}:${mm} ${ampm}` })
    }
  }
  return slots
})()

export default function DealDetail({ dealId }: Props) {
  const [deal, setDeal] = useState<Deal | null>(null)
  const [stages, setStages] = useState<Stage[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notes, setNotes] = useState('')
  const [dealContacts, setDealContacts] = useState<DealContact[]>([])
  const [contactSearch, setContactSearch] = useState('')
  const [searchResults, setSearchResults] = useState<DealContact[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [addingTag, setAddingTag] = useState(false)
  const [showTagSuggestions, setShowTagSuggestions] = useState(false)
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([])

  // Booking state
  const [bookingMode, setBookingMode] = useState(false)
  const [bookingSuccess, setBookingSuccess] = useState<string | null>(null)
  const [apptTitle, setApptTitle] = useState('')
  const [apptDate, setApptDate] = useState('')
  const [apptTime, setApptTime] = useState('09:00')
  const [apptDuration, setApptDuration] = useState(30)
  const [apptNotes, setApptNotes] = useState('')
  const [apptCalendarId, setApptCalendarId] = useState('')
  const [calendars, setCalendars] = useState<Calendar[]>([])
  const [bookingLoading, setBookingLoading] = useState(false)
  const [bookingError, setBookingError] = useState<string | null>(null)

  const fetchDeal = useCallback(async () => {
    const res = await fetch(`/api/deals/${dealId}`)
    if (res.ok) {
      const d = (await res.json()) as Deal
      setDeal(d)
      setNotes(d.notes ?? '')
      setDealContacts(d.deal_contacts ?? [])
      setTags(Array.isArray(d.tags) ? d.tags : [])
    }
  }, [dealId])

  useEffect(() => {
    void fetch('/api/deals/tags')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { tags: string[] } | null) => setTagSuggestions(d?.tags ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    void Promise.all([
      fetchDeal(),
      fetch('/api/contacts/stages')
        .then((r) => r.json())
        .then((d: { stages: Stage[] }) => setStages(d.stages))
        .catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [fetchDeal])

  useEffect(() => {
    if (!contactSearch.trim()) {
      setSearchResults([])
      return
    }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/contacts?search=${encodeURIComponent(contactSearch)}&limit=5`)
      if (res.ok) {
        const data = (await res.json()) as { contacts: DealContact[] }
        setSearchResults(data.contacts ?? [])
      }
    }, 300)
    return () => clearTimeout(t)
  }, [contactSearch])

  const saveTags = async (newTags: string[]) => {
    setTags(newTags)
    await fetch(`/api/deals/${dealId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: newTags }),
    }).catch(() => {})
  }

  const removeTag = (tag: string) => {
    void saveTags(tags.filter((t) => t !== tag))
  }

  const addTag = (tag: string) => {
    const trimmed = tag.trim()
    if (!trimmed || tags.includes(trimmed) || tags.length >= 10) return
    void saveTags([...tags, trimmed])
    setTagInput('')
    setAddingTag(false)
    setShowTagSuggestions(false)
  }

  const filteredTagSuggestions = tagSuggestions.filter(
    (s) => s.toLowerCase().includes(tagInput.toLowerCase()) && !tags.includes(s)
  )

  const updateDeal = async (updates: Record<string, unknown>) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (res.ok) void fetchDeal()
    } finally {
      setSaving(false)
    }
  }

  const addContact = async (contactId: string) => {
    const res = await fetch(`/api/deals/${dealId}/contacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactId }),
    })
    if (res.ok) {
      setContactSearch('')
      setSearchResults([])
      void fetchDeal()
    } else {
      const err = (await res.json()) as { error: string }
      alert(err.error)
    }
  }

  const removeContact = async (contactId: string) => {
    await fetch(`/api/deals/${dealId}/contacts/${contactId}`, { method: 'DELETE' })
    void fetchDeal()
  }

  function openBooking() {
    if (!deal) return
    const contactName = deal.contact_name ?? deal.deal_contacts?.[0]?.full_name ?? ''
    setApptTitle(contactName ? `Appointment — ${contactName}` : 'Appointment')
    setApptDate(getTomorrow())
    setApptTime('09:00')
    setApptDuration(30)
    setApptNotes('')
    setApptCalendarId('')
    setBookingError(null)
    setBookingSuccess(null)
    setBookingMode(true)
    fetch('/api/calendars')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { calendars?: Calendar[] } | null) => {
        const cals = d?.calendars ?? []
        setCalendars(cals)
        if (cals[0]) setApptCalendarId(cals[0].id)
      })
      .catch(() => {})
  }

  async function submitBooking() {
    if (!deal) return
    const contactId = deal.contact_id ?? deal.deal_contacts?.[0]?.id
    if (!contactId || !apptDate || !apptTitle) return
    setBookingLoading(true)
    setBookingError(null)
    try {
      const scheduledAt = new Date(`${apptDate}T${apptTime}`).toISOString()
      const res = await fetch('/api/appointments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: apptTitle,
          contact_id: contactId,
          calendar_id: apptCalendarId || undefined,
          scheduled_at: scheduledAt,
          duration_minutes: apptDuration,
          notes: apptNotes || undefined,
          source: 'manual',
        }),
      })
      if (res.ok) {
        const label = new Date(`${apptDate}T${apptTime}`).toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        })
        setBookingSuccess(label)
      } else {
        const err = (await res.json()) as { error?: string }
        setBookingError(err.error ?? 'Failed to book appointment')
      }
    } catch {
      setBookingError('Network error — please try again')
    } finally {
      setBookingLoading(false)
    }
  }

  if (loading || !deal) return <div className="py-12 text-center text-sm text-ink4">Loading...</div>

  const isClosed = deal.is_closed_won || deal.is_closed_lost
  const filteredResults = searchResults.filter((r) => !dealContacts.some((c) => c.id === r.id))

  return (
    <div>
      {/* Header */}
      <div className="bg-white rounded-xl border border-border-brand p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-ink">{deal.title}</h2>
          {isClosed && (
            <span
              className={`px-2 py-0.5 rounded text-xs font-bold ${deal.is_closed_won ? 'bg-green-100 text-green-700' : 'bg-bg2 text-ink3'}`}
            >
              {deal.is_closed_won ? 'Won' : 'Lost'}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm mb-4">
          <div>
            <span className="text-ink4 text-xs">Value</span>
            <p className="text-xl font-bold text-teal-600">
              ${Number(deal.value).toLocaleString()}
            </p>
          </div>
          <div>
            <span className="text-ink4 text-xs">Probability</span>
            <div className="flex items-center gap-2 mt-0.5">
              <input
                type="range"
                min="0"
                max="100"
                value={deal.probability}
                onChange={(e) => void updateDeal({ probability: parseInt(e.target.value) })}
                className="flex-1 h-1.5 accent-teal-600"
              />
              <span className="text-sm font-medium text-ink2 w-8">{deal.probability}%</span>
            </div>
          </div>
          <div>
            <span className="text-ink4 text-xs">Stage</span>
            <select
              value={deal.pipeline_stage_id ?? ''}
              onChange={(e) => void updateDeal({ pipeline_stage_id: e.target.value })}
              className="mt-0.5 w-full text-sm border border-border-brand rounded px-2 py-1"
            >
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="text-ink4 text-xs">Close Date</span>
            <input
              type="date"
              value={deal.close_date ?? ''}
              onChange={(e) => void updateDeal({ close_date: e.target.value || null })}
              className="mt-0.5 w-full text-sm border border-border-brand rounded px-2 py-1"
            />
          </div>
          {/* Tags */}
          <div className="col-span-2">
            <span className="text-ink4 text-xs block mb-1.5">Tags</span>
            <div className="flex flex-wrap gap-1.5 items-center">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className={`inline-flex items-center gap-0.5 text-[11px] font-medium px-2 py-0.5 rounded-full border ${tagColorClass(tag)}`}
                >
                  {tag}
                  <button
                    onClick={() => removeTag(tag)}
                    className="ml-0.5 hover:opacity-60 leading-none"
                    aria-label={`Remove ${tag}`}
                  >
                    &times;
                  </button>
                </span>
              ))}
              {tags.length < 10 &&
                (addingTag ? (
                  <div className="relative">
                    <input
                      type="text"
                      value={tagInput}
                      autoFocus
                      onChange={(e) => {
                        setTagInput(e.target.value)
                        setShowTagSuggestions(true)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          addTag(tagInput)
                        }
                        if (e.key === 'Escape') {
                          setAddingTag(false)
                          setTagInput('')
                          setShowTagSuggestions(false)
                        }
                      }}
                      onBlur={() =>
                        setTimeout(() => {
                          setShowTagSuggestions(false)
                          if (!tagInput.trim()) setAddingTag(false)
                        }, 150)
                      }
                      placeholder="Add tag…"
                      className="text-xs border border-border-brand rounded-full px-2.5 py-0.5 w-28 focus:outline-none focus:ring-1 focus:ring-teal-500"
                    />
                    {showTagSuggestions && filteredTagSuggestions.length > 0 && (
                      <div className="absolute top-full left-0 mt-1 bg-white border border-border-brand rounded-lg shadow-lg z-20 min-w-[160px] max-h-36 overflow-y-auto">
                        {filteredTagSuggestions.slice(0, 6).map((s) => (
                          <button
                            key={s}
                            onMouseDown={() => addTag(s)}
                            className="block w-full text-left text-xs px-3 py-1.5 hover:bg-bg text-ink2"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={() => setAddingTag(true)}
                    className="text-xs text-teal-600 hover:text-teal-700 font-medium px-2 py-0.5 rounded-full border border-dashed border-teal-300 hover:border-teal-400 transition-colors"
                  >
                    + tag
                  </button>
                ))}
            </div>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          {!isClosed && (
            <>
              <button
                onClick={() => void updateDeal({ is_closed_won: true })}
                disabled={saving}
                className="px-4 py-1.5 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50"
              >
                Mark Won
              </button>
              <button
                onClick={() => void updateDeal({ is_closed_lost: true })}
                disabled={saving}
                className="px-4 py-1.5 text-xs font-medium text-ink3 bg-bg2 rounded-md hover:bg-bg3 disabled:opacity-50"
              >
                Mark Lost
              </button>
            </>
          )}
          {deal.contact_id && (
            <button
              onClick={openBooking}
              className="px-4 py-1.5 text-xs font-medium text-teal-600 border border-teal-200 rounded-md hover:bg-teal-50 transition-colors"
            >
              📅 Book Appointment
            </button>
          )}
        </div>
      </div>

      {/* Inline appointment booking form */}
      {bookingMode && (
        <div className="bg-white rounded-xl border border-border-brand p-5 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={() => {
                setBookingMode(false)
                setBookingSuccess(null)
              }}
              className="text-ink4 hover:text-ink transition-colors text-sm leading-none"
              aria-label="Back"
            >
              ←
            </button>
            <h3 className="text-sm font-semibold text-ink">Book Appointment</h3>
          </div>

          {bookingSuccess ? (
            <div className="text-center py-4">
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-3">
                <span className="text-green-600 text-lg">✓</span>
              </div>
              <p className="text-sm font-semibold text-ink mb-1">Appointment booked!</p>
              <p className="text-xs text-ink3 mb-4">{bookingSuccess}</p>
              <div className="flex items-center justify-center gap-3">
                <Link href="/appointments" className="text-xs text-teal-600 hover:underline">
                  View appointment →
                </Link>
                <button
                  onClick={() => {
                    setBookingMode(false)
                    setBookingSuccess(null)
                  }}
                  className="text-xs text-ink3 hover:text-ink px-3 py-1.5 border border-border-brand rounded-md"
                >
                  Done
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {bookingError && (
                <p className="text-xs text-red-600 bg-red-50 rounded px-3 py-2">{bookingError}</p>
              )}

              <div>
                <label className="text-xs text-ink4 mb-1 block">Title</label>
                <input
                  type="text"
                  value={apptTitle}
                  onChange={(e) => setApptTitle(e.target.value)}
                  className="w-full text-sm border border-border-brand rounded-lg px-3 py-2"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-ink4 mb-1 block">Date</label>
                  <input
                    type="date"
                    value={apptDate}
                    onChange={(e) => setApptDate(e.target.value)}
                    className="w-full text-sm border border-border-brand rounded-lg px-3 py-2"
                  />
                </div>
                <div>
                  <label className="text-xs text-ink4 mb-1 block">Time</label>
                  <select
                    value={apptTime}
                    onChange={(e) => setApptTime(e.target.value)}
                    className="w-full text-sm border border-border-brand rounded-lg px-3 py-2"
                  >
                    {TIME_SLOTS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs text-ink4 mb-1 block">Duration</label>
                <select
                  value={apptDuration}
                  onChange={(e) => setApptDuration(Number(e.target.value))}
                  className="w-full text-sm border border-border-brand rounded-lg px-3 py-2"
                >
                  {[15, 30, 45, 60, 90, 120].map((d) => (
                    <option key={d} value={d}>
                      {d} min
                    </option>
                  ))}
                </select>
              </div>

              {calendars.length > 0 && (
                <div>
                  <label className="text-xs text-ink4 mb-1 block">Calendar</label>
                  <select
                    value={apptCalendarId}
                    onChange={(e) => setApptCalendarId(e.target.value)}
                    className="w-full text-sm border border-border-brand rounded-lg px-3 py-2"
                  >
                    {calendars.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="text-xs text-ink4 mb-1 block">
                  Notes <span className="text-ink4">(optional)</span>
                </label>
                <textarea
                  value={apptNotes}
                  onChange={(e) => setApptNotes(e.target.value)}
                  rows={2}
                  placeholder="Add notes..."
                  className="w-full text-sm border border-border-brand rounded-lg px-3 py-2 resize-none placeholder-gray-300"
                />
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => void submitBooking()}
                  disabled={bookingLoading || !apptDate || !apptTitle}
                  className="px-4 py-2 text-xs font-semibold text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors"
                >
                  {bookingLoading ? 'Booking...' : 'Book Appointment'}
                </button>
                <button
                  onClick={() => {
                    setBookingMode(false)
                    setBookingSuccess(null)
                  }}
                  className="px-4 py-2 text-xs text-ink3 hover:text-ink transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Contact + Company */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-border-brand p-4">
          <span className="text-[10px] font-medium text-ink4 uppercase">Contact</span>
          {deal.contact_id && deal.contact_name ? (
            <Link
              href={`/contacts/${deal.contact_id}`}
              className="block text-sm font-medium text-teal-600 hover:text-teal-700 mt-1"
            >
              {deal.contact_name}
            </Link>
          ) : (
            <p className="text-sm text-ink4 mt-1">{'—'}</p>
          )}
        </div>
        <div className="bg-white rounded-xl border border-border-brand p-4">
          <span className="text-[10px] font-medium text-ink4 uppercase">Company</span>
          {deal.company_id && deal.company_name ? (
            <Link
              href={`/companies/${deal.company_id}`}
              className="block text-sm font-medium text-teal-600 hover:text-teal-700 mt-1"
            >
              {deal.company_name}
            </Link>
          ) : (
            <p className="text-sm text-ink4 mt-1">{'—'}</p>
          )}
        </div>
      </div>

      {/* Deal Contacts (many-to-many) */}
      <div className="bg-white rounded-xl border border-border-brand p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-ink2">Contacts</h3>
          <span className="text-xs text-ink4">{dealContacts.length}/5</span>
        </div>

        {dealContacts.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-3">
            {dealContacts.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-1.5 px-2.5 py-1 bg-bg2 rounded-full text-xs"
              >
                <Link
                  href={`/contacts/${c.id}`}
                  className="font-medium text-teal-600 hover:text-teal-700"
                >
                  {c.full_name}
                </Link>
                {c.role && (
                  <span className="text-[10px] text-ink4 bg-white border border-border-brand rounded px-1 py-0.5">
                    {c.role}
                  </span>
                )}
                <button
                  onClick={() => void removeContact(c.id)}
                  className="text-ink4 hover:text-red-500 leading-none ml-0.5"
                  aria-label={`Remove ${c.full_name}`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {dealContacts.length < 5 && (
          <div className="relative">
            <input
              value={contactSearch}
              onChange={(e) => setContactSearch(e.target.value)}
              onBlur={() => setTimeout(() => setSearchResults([]), 150)}
              placeholder="Search contacts to add..."
              className="w-full text-sm border border-border-brand rounded px-3 py-1.5 placeholder-gray-300"
            />
            {filteredResults.length > 0 && (
              <div className="absolute top-full mt-1 w-full bg-white border border-border-brand rounded-lg shadow-lg z-10">
                {filteredResults.map((r) => (
                  <button
                    key={r.id}
                    onMouseDown={() => void addContact(r.id)}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-bg2 first:rounded-t-lg last:rounded-b-lg"
                  >
                    <span className="font-medium text-ink">{r.full_name}</span>
                    {r.email && <span className="text-ink4 ml-2 text-xs">{r.email}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="bg-white rounded-xl border border-border-brand p-5 mb-6">
        <h3 className="text-sm font-semibold text-ink2 mb-2">Notes</h3>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== (deal.notes ?? '')) void updateDeal({ notes })
          }}
          rows={3}
          placeholder="Add notes..."
          className="w-full text-sm border border-border-brand rounded-lg px-3 py-2 placeholder-gray-300 resize-none"
        />
      </div>

      {/* Activity */}
      {deal.contact_id && (
        <div className="bg-white rounded-xl border border-border-brand">
          <div className="px-4 py-3 border-b border-border-brand">
            <h3 className="text-sm font-semibold text-ink2">Activity</h3>
          </div>
          <ActivityTimeline contactId={deal.contact_id} />
        </div>
      )}
    </div>
  )
}
