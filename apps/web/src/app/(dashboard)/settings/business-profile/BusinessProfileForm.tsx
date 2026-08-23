'use client'

import { useState } from 'react'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Checkbox from '@mui/material/Checkbox'
import Switch from '@mui/material/Switch'
import IconButton from '@mui/material/IconButton'
import type { BusinessProfile, DayHours, ServiceEntry, StaffEntry, FaqEntry } from '@nuatis/shared'

// ── Local extended types with stable React keys ────────────────────────────
type ServiceRow = ServiceEntry & { _key: string }
type StaffRow = StaffEntry & { _key: string }
type FaqRow = FaqEntry & { _key: string }

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

// ── Standalone SectionMessage component ────────────────────────────────────
function SectionMessage({ message }: { message: SectionState['message'] }) {
  if (!message) return null
  return (
    <div
      className={`px-3 py-2 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}
    >
      {message.text}
    </div>
  )
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
  const [services, setServices] = useState<ServiceRow[]>(
    (initialProfile.services ?? []).map((s) => ({
      ...s,
      _key: Math.random().toString(36).slice(2),
    }))
  )
  const [staff, setStaff] = useState<StaffRow[]>(
    (initialProfile.staff ?? []).map((s) => ({ ...s, _key: Math.random().toString(36).slice(2) }))
  )
  const [faqs, setFaqs] = useState<FaqRow[]>(
    (initialProfile.faqs ?? []).map((f) => ({ ...f, _key: Math.random().toString(36).slice(2) }))
  )
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
      const current: BusinessProfile = {
        hours,
        services: services.map(({ _key: _, ...s }) => s),
        staff: staff.map(({ _key: _, ...s }) => s),
        faqs: faqs.map(({ _key: _, ...f }) => f),
        notes,
      }
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
      } else {
        setSectionMsg('services', { type: 'error', text: 'Failed to load catalog' })
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
        (s): ServiceRow => ({
          name: s.name,
          duration_min: s.duration_minutes ?? 0,
          price: s.unit_price,
          description: '',
          _key: Math.random().toString(36).slice(2),
        })
      )
    setServices((prev) => [...prev, ...toImport])
    setShowCatalogPicker(false)
    setSelectedCatalogIds(new Set())
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
                <Switch
                  checked={!day.closed}
                  onChange={(e) => updateDayHours(key, 'closed', !e.target.checked)}
                  size="small"
                  slotProps={{ input: { 'aria-label': `${label} open` } }}
                />
                {day.closed ? (
                  <span className="text-sm text-ink4">Closed</span>
                ) : (
                  <>
                    <TextField
                      select
                      value={day.open}
                      onChange={(e) => updateDayHours(key, 'open', e.target.value)}
                      size="small"
                    >
                      {TIME_SLOTS.map((t) => (
                        <MenuItem key={t} value={t}>
                          {formatTimeLabel(t)}
                        </MenuItem>
                      ))}
                    </TextField>
                    <span className="text-ink4 text-xs">to</span>
                    <TextField
                      select
                      value={day.close}
                      onChange={(e) => updateDayHours(key, 'close', e.target.value)}
                      size="small"
                    >
                      {TIME_SLOTS.map((t) => (
                        <MenuItem key={t} value={t}>
                          {formatTimeLabel(t)}
                        </MenuItem>
                      ))}
                    </TextField>
                  </>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex items-center gap-3 mt-5">
          <Button
            onClick={() => saveSection('hours', { hours })}
            disabled={sectionState.hours.saving}
            variant="contained"
          >
            {sectionState.hours.saving ? 'Saving…' : 'Save Hours'}
          </Button>
          <SectionMessage message={sectionState.hours.message} />
        </div>
      </div>

      {/* ── 2. Services ── */}
      <div className="bg-white rounded-xl border border-border-brand p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-ink">Services</h2>
          <Button onClick={loadCatalog} disabled={loadingCatalog} size="small" color="inherit">
            {loadingCatalog ? 'Loading…' : 'Import from Catalog'}
          </Button>
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
                    <Checkbox
                      checked={selectedCatalogIds.has(s.id)}
                      onChange={(e) => {
                        setSelectedCatalogIds((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(s.id)
                          else next.delete(s.id)
                          return next
                        })
                      }}
                      size="small"
                      sx={{ p: 0 }}
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
              <Button
                onClick={importSelected}
                disabled={selectedCatalogIds.size === 0}
                variant="contained"
                size="small"
              >
                Import Selected
              </Button>
              <Button onClick={() => setShowCatalogPicker(false)} size="small" color="inherit">
                Cancel
              </Button>
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
          {services.map((s) => (
            <div
              key={s._key}
              className="grid grid-cols-[1fr_80px_80px_1fr_auto] gap-2 items-center"
            >
              <TextField
                value={s.name}
                onChange={(e) =>
                  setServices((prev) =>
                    prev.map((row) =>
                      row._key === s._key ? { ...row, name: e.target.value } : row
                    )
                  )
                }
                placeholder="Service name"
                size="small"
              />
              <TextField
                type="number"
                value={s.duration_min || ''}
                onChange={(e) =>
                  setServices((prev) =>
                    prev.map((row) =>
                      row._key === s._key
                        ? { ...row, duration_min: parseInt(e.target.value) || 0 }
                        : row
                    )
                  )
                }
                placeholder="60"
                size="small"
              />
              <TextField
                type="number"
                value={s.price || ''}
                onChange={(e) =>
                  setServices((prev) =>
                    prev.map((row) =>
                      row._key === s._key ? { ...row, price: parseFloat(e.target.value) || 0 } : row
                    )
                  )
                }
                placeholder="0"
                size="small"
              />
              <TextField
                value={s.description}
                onChange={(e) =>
                  setServices((prev) =>
                    prev.map((row) =>
                      row._key === s._key ? { ...row, description: e.target.value } : row
                    )
                  )
                }
                placeholder="Optional description"
                size="small"
              />
              <IconButton
                onClick={() => setServices((prev) => prev.filter((row) => row._key !== s._key))}
                size="small"
                color="error"
                title="Remove"
              >
                ✕
              </IconButton>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 mt-4">
          <Button
            onClick={() =>
              setServices((prev) => [
                ...prev,
                {
                  name: '',
                  duration_min: 0,
                  price: 0,
                  description: '',
                  _key: Math.random().toString(36).slice(2),
                },
              ])
            }
            size="small"
            color="inherit"
          >
            + Add Service
          </Button>
        </div>

        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-border-brand">
          <Button
            onClick={() =>
              saveSection('services', { services: services.map(({ _key: _, ...s }) => s) })
            }
            disabled={sectionState.services.saving}
            variant="contained"
          >
            {sectionState.services.saving ? 'Saving…' : 'Save Services'}
          </Button>
          <SectionMessage message={sectionState.services.message} />
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
          {staff.map((s) => (
            <div key={s._key} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
              <TextField
                value={s.name}
                onChange={(e) =>
                  setStaff((prev) =>
                    prev.map((row) =>
                      row._key === s._key ? { ...row, name: e.target.value } : row
                    )
                  )
                }
                placeholder="Full name"
                size="small"
              />
              <TextField
                value={s.role}
                onChange={(e) =>
                  setStaff((prev) =>
                    prev.map((row) =>
                      row._key === s._key ? { ...row, role: e.target.value } : row
                    )
                  )
                }
                placeholder="Role (e.g. Stylist)"
                size="small"
              />
              <IconButton
                onClick={() => setStaff((prev) => prev.filter((row) => row._key !== s._key))}
                size="small"
                color="error"
                title="Remove"
              >
                ✕
              </IconButton>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 mt-4">
          <Button
            onClick={() =>
              setStaff((prev) => [
                ...prev,
                { name: '', role: '', _key: Math.random().toString(36).slice(2) },
              ])
            }
            size="small"
            color="inherit"
          >
            + Add Staff Member
          </Button>
        </div>

        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-border-brand">
          <Button
            onClick={() => saveSection('staff', { staff: staff.map(({ _key: _, ...s }) => s) })}
            disabled={sectionState.staff.saving}
            variant="contained"
          >
            {sectionState.staff.saving ? 'Saving…' : 'Save Staff'}
          </Button>
          <SectionMessage message={sectionState.staff.message} />
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
            <div key={faq._key} className="space-y-1.5 p-3 bg-bg rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-ink4">FAQ {i + 1}</span>
                <IconButton
                  onClick={() => setFaqs((prev) => prev.filter((row) => row._key !== faq._key))}
                  size="small"
                  color="error"
                  title="Remove"
                >
                  ✕
                </IconButton>
              </div>
              <TextField
                value={faq.question}
                onChange={(e) =>
                  setFaqs((prev) =>
                    prev.map((row) =>
                      row._key === faq._key ? { ...row, question: e.target.value } : row
                    )
                  )
                }
                placeholder="Question"
                fullWidth
                size="small"
              />
              <TextField
                value={faq.answer}
                onChange={(e) =>
                  setFaqs((prev) =>
                    prev.map((row) =>
                      row._key === faq._key ? { ...row, answer: e.target.value } : row
                    )
                  )
                }
                placeholder="Answer"
                multiline
                rows={2}
                fullWidth
                size="small"
              />
            </div>
          ))}
          {faqs.length < 10 && (
            <Button
              onClick={() =>
                setFaqs((prev) => [
                  ...prev,
                  { question: '', answer: '', _key: Math.random().toString(36).slice(2) },
                ])
              }
              size="small"
              color="inherit"
            >
              + Add FAQ
            </Button>
          )}
        </div>

        <div className="mt-4">
          <label
            htmlFor="business-profile-notes"
            className="block text-xs font-medium text-ink2 mb-1.5"
          >
            Additional Notes
          </label>
          <TextField
            id="business-profile-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any extra context Maya should know — parking info, special instructions, etc."
            multiline
            rows={4}
            slotProps={{ htmlInput: { maxLength: 2000 } }}
            fullWidth
            size="small"
          />
          <p className="text-[11px] text-ink4 mt-1">{notes.length}/2000 characters</p>
        </div>

        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-border-brand">
          <Button
            onClick={() => saveSection('faqs', { faqs: faqs.map(({ _key: _, ...f }) => f), notes })}
            disabled={sectionState.faqs.saving}
            variant="contained"
          >
            {sectionState.faqs.saving ? 'Saving…' : 'Save FAQs & Notes'}
          </Button>
          <SectionMessage message={sectionState.faqs.message} />
        </div>
      </div>
    </div>
  )
}
