'use client'

import { useState, useRef, useEffect } from 'react'
import TextField from '@mui/material/TextField'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Button from '@mui/material/Button'

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
      <Button
        onClick={() => setExpanded(true)}
        fullWidth
        variant="outlined"
        color="inherit"
        sx={{
          justifyContent: 'flex-start',
          textTransform: 'none',
          borderStyle: 'dashed',
          fontWeight: 400,
        }}
      >
        Add a note...
      </Button>
    )
  }

  return (
    <div className="border border-border-brand rounded-lg p-3" onKeyDown={handleKeyDown}>
      <TextField
        inputRef={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        multiline
        rows={3}
        placeholder="Write a note..."
        fullWidth
        variant="standard"
        slotProps={{
          htmlInput: { maxLength: 5000 },
          input: { disableUnderline: true },
        }}
      />
      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border-brand">
        <div className="flex items-center gap-3">
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={pinned}
                onChange={(e) => setPinned(e.target.checked)}
              />
            }
            label={<span className="text-xs text-ink3">Pin note</span>}
          />
          {body.length > 4000 && <span className="text-[10px] text-ink4">{body.length}/5000</span>}
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="text-xs text-red-500">{error}</span>}
          <Button
            onClick={() => {
              setExpanded(false)
              setBody('')
              setPinned(false)
              setError(null)
            }}
            size="small"
            color="inherit"
          >
            Cancel
          </Button>
          <Button
            onClick={() => void handleSave()}
            disabled={!body.trim() || saving}
            variant="contained"
            size="small"
          >
            {saving ? 'Saving...' : 'Save note'}
          </Button>
        </div>
      </div>
    </div>
  )
}
