'use client'

import { useState, useEffect } from 'react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface Member {
  location_id: string
  position: number
  location_name: string
}

interface CalendarGroup {
  id: string
  name: string
  description: string | null
  assignment_mode: 'round_robin' | 'load_balanced'
  member_count: number
  members: Member[]
}

interface Location {
  id: string
  name: string
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CalendarGroupsPage() {
  const [groups, setGroups] = useState<CalendarGroup[]>([])
  const [locations, setLocations] = useState<Location[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Editor state
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editMode, setEditMode] = useState<'round_robin' | 'load_balanced'>('round_robin')
  const [editMembers, setEditMembers] = useState<Member[]>([])

  // Action state
  const [saving, setSaving] = useState(false)
  const [addingMember, setAddingMember] = useState(false)
  const [addLocationId, setAddLocationId] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  function showMessage(type: 'success' | 'error', text: string) {
    setMessage({ type, text })
    setTimeout(() => setMessage(null), 3000)
  }

  async function fetchGroups() {
    const res = await fetch('/api/calendar-groups')
    if (res.ok) {
      const d: { groups: CalendarGroup[] } = await res.json()
      setGroups(d.groups)
    }
  }

  useEffect(() => {
    async function init() {
      setLoading(true)
      const [groupsRes, locsRes] = await Promise.all([
        fetch('/api/calendar-groups'),
        fetch('/api/locations'),
      ])
      if (groupsRes.ok) {
        const d: { groups: CalendarGroup[] } = await groupsRes.json()
        setGroups(d.groups)
      }
      if (locsRes.ok) {
        const d: { locations: Location[] } = await locsRes.json()
        setLocations(d.locations)
      }
      setLoading(false)
    }
    void init()
  }, [])

  function selectGroup(group: CalendarGroup) {
    setSelectedId(group.id)
    setEditName(group.name)
    setEditDescription(group.description ?? '')
    setEditMode(group.assignment_mode)
    setEditMembers([...group.members])
    setAddLocationId('')
    setMessage(null)
  }

  async function handleNewGroup() {
    const res = await fetch('/api/calendar-groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'New Group', assignment_mode: 'round_robin' }),
    })
    if (!res.ok) {
      showMessage('error', 'Failed to create group')
      return
    }
    const created: CalendarGroup & { members?: Member[] } = await res.json()
    const newGroup: CalendarGroup = { ...created, member_count: 0, members: [] }
    setGroups((prev) => [...prev, newGroup])
    selectGroup(newGroup)
  }

  async function handleDeleteGroup(id: string) {
    const res = await fetch(`/api/calendar-groups/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      showMessage('error', 'Failed to delete group')
      return
    }
    setGroups((prev) => prev.filter((g) => g.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  async function handleSave() {
    if (!selectedId) return
    setSaving(true)
    try {
      const [patchRes, orderRes] = await Promise.all([
        fetch(`/api/calendar-groups/${selectedId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: editName.trim() || 'Unnamed Group',
            description: editDescription.trim() || null,
            assignment_mode: editMode,
          }),
        }),
        fetch(`/api/calendar-groups/${selectedId}/members/order`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order: editMembers.map((m) => m.location_id) }),
        }),
      ])

      if (!patchRes.ok || !orderRes.ok) {
        showMessage('error', 'Failed to save changes')
        return
      }

      await fetchGroups()
      showMessage('success', 'Saved')
    } catch {
      showMessage('error', 'Failed to save changes')
    } finally {
      setSaving(false)
    }
  }

  async function handleAddMember() {
    if (!selectedId || !addLocationId) return
    setAddingMember(true)
    try {
      const res = await fetch(`/api/calendar-groups/${selectedId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId: addLocationId }),
      })
      if (res.status === 409) {
        showMessage('error', 'Already in this group')
        return
      }
      if (!res.ok) {
        showMessage('error', 'Failed to add member')
        return
      }

      const loc = locations.find((l) => l.id === addLocationId)
      const newMember: Member = {
        location_id: addLocationId,
        position: editMembers.length,
        location_name: loc?.name ?? '',
      }
      setEditMembers((prev) => [...prev, newMember])
      setAddLocationId('')
      await fetchGroups()
    } catch {
      showMessage('error', 'Failed to add member')
    } finally {
      setAddingMember(false)
    }
  }

  async function handleRemoveMember(locationId: string) {
    if (!selectedId) return
    const res = await fetch(`/api/calendar-groups/${selectedId}/members/${locationId}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      showMessage('error', 'Failed to remove member')
      return
    }
    setEditMembers((prev) => prev.filter((m) => m.location_id !== locationId))
    await fetchGroups()
  }

  function moveUp(index: number) {
    if (index === 0) return
    setEditMembers((prev) => {
      const next = [...prev]
      const tmp = next[index - 1]!
      next[index - 1] = next[index]!
      next[index] = tmp
      return next.map((m, i) => ({ ...m, position: i }))
    })
  }

  function moveDown(index: number) {
    setEditMembers((prev) => {
      if (index >= prev.length - 1) return prev
      const next = [...prev]
      const tmp = next[index + 1]!
      next[index + 1] = next[index]!
      next[index] = tmp
      return next.map((m, i) => ({ ...m, position: i }))
    })
  }

  const selectedGroup = groups.find((g) => g.id === selectedId) ?? null
  const availableLocations = locations.filter(
    (l) => !editMembers.some((m) => m.location_id === l.id)
  )

  return (
    <div className="px-8 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">Calendar Groups</h1>
          <p className="text-sm text-ink3 mt-0.5">
            Group calendars for round-robin or load-balanced booking
          </p>
        </div>
        <button
          onClick={handleNewGroup}
          className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
        >
          + New Group
        </button>
      </div>

      {message && (
        <div
          className={`mb-4 px-4 py-2 rounded-lg text-sm ${
            message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'
          }`}
        >
          {message.text}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink4">Loading…</p>
      ) : (
        <div className="flex gap-6 min-h-[500px]">
          {/* Left panel — group list */}
          <div className="w-[280px] shrink-0 space-y-1">
            {groups.length === 0 && (
              <p className="text-sm text-ink4 px-3 py-4">
                No groups yet. Click &quot;+ New Group&quot; to create one.
              </p>
            )}
            {groups.map((g) => (
              <div
                key={g.id}
                onClick={() => selectGroup(g)}
                className={`flex items-center justify-between px-3 py-3 rounded-lg cursor-pointer transition-colors ${
                  selectedId === g.id
                    ? 'bg-teal-50 border border-teal-200'
                    : 'hover:bg-bg2 border border-transparent'
                }`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink truncate">{g.name}</p>
                  <p className="text-xs text-ink4">
                    {g.member_count} {g.member_count === 1 ? 'calendar' : 'calendars'} ·{' '}
                    {g.assignment_mode === 'round_robin' ? 'Round robin' : 'Load balanced'}
                  </p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleDeleteGroup(g.id)
                  }}
                  className="ml-2 text-ink4 hover:text-red-500 transition-colors shrink-0 text-base leading-none"
                  title="Delete group"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          {/* Right panel — editor */}
          {selectedGroup ? (
            <div className="flex-1 bg-white rounded-xl border border-border-brand p-6 space-y-5">
              {/* Name */}
              <div>
                <label className="block text-xs font-medium text-ink2 mb-1.5">Group Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-medium text-ink2 mb-1.5">
                  Description (optional)
                </label>
                <input
                  type="text"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="e.g. Sales team east coast"
                  className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent placeholder:text-gray-300"
                />
              </div>

              {/* Assignment mode */}
              <div>
                <label className="block text-xs font-medium text-ink2 mb-2">Assignment Mode</label>
                <div className="space-y-2">
                  <label
                    className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                      editMode === 'round_robin'
                        ? 'border-teal-500 bg-teal-50'
                        : 'border-border-brand hover:bg-bg'
                    }`}
                  >
                    <input
                      type="radio"
                      name="assignment_mode"
                      value="round_robin"
                      checked={editMode === 'round_robin'}
                      onChange={() => setEditMode('round_robin')}
                      className="mt-0.5 text-teal-600 focus:ring-teal-500"
                    />
                    <div>
                      <p className="text-sm font-medium text-ink">Round Robin</p>
                      <p className="text-xs text-ink4">
                        Strict rotation — each calendar takes a turn in order
                      </p>
                    </div>
                  </label>
                  <label
                    className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                      editMode === 'load_balanced'
                        ? 'border-teal-500 bg-teal-50'
                        : 'border-border-brand hover:bg-bg'
                    }`}
                  >
                    <input
                      type="radio"
                      name="assignment_mode"
                      value="load_balanced"
                      checked={editMode === 'load_balanced'}
                      onChange={() => setEditMode('load_balanced')}
                      className="mt-0.5 text-teal-600 focus:ring-teal-500"
                    />
                    <div>
                      <p className="text-sm font-medium text-ink">Load Balanced</p>
                      <p className="text-xs text-ink4">
                        Fewest bookings in the next 7 days wins each assignment
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Members */}
              <div>
                <label className="block text-xs font-medium text-ink2 mb-2">
                  Members ({editMembers.length})
                </label>

                {editMembers.length === 0 && (
                  <p className="text-xs text-ink4 py-2">No calendars added yet.</p>
                )}

                <div className="space-y-1 mb-3">
                  {editMembers.map((m, i) => (
                    <div
                      key={m.location_id}
                      className="flex items-center gap-2 px-3 py-2 bg-bg rounded-lg"
                    >
                      {/* Position badge */}
                      <span className="w-5 h-5 rounded-full bg-teal-100 text-teal-700 text-[10px] font-bold flex items-center justify-center shrink-0">
                        {i + 1}
                      </span>

                      {/* Initial avatar */}
                      <span className="w-6 h-6 rounded-full bg-bg3 text-ink3 text-[10px] font-semibold flex items-center justify-center shrink-0">
                        {m.location_name.charAt(0).toUpperCase()}
                      </span>

                      <span className="flex-1 text-sm text-ink truncate">{m.location_name}</span>

                      {/* Up / Down */}
                      <button
                        onClick={() => moveUp(i)}
                        disabled={i === 0}
                        className="text-ink4 hover:text-ink2 disabled:opacity-30 text-xs px-1"
                        title="Move up"
                      >
                        ▲
                      </button>
                      <button
                        onClick={() => moveDown(i)}
                        disabled={i === editMembers.length - 1}
                        className="text-ink4 hover:text-ink2 disabled:opacity-30 text-xs px-1"
                        title="Move down"
                      >
                        ▼
                      </button>

                      {/* Remove */}
                      <button
                        onClick={() => void handleRemoveMember(m.location_id)}
                        className="text-ink4 hover:text-red-500 transition-colors text-base leading-none ml-1"
                        title="Remove"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add calendar */}
                {availableLocations.length > 0 && (
                  <div className="flex gap-2">
                    <select
                      value={addLocationId}
                      onChange={(e) => setAddLocationId(e.target.value)}
                      className="flex-1 px-3 py-2 text-sm border border-border-brand rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent text-ink2"
                    >
                      <option value="">Add a calendar…</option>
                      {availableLocations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => void handleAddMember()}
                      disabled={!addLocationId || addingMember}
                      className="px-3 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {addingMember ? '…' : 'Add'}
                    </button>
                  </div>
                )}
              </div>

              {/* Save */}
              <div className="flex items-center gap-3 pt-2 border-t border-border-brand">
                <button
                  onClick={() => void handleSave()}
                  disabled={saving}
                  className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-ink4">
              Select a group to edit
            </div>
          )}
        </div>
      )}
    </div>
  )
}
