'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'

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
  const locations = initialLocations
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
          className={`bg-white rounded-xl border p-5 ${loc.is_primary ? 'border-teal-200' : 'border-border-brand'}`}
        >
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-ink">{loc.name || 'Unnamed Location'}</h3>
                {loc.is_primary && (
                  <span className="text-[10px] bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded font-medium">
                    PRIMARY
                  </span>
                )}
              </div>
              {loc.address && (
                <p className="text-xs text-ink4 mt-0.5">
                  {[loc.address, loc.city, loc.state].filter(Boolean).join(', ')}
                </p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!loc.is_primary && (
                <>
                  <Button
                    onClick={() => setPrimary(loc.id)}
                    size="small"
                    color="inherit"
                    sx={{ fontSize: 10 }}
                  >
                    Set Primary
                  </Button>
                  <Button
                    onClick={() => deleteLocation(loc.id)}
                    size="small"
                    color="error"
                    sx={{ fontSize: 10 }}
                  >
                    Delete
                  </Button>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs text-ink3">
            <span>Phone: {loc.telnyx_number || '—'}</span>
            <span>Maya: {loc.maya_enabled ? '✓ Enabled' : '✗ Disabled'}</span>
            <span>Calendar: {loc.calendar_connected ? '✓ Connected' : '✗ Not connected'}</span>
          </div>
        </div>
      ))}

      {adding ? (
        <div className="bg-white rounded-xl border border-border-brand p-5 space-y-3">
          <TextField
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Location name"
            autoFocus
            fullWidth
            size="small"
          />
          <TextField
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            placeholder="Address (optional)"
            fullWidth
            size="small"
          />
          <div className="flex gap-2">
            <Button onClick={addLocation} disabled={saving || !newName.trim()} variant="contained">
              {saving ? 'Adding...' : 'Add Location'}
            </Button>
            <Button onClick={() => setAdding(false)} color="inherit">
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button
          onClick={() => setAdding(true)}
          fullWidth
          color="inherit"
          sx={{
            py: 1.5,
            border: '2px dashed',
            borderColor: 'divider',
            borderRadius: 3,
            '&:hover': { borderColor: 'primary.light' },
          }}
        >
          + Add Location
        </Button>
      )}
    </div>
  )
}
