'use client'

import { useState, useEffect } from 'react'

interface Resource {
  id: string
  name: string
  resource_type: string
  capacity: number
  color: string
  status: string
  notes: string | null
  location_id: string | null
}

interface AvailabilitySlot {
  resource_id: string
  start_time: string
  end_time: string
  contact_name?: string
}

interface Props {
  initialResources: Resource[]
  tenantId: string
}

const PRESET_COLORS = [
  '#007A6E',
  '#7C3AED',
  '#2563EB',
  '#16A34A',
  '#CA8A04',
  '#EA580C',
  '#DC2626',
  '#6B7280',
]

const TYPE_CLASSES: Record<string, string> = {
  room: 'bg-teal-50 text-teal-700',
  station: 'bg-purple-50 text-purple-700',
  equipment: 'bg-blue-50 text-blue-700',
  vehicle: 'bg-yellow-50 text-yellow-700',
  other: 'bg-gray-100 text-ink4',
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? ''

// Hours 8am–6pm in 30-min slots = 20 slots
const HOUR_LABELS = Array.from({ length: 10 }, (_, i) => {
  const hour = 8 + i
  return hour < 12 ? `${hour}am` : hour === 12 ? '12pm' : `${hour - 12}pm`
})

export default function ResourcesClient({ initialResources, tenantId }: Props) {
  const [resources, setResources] = useState<Resource[]>(initialResources)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Add form state
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState('room')
  const [newColor, setNewColor] = useState(PRESET_COLORS[0]!)
  const [newNotes, setNewNotes] = useState('')
  const [newCapacity] = useState(1)

  // Edit form state
  const [editName, setEditName] = useState('')
  const [editType, setEditType] = useState('room')
  const [editColor, setEditColor] = useState(PRESET_COLORS[0]!)

  // Calendar state
  const today = new Date().toISOString().slice(0, 10)
  const [calDate, setCalDate] = useState(today)
  const [slots, setSlots] = useState<AvailabilitySlot[]>([])
  const [loadingCal, setLoadingCal] = useState(false)

  const activeResources = resources.filter((r) => r.status === 'active')

  useEffect(() => {
    if (activeResources.length === 0) return
    void fetchAvailability(calDate)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calDate, resources])

  async function fetchAvailability(date: string) {
    if (activeResources.length === 0) return
    setLoadingCal(true)
    try {
      const ids = activeResources.map((r) => r.id).join(',')
      const res = await fetch(
        `${API_URL}/api/resources/availability?date=${date}&resource_ids=${ids}`,
        { credentials: 'include' }
      )
      if (res.ok) {
        const data = (await res.json()) as { slots?: AvailabilitySlot[] }
        setSlots(data.slots ?? [])
      }
    } catch {
      // silently fail — calendar is best-effort
    } finally {
      setLoadingCal(false)
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/resources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          resource_type: newType,
          color: newColor,
          notes: newNotes.trim() || null,
          capacity: newCapacity,
        }),
        credentials: 'include',
      })
      const data = (await res.json()) as Resource & { error?: string }
      if (!res.ok) {
        setError(data.error ?? 'Failed to create resource')
        return
      }
      setResources((prev) => [data, ...prev])
      setShowAddForm(false)
      setNewName('')
      setNewType('room')
      setNewColor(PRESET_COLORS[0]!)
      setNewNotes('')
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this resource?')) return
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/resources/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (res.ok) {
        setResources((prev) => prev.filter((r) => r.id !== id))
      } else {
        const d = (await res.json()) as { error?: string }
        setError(d.error ?? 'Failed to delete')
      }
    } catch {
      setError('Network error')
    }
  }

  async function handleMaintenance(id: string) {
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/resources/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'maintenance' }),
        credentials: 'include',
      })
      if (res.ok) {
        setResources((prev) => prev.map((r) => (r.id === id ? { ...r, status: 'maintenance' } : r)))
      } else {
        const d = (await res.json()) as { error?: string }
        setError(d.error ?? 'Failed to update status')
      }
    } catch {
      setError('Network error')
    }
  }

  function startEdit(r: Resource) {
    setEditingId(r.id)
    setEditName(r.name)
    setEditType(r.resource_type)
    setEditColor(r.color)
  }

  async function handleSaveEdit(id: string) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/resources/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), resource_type: editType, color: editColor }),
        credentials: 'include',
      })
      const data = (await res.json()) as Resource & { error?: string }
      if (res.ok) {
        setResources((prev) =>
          prev.map((r) =>
            r.id === id ? { ...r, name: editName.trim(), resource_type: editType, color: editColor } : r
          )
        )
        setEditingId(null)
      } else {
        setError(data.error ?? 'Failed to save')
      }
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  // Compute booked cells for a resource row: returns Set of slot indices (0-19) that are booked
  function getBookedCells(resourceId: string): Map<number, AvailabilitySlot> {
    const map = new Map<number, AvailabilitySlot>()
    for (const slot of slots) {
      if (slot.resource_id !== resourceId) continue
      const start = new Date(slot.start_time)
      const end = new Date(slot.end_time)
      const startMin = start.getHours() * 60 + start.getMinutes()
      const endMin = end.getHours() * 60 + end.getMinutes()
      const startSlot = Math.floor((startMin - 480) / 30)
      const endSlot = Math.ceil((endMin - 480) / 30)
      for (let i = Math.max(0, startSlot); i < Math.min(20, endSlot); i++) {
        map.set(i, slot)
      }
    }
    return map
  }

  return (
    <div className="max-w-4xl space-y-8">
      {/* ── Resource List ── */}
      <div className="bg-white rounded-xl border border-border-brand">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-brand">
          <h2 className="text-sm font-semibold text-ink">Resources</h2>
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="px-3 py-1.5 text-sm border border-border-brand rounded-lg hover:bg-bg transition-colors text-ink2"
          >
            Add Resource
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-4 px-3 py-2 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>
        )}

        {/* Add form */}
        {showAddForm && (
          <form
            onSubmit={handleCreate}
            className="bg-white rounded-xl border border-border-brand p-4 mb-4 space-y-3 mx-6 mt-4"
          >
            <h3 className="text-sm font-semibold text-ink">New Resource</h3>
            <input
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Treatment Room 1"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-1 focus:ring-teal-400"
            >
              <option value="room">Room</option>
              <option value="station">Station</option>
              <option value="equipment">Equipment</option>
              <option value="vehicle">Vehicle</option>
              <option value="other">Other</option>
            </select>
            <div className="flex gap-2 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  type="button"
                  key={c}
                  onClick={() => setNewColor(c)}
                  className={`w-6 h-6 rounded-full border-2 ${newColor === c ? 'border-teal-600' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
            <textarea
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              placeholder="Notes (optional)"
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full resize-none h-16 focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-700 disabled:opacity-40"
              >
                {saving ? 'Saving...' : 'Add Resource'}
              </button>
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-4 py-2 bg-gray-100 text-ink3 rounded-lg text-sm font-medium hover:bg-gray-200"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Resources table */}
        {resources.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-ink4">No resources added yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-brand">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-ink3">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ink3">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ink3">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-ink3">Color</th>
                  <th className="text-right px-6 py-3 text-xs font-semibold text-ink3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-brand">
                {resources.map((r) =>
                  editingId === r.id ? (
                    /* Inline edit row */
                    <tr key={r.id} className="bg-bg">
                      <td className="px-6 py-3">
                        <input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="border border-gray-200 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-teal-400"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={editType}
                          onChange={(e) => setEditType(e.target.value)}
                          className="border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none"
                        >
                          <option value="room">Room</option>
                          <option value="station">Station</option>
                          <option value="equipment">Equipment</option>
                          <option value="vehicle">Vehicle</option>
                          <option value="other">Other</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 text-ink3 text-xs">{r.status}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5 flex-wrap">
                          {PRESET_COLORS.map((c) => (
                            <button
                              type="button"
                              key={c}
                              onClick={() => setEditColor(c)}
                              className={`w-5 h-5 rounded-full border-2 ${editColor === c ? 'border-teal-600' : 'border-transparent'}`}
                              style={{ backgroundColor: c }}
                            />
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-3 text-right">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            type="button"
                            onClick={() => void handleSaveEdit(r.id)}
                            disabled={saving}
                            className="text-xs text-teal-600 hover:underline disabled:opacity-50"
                          >
                            {saving ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="text-xs text-ink4 hover:underline"
                          >
                            Cancel
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    /* Normal display row */
                    <tr key={r.id} className="hover:bg-bg/50">
                      <td className="px-6 py-3 font-medium text-ink">{r.name}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full capitalize ${TYPE_CLASSES[r.resource_type] ?? TYPE_CLASSES['other']}`}
                        >
                          {r.resource_type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {r.status === 'active' ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700">
                            Active
                          </span>
                        ) : r.status === 'maintenance' ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
                            Maintenance
                          </span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-ink4 capitalize">
                            {r.status}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div
                          className="w-5 h-5 rounded-full"
                          style={{ backgroundColor: r.color }}
                        />
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex items-center justify-end gap-3">
                          <button
                            type="button"
                            onClick={() => startEdit(r)}
                            className="text-xs text-ink4 hover:text-ink transition-colors"
                          >
                            Edit
                          </button>
                          {r.status !== 'maintenance' && (
                            <button
                              type="button"
                              onClick={() => void handleMaintenance(r.id)}
                              className="text-xs text-ink4 hover:text-amber-600 transition-colors"
                            >
                              Maintenance
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleDelete(r.id)}
                            className="text-xs text-ink4 hover:text-red-500 transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Today's Resource Calendar ── */}
      <div className="bg-white rounded-xl border border-border-brand">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-brand">
          <h2 className="text-sm font-semibold text-ink">Resource Calendar</h2>
          <div className="flex items-center gap-2">
            {loadingCal && <span className="text-xs text-ink4">Loading...</span>}
            <input
              type="date"
              value={calDate}
              onChange={(e) => setCalDate(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-teal-400"
            />
          </div>
        </div>

        {activeResources.length === 0 ? (
          <div className="px-6 py-8 text-center text-sm text-ink4">
            No active resources to display.
          </div>
        ) : (
          <div className="px-4 py-4 overflow-x-auto">
            {/* Hour header */}
            <div
              className="grid mb-1"
              style={{ gridTemplateColumns: '120px repeat(20, 1fr)', minWidth: '640px' }}
            >
              <div />
              {HOUR_LABELS.map((label, i) => (
                <div
                  key={i}
                  className="text-[10px] text-ink4 text-center"
                  style={{ gridColumn: `span 2` }}
                >
                  {label}
                </div>
              ))}
            </div>

            {/* Resource rows */}
            {activeResources.map((r) => {
              const bookedMap = getBookedCells(r.id)
              return (
                <div
                  key={r.id}
                  className="grid border-t border-border-brand"
                  style={{ gridTemplateColumns: '120px repeat(20, 1fr)', minWidth: '640px' }}
                >
                  {/* Resource name */}
                  <div className="text-xs text-ink3 py-2 pr-3 text-right self-center truncate">
                    {r.name}
                  </div>

                  {/* 20 time slots */}
                  {Array.from({ length: 20 }, (_, i) => {
                    const slot = bookedMap.get(i)
                    const isBooked = Boolean(slot)
                    return (
                      <div
                        key={i}
                        title={
                          isBooked
                            ? `${slot?.contact_name ?? 'Booked'} ${new Date(slot!.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–${new Date(slot!.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                            : undefined
                        }
                        className={`h-8 border-l border-border-brand text-[9px] truncate flex items-center justify-center ${
                          isBooked ? 'text-white' : 'hover:bg-gray-50'
                        }`}
                        style={isBooked ? { backgroundColor: r.color } : undefined}
                      >
                        {isBooked && i === Math.min(...[...bookedMap.keys()].filter((k) => bookedMap.get(k) === slot))
                          ? (slot?.contact_name ?? '').slice(0, 8)
                          : null}
                      </div>
                    )
                  })}
                </div>
              )
            })}

            <p className="text-[10px] text-ink4 mt-3">
              Hours 8am – 6pm in 30-minute slots. Booked slots shown in resource color.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
