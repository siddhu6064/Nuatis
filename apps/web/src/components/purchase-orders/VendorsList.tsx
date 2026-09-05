'use client'

import { useState } from 'react'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import type { Vendor } from './types'

interface Props {
  vendors: Vendor[]
  onChanged: () => void
}

export default function VendorsList({ vendors, onChanged }: Props) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleAdd() {
    setError(null)
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        setError(err.error ?? 'Failed to add vendor')
        return
      }
      setName('')
      setEmail('')
      setPhone('')
      setAdding(false)
      onChanged()
    } finally {
      setSaving(false)
    }
  }

  async function handleRetire(id: string) {
    await fetch(`/api/vendors/${id}`, { method: 'DELETE' })
    onChanged()
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setAdding((v) => !v)} variant={adding ? 'outlined' : 'contained'}>
          {adding ? 'Cancel' : '+ Add vendor'}
        </Button>
      </div>

      {adding && (
        <div className="bg-white rounded-xl border border-border-brand p-4 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <TextField
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              size="small"
            />
            <TextField
              label="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              size="small"
            />
            <TextField
              label="Phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              size="small"
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <Button
            onClick={() => void handleAdd()}
            disabled={saving}
            variant="contained"
            size="small"
          >
            {saving ? 'Saving…' : 'Save vendor'}
          </Button>
        </div>
      )}

      <div className="bg-white rounded-xl border border-border-brand overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg2 text-ink3 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-2">Name</th>
              <th className="text-left px-4 py-2">Contact</th>
              <th className="text-left px-4 py-2">Phone</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border-brand">
            {vendors.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-ink4">
                  No vendors yet.
                </td>
              </tr>
            ) : (
              vendors.map((v) => (
                <tr key={v.id}>
                  <td className="px-4 py-2.5 text-ink">{v.name}</td>
                  <td className="px-4 py-2.5 text-ink3">{v.email ?? '—'}</td>
                  <td className="px-4 py-2.5 text-ink3">{v.phone ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => void handleRetire(v.id)}
                      className="text-xs text-red-600 hover:underline"
                    >
                      Retire
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
