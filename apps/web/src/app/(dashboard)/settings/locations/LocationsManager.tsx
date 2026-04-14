'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface LocationItem {
  id: string
  name: string | null
  address: string | null
  city: string | null
  state: string | null
  telnyx_number: string | null
  maya_enabled: boolean
  is_primary: boolean
  calendar_connected: boolean
}

export default function LocationsManager({
  initialLocations,
}: {
  initialLocations: LocationItem[]
}) {
  const router = useRouter()
  const [locations] = useState(initialLocations)
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [saving, setSaving] = useState(false)

  async function addLocation() {
    if (!newName.trim()) return
    setSaving(true)
    try {
      await fetch('/api/locations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName, address: newAddress || null }),
      })
      setAdding(false)
      setNewName('')
      setNewAddress('')
      router.refresh()
    } catch {
      // ignore
    } finally {
      setSaving(false)
    }
  }

  async function setPrimary(id: string) {
    await fetch(`/api/locations/${id}/set-primary`, { method: 'PUT' })
    router.refresh()
  }

  async function deleteLocation(id: string) {
    if (!confirm('Delete this location?')) return
    await fetch(`/api/locations/${id}`, { method: 'DELETE' })
    router.refresh()
  }

  return (
    <div className="max-w-2xl space-y-4">
      {locations.map((loc) => (
        <div
          key={loc.id}
          className={`bg-white rounded-xl border p-5 ${loc.is_primary ? 'border-teal-200' : 'border-gray-100'}`}
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-900">
                  {loc.name || 'Unnamed Location'}
                </h3>
                {loc.is_primary && (
                  <span className="text-[10px] bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded font-medium">
                    PRIMARY
                  </span>
                )}
              </div>
              {loc.address && (
                <p className="text-xs text-gray-400 mt-0.5">
                  {[loc.address, loc.city, loc.state].filter(Boolean).join(', ')}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!loc.is_primary && (
                <>
                  <button
                    onClick={() => setPrimary(loc.id)}
                    className="text-[10px] text-teal-600 hover:text-teal-700 font-medium"
                  >
                    Set Primary
                  </button>
                  <button
                    onClick={() => deleteLocation(loc.id)}
                    className="text-[10px] text-red-400 hover:text-red-600"
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
            <span>Phone: {loc.telnyx_number || '—'}</span>
            <span>Maya: {loc.maya_enabled ? '✓ Enabled' : '✗ Disabled'}</span>
            <span>Calendar: {loc.calendar_connected ? '✓ Connected' : '✗ Not connected'}</span>
          </div>
        </div>
      ))}

      {adding ? (
        <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Location name"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
            autoFocus
          />
          <input
            type="text"
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            placeholder="Address (optional)"
            className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
          />
          <div className="flex gap-2">
            <button
              onClick={addLocation}
              disabled={saving || !newName.trim()}
              className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50"
            >
              {saving ? 'Adding...' : 'Add Location'}
            </button>
            <button
              onClick={() => setAdding(false)}
              className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-400 hover:border-teal-300 hover:text-teal-600 transition-colors"
        >
          + Add Location
        </button>
      )}
    </div>
  )
}
