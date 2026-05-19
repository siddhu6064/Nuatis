'use client'

import { useState, useEffect, useCallback } from 'react'

interface Snippet {
  id: string
  name: string
  shortcut: string
  body: string
  created_at: string
}

interface FormState {
  name: string
  shortcut: string
  body: string
}

const emptyForm: FormState = { name: '', shortcut: '', body: '' }

export default function SnippetsPage() {
  const [snippets, setSnippets] = useState<Snippet[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editing, setEditing] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }

  const fetchSnippets = useCallback(async () => {
    try {
      const res = await fetch('/api/snippets')
      if (!res.ok) throw new Error('Failed to fetch')
      const data = (await res.json()) as { snippets: Snippet[] }
      setSnippets(data.snippets ?? [])
    } catch {
      showToast('error', 'Failed to load snippets')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchSnippets()
  }, [fetchSnippets])

  function openNewForm() {
    setEditing(null)
    setForm(emptyForm)
    setError(null)
    setShowForm(true)
  }

  function openEditForm(snippet: Snippet) {
    setEditing(snippet.id)
    setForm({ name: snippet.name, shortcut: snippet.shortcut, body: snippet.body })
    setError(null)
    setShowForm(true)
  }

  function cancelForm() {
    setShowForm(false)
    setEditing(null)
    setForm(emptyForm)
    setError(null)
  }

  function handleShortcutChange(value: string) {
    const sanitized = value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 30)
    setForm((prev) => ({ ...prev, shortcut: sanitized }))
  }

  async function handleSave() {
    if (!form.name.trim()) {
      setError('Name is required')
      return
    }
    if (!form.shortcut.trim()) {
      setError('Shortcut is required')
      return
    }
    if (!form.body.trim()) {
      setError('Body is required')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        shortcut: form.shortcut.trim(),
        body: form.body.trim(),
      }

      if (editing) {
        const res = await fetch(`/api/snippets/${editing}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error((d as { error?: string }).error ?? 'Failed to update')
        }
        showToast('success', 'Snippet updated')
      } else {
        const res = await fetch('/api/snippets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error((d as { error?: string }).error ?? 'Failed to create')
        }
        showToast('success', 'Snippet created')
      }

      await fetchSnippets()
      cancelForm()
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : 'Failed to save snippet')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete snippet "${name}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/snippets/${id}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) throw new Error('Failed to delete')
      setSnippets((prev) => prev.filter((s) => s.id !== id))
      showToast('success', 'Snippet deleted')
    } catch {
      showToast('error', 'Failed to delete snippet')
    }
  }

  return (
    <div className="px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-ink">Snippets</h1>
        <p className="text-sm text-ink3 mt-0.5">
          Pre-written messages — type / in any compose bar to use
        </p>
      </div>

      {/* New Snippet button */}
      <div className="mb-4">
        {!showForm ? (
          <button
            onClick={openNewForm}
            className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
          >
            + New Snippet
          </button>
        ) : null}
      </div>

      {/* Inline form */}
      {showForm && (
        <div className="mb-6 bg-white rounded-xl border border-border-brand p-5 space-y-4 max-w-2xl">
          <h2 className="text-sm font-semibold text-ink">
            {editing ? 'Edit Snippet' : 'New Snippet'}
          </h2>

          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-ink2 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Appointment Reminder"
              className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent placeholder:text-gray-300"
            />
          </div>

          {/* Shortcut */}
          <div>
            <label className="block text-xs font-medium text-ink2 mb-1">
              Shortcut (no spaces, letters/numbers/dashes only)
              <span className="text-red-500"> *</span>
            </label>
            <input
              type="text"
              value={form.shortcut}
              onChange={(e) => handleShortcutChange(e.target.value)}
              placeholder="e.g. appt-reminder"
              className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent placeholder:text-gray-300"
            />
            {form.shortcut && (
              <p className="text-xs text-teal-600 mt-1 font-mono">/{form.shortcut}</p>
            )}
          </div>

          {/* Body */}
          <div>
            <label className="block text-xs font-medium text-ink2 mb-1">
              Body <span className="text-red-500">*</span>
            </label>
            <textarea
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              rows={4}
              placeholder="Type your message here..."
              className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent placeholder:text-gray-300 resize-none"
            />
            <p className="text-xs text-ink3 mt-1">
              Use {'{contact_name}'} and {'{date}'} as variables
            </p>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              onClick={cancelForm}
              disabled={saving}
              className="px-4 py-2 bg-white text-sm font-medium text-ink2 rounded-lg border border-border-brand hover:bg-bg transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <p className="text-sm text-ink4">Loading...</p>
      ) : snippets.length === 0 ? (
        <div className="bg-white rounded-xl border border-border-brand px-6 py-12 text-center max-w-4xl">
          <p className="text-sm text-ink4">No snippets yet — create your first one.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-border-brand overflow-hidden max-w-4xl">
          <div className="px-4 py-2.5 border-b border-border-brand bg-bg">
            <p className="text-xs text-ink3 font-medium">
              {snippets.length} {snippets.length === 1 ? 'snippet' : 'snippets'}
            </p>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b border-border-brand bg-bg">
              <tr>
                <th className="text-left py-2 px-4 text-ink3 font-medium">Shortcut</th>
                <th className="text-left py-2 px-4 text-ink3 font-medium">Name</th>
                <th className="text-left py-2 px-4 text-ink3 font-medium">Preview</th>
                <th className="py-2 px-4" />
              </tr>
            </thead>
            <tbody>
              {snippets.map((snippet) => (
                <tr key={snippet.id} className="border-b border-border-brand last:border-0">
                  <td className="py-2 px-4">
                    <code className="font-mono text-teal-600 text-xs bg-teal-50 px-1.5 py-0.5 rounded">
                      /{snippet.shortcut}
                    </code>
                  </td>
                  <td className="py-2 px-4 text-ink font-medium">{snippet.name}</td>
                  <td className="py-2 px-4 text-ink3 max-w-xs">
                    {snippet.body.length > 60 ? snippet.body.slice(0, 60) + '…' : snippet.body}
                  </td>
                  <td className="py-2 px-4 text-right whitespace-nowrap">
                    <button
                      onClick={() => openEditForm(snippet)}
                      className="text-xs text-ink3 hover:text-ink transition-colors px-2 py-1 rounded hover:bg-bg mr-1"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => void handleDelete(snippet.id, snippet.name)}
                      className="text-xs text-red-500 hover:text-red-700 transition-colors px-2 py-1 rounded hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${
            toast.type === 'success'
              ? 'bg-teal-600 text-white'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}
