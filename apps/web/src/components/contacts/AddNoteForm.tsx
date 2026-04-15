'use client'

import { useState, useRef, useEffect } from 'react'

interface Props {
  contactId: string
  onNoteAdded: () => void
}

export default function AddNoteForm({ contactId, onNoteAdded }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [body, setBody] = useState('')
  const [pinned, setPinned] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (expanded && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [expanded])

  const handleSave = async () => {
    if (!body.trim()) return
    setSaving(true)
    setError(null)

    try {
      const res = await fetch(`/api/contacts/${contactId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: body.trim(), pinned }),
      })

      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error ?? 'Failed to save note')
      }

      setBody('')
      setPinned(false)
      setExpanded(false)
      onNoteAdded()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save note')
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      void handleSave()
    }
    if (e.key === 'Escape') {
      setExpanded(false)
      setBody('')
      setPinned(false)
      setError(null)
    }
  }

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full text-left px-4 py-3 text-sm text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg border border-dashed border-gray-200 transition-colors"
      >
        Add a note...
      </button>
    )
  }

  return (
    <div className="border border-gray-200 rounded-lg p-3" onKeyDown={handleKeyDown}>
      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        maxLength={5000}
        placeholder="Write a note..."
        className="w-full text-sm text-gray-700 placeholder-gray-300 border-0 focus:ring-0 resize-none p-0"
      />
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
            <input
              type="checkbox"
              checked={pinned}
              onChange={(e) => setPinned(e.target.checked)}
              className="rounded border-gray-300 text-teal-600 focus:ring-teal-500 w-3.5 h-3.5"
            />
            Pin note
          </label>
          {body.length > 4000 && (
            <span className="text-[10px] text-gray-400">{body.length}/5000</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="text-xs text-red-500">{error}</span>}
          <button
            onClick={() => {
              setExpanded(false)
              setBody('')
              setPinned(false)
              setError(null)
            }}
            className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={!body.trim() || saving}
            className="px-3 py-1.5 text-xs font-medium text-white bg-teal-600 rounded-md hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving...' : 'Save note'}
          </button>
        </div>
      </div>
    </div>
  )
}
