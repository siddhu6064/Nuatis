'use client'

import { useState, useEffect } from 'react'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import Radio from '@mui/material/Radio'
import Alert from '@mui/material/Alert'

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

// ── Icons (inline SVG — matches this app's existing icon convention; no
// @mui/icons-material dependency in this repo) ──────────────────────────────

function ChevronUpIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 15l-6-6-6 6" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
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
        <Button
          onClick={() => void handleNewGroup()}
          variant="contained"
          sx={{ textTransform: 'none' }}
        >
          + New Group
        </Button>
      </div>

      {message && (
        <Alert severity={message.type === 'success' ? 'success' : 'error'} sx={{ mb: 2 }}>
          {message.text}
        </Alert>
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
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleDeleteGroup(g.id)
                  }}
                  title="Delete group"
                  sx={{ color: 'text.disabled', '&:hover': { color: '#ef4444' } }}
                >
                  <CloseIcon />
                </IconButton>
              </div>
            ))}
          </div>

          {/* Right panel — editor */}
          {selectedGroup ? (
            <div className="flex-1 bg-white rounded-xl border border-border-brand p-6 space-y-5">
              {/* Name */}
              <TextField
                label="Group Name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                size="small"
                fullWidth
              />

              {/* Description */}
              <TextField
                label="Description (optional)"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="e.g. Sales team east coast"
                size="small"
                fullWidth
              />

              {/* Assignment mode */}
              <div>
                <label className="block text-xs font-medium text-ink2 mb-2">Assignment Mode</label>
                <div className="space-y-2">
                  <label
                    className={`flex items-start gap-1 px-2 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                      editMode === 'round_robin'
                        ? 'border-teal-500 bg-teal-50'
                        : 'border-border-brand hover:bg-bg'
                    }`}
                  >
                    <Radio
                      size="small"
                      checked={editMode === 'round_robin'}
                      onChange={() => setEditMode('round_robin')}
                      sx={{ mt: 0.25 }}
                    />
                    <div>
                      <p className="text-sm font-medium text-ink">Round Robin</p>
                      <p className="text-xs text-ink4">
                        Strict rotation — each calendar takes a turn in order
                      </p>
                    </div>
                  </label>
                  <label
                    className={`flex items-start gap-1 px-2 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                      editMode === 'load_balanced'
                        ? 'border-teal-500 bg-teal-50'
                        : 'border-border-brand hover:bg-bg'
                    }`}
                  >
                    <Radio
                      size="small"
                      checked={editMode === 'load_balanced'}
                      onChange={() => setEditMode('load_balanced')}
                      sx={{ mt: 0.25 }}
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
                      <IconButton
                        size="small"
                        onClick={() => moveUp(i)}
                        disabled={i === 0}
                        title="Move up"
                      >
                        <ChevronUpIcon />
                      </IconButton>
                      <IconButton
                        size="small"
                        onClick={() => moveDown(i)}
                        disabled={i === editMembers.length - 1}
                        title="Move down"
                      >
                        <ChevronDownIcon />
                      </IconButton>

                      {/* Remove */}
                      <IconButton
                        size="small"
                        onClick={() => void handleRemoveMember(m.location_id)}
                        title="Remove"
                        sx={{ color: 'text.disabled', '&:hover': { color: '#ef4444' } }}
                      >
                        <CloseIcon />
                      </IconButton>
                    </div>
                  ))}
                </div>

                {/* Add calendar */}
                {availableLocations.length > 0 && (
                  <div className="flex gap-2">
                    <Select
                      value={addLocationId}
                      onChange={(e) => setAddLocationId(e.target.value)}
                      size="small"
                      displayEmpty
                      fullWidth
                    >
                      <MenuItem value="">Add a calendar…</MenuItem>
                      {availableLocations.map((l) => (
                        <MenuItem key={l.id} value={l.id}>
                          {l.name}
                        </MenuItem>
                      ))}
                    </Select>
                    <Button
                      onClick={() => void handleAddMember()}
                      disabled={!addLocationId || addingMember}
                      variant="contained"
                      sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
                    >
                      {addingMember ? '…' : 'Add'}
                    </Button>
                  </div>
                )}
              </div>

              {/* Save */}
              <div className="flex items-center gap-3 pt-2 border-t border-border-brand">
                <Button
                  onClick={() => void handleSave()}
                  disabled={saving}
                  variant="contained"
                  sx={{ textTransform: 'none' }}
                >
                  {saving ? 'Saving…' : 'Save Changes'}
                </Button>
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
