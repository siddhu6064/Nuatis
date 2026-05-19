'use client'

import { useState } from 'react'
import type { BusinessProfile, DayHours, ServiceEntry, StaffEntry, FaqEntry } from '@nuatis/shared'

const DAYS: Array<{ key: keyof Required<BusinessProfile>['hours']; label: string }> = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' },
]

const DEFAULT_DAY_HOURS: DayHours = { open: '09:00', close: '17:00', closed: false }
const DEFAULT_HOURS: Required<BusinessProfile>['hours'] = {
  monday: { open: '09:00', close: '17:00', closed: false },
  tuesday: { open: '09:00', close: '17:00', closed: false },
  wednesday: { open: '09:00', close: '17:00', closed: false },
  thursday: { open: '09:00', close: '17:00', closed: false },
  friday: { open: '09:00', close: '17:00', closed: false },
  saturday: { open: '09:00', close: '17:00', closed: true },
  sunday: { open: '09:00', close: '17:00', closed: true },
}

const TIME_SLOTS: string[] = []
for (let h = 0; h <= 23; h++) {
  TIME_SLOTS.push(`${String(h).padStart(2, '0')}:00`)
  TIME_SLOTS.push(`${String(h).padStart(2, '0')}:30`)
}

function formatTimeLabel(t: string): string {
  const [hStr, mStr] = t.split(':')
  const h = parseInt(hStr ?? '0', 10)
  const m = mStr ?? '00'
  const period = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 || 12
  return `${h12}:${m} ${period}`
}

type Section = 'hours' | 'services' | 'staff' | 'faqs'

interface SectionState {
  saving: boolean
  message: { type: 'success' | 'error'; text: string } | null
}

interface CatalogService {
  id: string
  name: string
  unit_price: number
  duration_minutes: number | null
}

export default function BusinessProfileForm({
  initialProfile,
}: {
  initialProfile: BusinessProfile
}) {
  const [hours, setHours] = useState<Required<BusinessProfile>['hours']>(
    initialProfile.hours && Object.keys(initialProfile.hours).length > 0
      ? { ...DEFAULT_HOURS, ...initialProfile.hours }
      : DEFAULT_HOURS
  )
  const [services, setServices] = useState<ServiceEntry[]>(initialProfile.services ?? [])
  const [staff, setStaff] = useState<StaffEntry[]>(initialProfile.staff ?? [])
  const [faqs, setFaqs] = useState<FaqEntry[]>(initialProfile.faqs ?? [])
  const [notes, setNotes] = useState(initialProfile.notes ?? '')

  const [sectionState, setSectionState] = useState<Record<Section, SectionState>>({
    hours: { saving: false, message: null },
    services: { saving: false, message: null },
    staff: { saving: false, message: null },
    faqs: { saving: false, message: null },
  })

  const [catalogServices, setCatalogServices] = useState<CatalogService[] | null>(null)
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [showCatalogPicker, setShowCatalogPicker] = useState(false)
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<Set<string>>(new Set())

  function setSectionMsg(section: Section, msg: SectionState['message']) {
    setSectionState((prev) => ({ ...prev, [section]: { ...prev[section]!, message: msg } }))
  }

  function setSectionSaving(section: Section, saving: boolean) {
    setSectionState((prev) => ({ ...prev, [section]: { ...prev[section]!, saving } }))
  }

  async function saveSection(section: Section, patch: Partial<BusinessProfile>) {
    setSectionSaving(section, true)
    setSectionMsg(section, null)
    try {
      const current: BusinessProfile = { hours, services, staff, faqs, notes }
      const merged: BusinessProfile = { ...current, ...patch }
      const res = await fetch('/api/business-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_profile: merged }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        setSectionMsg(section, { type: 'error', text: data.error ?? 'Failed to save' })
        return
      }
      setSectionMsg(section, { type: 'success', text: 'Saved' })
    } catch {
      setSectionMsg(section, { type: 'error', text: 'Network error' })
    } finally {
      setSectionSaving(section, false)
    }
  }

  function updateDayHours(
    day: keyof Required<BusinessProfile>['hours'],
    field: keyof DayHours,
    value: string | boolean
  ) {
    setHours((prev) => ({
      ...prev,
      [day]: { ...(prev[day] ?? DEFAULT_DAY_HOURS), [field]: value },
    }))
  }

  async function loadCatalog() {
    if (catalogServices !== null) {
      setShowCatalogPicker(true)
      return
    }
    setLoadingCatalog(true)
    try {
      const res = await fetch('/api/business-profile/catalog-services')
      if (res.ok) {
        const data = (await res.json()) as { services: CatalogService[] }
        setCatalogServices(data.services)
        setShowCatalogPicker(true)
      }
    } finally {
      setLoadingCatalog(false)
    }
  }

  function importSelected() {
    if (!catalogServices) return
    const toImport = catalogServices
      .filter((s) => selectedCatalogIds.has(s.id))
      .map(
        (s): ServiceEntry => ({
          name: s.name,
          duration_min: s.duration_minutes ?? 0,
          price: s.unit_price,
          description: '',
        })
      )
    setServices((prev) => [...prev, ...toImport])
    setShowCatalogPicker(false)
    setSelectedCatalogIds(new Set())
  }

  const inputCls =
    'w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent'
  const smallInputCls =
    'px-3 py-1.5 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent'
  const saveBtnCls =
    'px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
  const addBtnCls =
    'px-3 py-1.5 text-sm border border-border-brand rounded-lg hover:bg-bg transition-colors text-ink2'
  const removeBtnCls = 'text-red-400 hover:text-red-600 text-sm px-2'

  function SectionMessage({ section }: { section: Section }) {
    const msg = sectionState[section].message
    if (!msg) return null
    return (
      <div
        className={`px-3 py-2 rounded-lg text-sm ${msg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}
      >
        {msg.text}
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* ── 1. Business Hours ── */}
      <div className="bg-white rounded-xl border border-border-brand p-6">
        <h2 className="text-sm font-semibold text-ink mb-1">Business Hours</h2>
        <p className="text-xs text-ink4 mb-4">
          Maya uses these hours to tell callers when you are open
        </p>

        <div className="space-y-2">
          {DAYS.map(({ key, label }) => {
            const day = hours[key] ?? DEFAULT_DAY_HOURS
            return (
              <div key={key} className="flex items-center gap-3">
                <span className="w-24 text-sm text-ink2 shrink-0">{label}</span>
                <button
                  type="button"
                  onClick={() => updateDayHours(key, 'closed', !day.closed)}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-1 ${
                    day.closed ? 'bg-bg3' : 'bg-teal-600'
                  }`}
                  title={day.closed ? 'Closed — click to open' : 'Open — click to close'}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      day.closed ? 'translate-x-1' : 'translate-x-4'
                    }`}
                  />
                </button>
                {day.closed ? (
                  <span className="text-sm text-ink4">Closed</span>
                ) : (
                  <>
                    <select
                      value={day.open}
                      onChange={(e) => updateDayHours(key, 'open', e.target.value)}
                      className={smallInputCls + ' bg-white'}
                    >
                      {TIME_SLOTS.map((t) => (
                        <option key={t} value={t}>
                          {formatTimeLabel(t)}
                        </option>
                      ))}
                    </select>
                    <span className="text-ink4 text-xs">to</span>
                    <select
                      value={day.close}
                      onChange={(e) => updateDayHours(key, 'close', e.target.value)}
                      className={smallInputCls + ' bg-white'}
                    >
                      {TIME_SLOTS.map((t) => (
                        <option key={t} value={t}>
                          {formatTimeLabel(t)}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex items-center gap-3 mt-5">
          <button
            onClick={() => saveSection('hours', { hours })}
            disabled={sectionState.hours.saving}
            className={saveBtnCls}
          >
            {sectionState.hours.saving ? 'Saving…' : 'Save Hours'}
          </button>
          <SectionMessage section="hours" />
        </div>
      </div>

      {/* ── 2. Services ── */}
      <div className="bg-white rounded-xl border border-border-brand p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-ink">Services</h2>
          <button onClick={loadCatalog} disabled={loadingCatalog} className={addBtnCls}>
            {loadingCatalog ? 'Loading…' : 'Import from Catalog'}
          </button>
        </div>
        <p className="text-xs text-ink4 mb-4">
          List your services so Maya can quote prices and durations
        </p>

        {showCatalogPicker && catalogServices && (
          <div className="mb-4 p-4 bg-bg rounded-xl border border-border-brand">
            <p className="text-sm font-medium text-ink mb-3">Select services to import</p>
            {catalogServices.length === 0 ? (
              <p className="text-sm text-ink4">No catalog services found.</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {catalogServices.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="text-teal-600 focus:ring-teal-500"
                      checked={selectedCatalogIds.has(s.id)}
                      onChange={(e) => {
                        setSelectedCatalogIds((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(s.id)
                          else next.delete(s.id)
                          return next
                        })
                      }}
                    />
                    <span className="text-sm text-ink">{s.name}</span>
                    <span className="text-xs text-ink4">
                      {s.duration_minutes ? `${s.duration_minutes} min` : ''}{' '}
                      {s.unit_price ? `$${s.unit_price}` : ''}
                    </span>
                  </label>
                ))}
              </div>
            )}
            <div className="flex gap-2 mt-3">
              <button
                onClick={importSelected}
                disabled={selectedCatalogIds.size === 0}
                className={saveBtnCls}
              >
                Import Selected
              </button>
              <button onClick={() => setShowCatalogPicker(false)} className={addBtnCls}>
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {services.length > 0 && (
            <div className="grid grid-cols-[1fr_80px_80px_1fr_auto] gap-2 text-xs font-medium text-ink4 pb-1 border-b border-border-brand">
              <span>Name</span>
              <span>Duration (min)</span>
              <span>Price ($)</span>
              <span>Description</span>
              <span />
            </div>
          )}
          {services.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_80px_80px_1fr_auto] gap-2 items-center">
              <input
                value={s.name}
                onChange={(e) =>
                  setServices((prev) =>
                    prev.map((row, j) => (j === i ? { ...row, name: e.target.value } : row))
                  )
                }
                placeholder="Service name"
                className={smallInputCls}
              />
              <input
                type="number"
                value={s.duration_min || ''}
                onChange={(e) =>
                  setServices((prev) =>
                    prev.map((row, j) =>
                      j === i ? { ...row, duration_min: parseInt(e.target.value) || 0 } : row
                    )
                  )
                }
                placeholder="60"
                className={smallInputCls}
              />
              <input
                type="number"
                value={s.price || ''}
                onChange={(e) =>
                  setServices((prev) =>
                    prev.map((row, j) =>
                      j === i ? { ...row, price: parseFloat(e.target.value) || 0 } : row
                    )
                  )
                }
                placeholder="0"
                className={smallInputCls}
              />
              <input
                value={s.description}
                onChange={(e) =>
                  setServices((prev) =>
                    prev.map((row, j) => (j === i ? { ...row, description: e.target.value } : row))
                  )
                }
                placeholder="Optional description"
                className={smallInputCls}
              />
              <button
                onClick={() => setServices((prev) => prev.filter((_, j) => j !== i))}
                className={removeBtnCls}
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={() =>
              setServices((prev) => [
                ...prev,
                { name: '', duration_min: 0, price: 0, description: '' },
              ])
            }
            className={addBtnCls}
          >
            + Add Service
          </button>
        </div>

        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-border-brand">
          <button
            onClick={() => saveSection('services', { services })}
            disabled={sectionState.services.saving}
            className={saveBtnCls}
          >
            {sectionState.services.saving ? 'Saving…' : 'Save Services'}
          </button>
          <SectionMessage section="services" />
        </div>
      </div>

      {/* ── 3. Staff ── */}
      <div className="bg-white rounded-xl border border-border-brand p-6">
        <h2 className="text-sm font-semibold text-ink mb-1">Staff</h2>
        <p className="text-xs text-ink4 mb-4">
          Let Maya introduce your team and direct callers to the right person
        </p>

        <div className="space-y-3">
          {staff.length > 0 && (
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-medium text-ink4 pb-1 border-b border-border-brand">
              <span>Name</span>
              <span>Role</span>
              <span />
            </div>
          )}
          {staff.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
              <input
                value={s.name}
                onChange={(e) =>
                  setStaff((prev) =>
                    prev.map((row, j) => (j === i ? { ...row, name: e.target.value } : row))
                  )
                }
                placeholder="Full name"
                className={smallInputCls}
              />
              <input
                value={s.role}
                onChange={(e) =>
                  setStaff((prev) =>
                    prev.map((row, j) => (j === i ? { ...row, role: e.target.value } : row))
                  )
                }
                placeholder="Role (e.g. Stylist)"
                className={smallInputCls}
              />
              <button
                onClick={() => setStaff((prev) => prev.filter((_, j) => j !== i))}
                className={removeBtnCls}
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={() => setStaff((prev) => [...prev, { name: '', role: '' }])}
            className={addBtnCls}
          >
            + Add Staff Member
          </button>
        </div>

        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-border-brand">
          <button
            onClick={() => saveSection('staff', { staff })}
            disabled={sectionState.staff.saving}
            className={saveBtnCls}
          >
            {sectionState.staff.saving ? 'Saving…' : 'Save Staff'}
          </button>
          <SectionMessage section="staff" />
        </div>
      </div>

      {/* ── 4. FAQs & Notes ── */}
      <div className="bg-white rounded-xl border border-border-brand p-6">
        <h2 className="text-sm font-semibold text-ink mb-1">FAQs &amp; Notes</h2>
        <p className="text-xs text-ink4 mb-4">
          Common questions Maya can answer. Notes are cited verbatim.
        </p>

        <div className="space-y-4">
          {faqs.map((faq, i) => (
            <div key={i} className="space-y-1.5 p-3 bg-bg rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-ink4">FAQ {i + 1}</span>
                <button
                  onClick={() => setFaqs((prev) => prev.filter((_, j) => j !== i))}
                  className={removeBtnCls}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
              <input
                value={faq.question}
                onChange={(e) =>
                  setFaqs((prev) =>
                    prev.map((row, j) => (j === i ? { ...row, question: e.target.value } : row))
                  )
                }
                placeholder="Question"
                className={inputCls}
              />
              <textarea
                value={faq.answer}
                onChange={(e) =>
                  setFaqs((prev) =>
                    prev.map((row, j) => (j === i ? { ...row, answer: e.target.value } : row))
                  )
                }
                placeholder="Answer"
                rows={2}
                className={inputCls + ' resize-none'}
              />
            </div>
          ))}
          {faqs.length < 10 && (
            <button
              onClick={() => setFaqs((prev) => [...prev, { question: '', answer: '' }])}
              className={addBtnCls}
            >
              + Add FAQ
            </button>
          )}
        </div>

        <div className="mt-4">
          <label className="block text-xs font-medium text-ink2 mb-1.5">Additional Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any extra context Maya should know — parking info, special instructions, etc."
            rows={4}
            maxLength={2000}
            className={inputCls + ' resize-none'}
          />
          <p className="text-[11px] text-ink4 mt-1">{notes.length}/2000 characters</p>
        </div>

        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-border-brand">
          <button
            onClick={() => saveSection('faqs', { faqs, notes })}
            disabled={sectionState.faqs.saving}
            className={saveBtnCls}
          >
            {sectionState.faqs.saving ? 'Saving…' : 'Save FAQs & Notes'}
          </button>
          <SectionMessage section="faqs" />
        </div>
      </div>
    </div>
  )
}
