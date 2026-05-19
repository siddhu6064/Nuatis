'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface SnippetResult {
  id: string
  name: string
  shortcut: string
  body: string
}

interface Props {
  value: string
  onChange: (val: string) => void
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  placeholder?: string
  rows?: number
  maxLength?: number
  contactName?: string
  className?: string
  textareaRef?: React.RefObject<HTMLTextAreaElement>
}

function substituteVars(body: string, contactName?: string): string {
  const today = new Date()
  const dateStr = today.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
  let result = body
  if (contactName) result = result.replaceAll('{contact_name}', contactName)
  result = result.replaceAll('{date}', dateStr)
  return result
}

export default function SnippetPicker({
  value,
  onChange,
  onKeyDown,
  placeholder,
  rows = 1,
  maxLength,
  contactName,
  className,
  textareaRef,
}: Props) {
  const [snippets, setSnippets] = useState<SnippetResult[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [triggerStart, setTriggerStart] = useState<number | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const detectTrigger = useCallback((text: string, cursorPos: number) => {
    // Find '/' at start or after whitespace, before cursor
    const beforeCursor = text.slice(0, cursorPos)
    const match = beforeCursor.match(/(^|\s)\/(\S*)$/)
    if (!match) return null
    const slashPos = beforeCursor.lastIndexOf('/')
    return { start: slashPos, query: match[2] ?? '' }
  }, [])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newVal = e.target.value
      const cursor = e.target.selectionStart ?? newVal.length
      onChange(newVal)

      const trigger = detectTrigger(newVal, cursor)
      if (trigger) {
        setTriggerStart(trigger.start)
        const q = trigger.query
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(async () => {
          try {
            const res = await fetch(`/api/snippets/search?q=${encodeURIComponent(q)}`)
            if (!res.ok) return
            const data = (await res.json()) as { snippets: SnippetResult[] }
            setSnippets(data.snippets ?? [])
            setShowDropdown((data.snippets ?? []).length > 0)
            setActiveIndex(0)
          } catch {
            // silently ignore
          }
        }, 150)
      } else {
        setShowDropdown(false)
        setTriggerStart(null)
        setSnippets([])
      }
    },
    [onChange, detectTrigger]
  )

  const selectSnippet = useCallback(
    (snippet: SnippetResult) => {
      if (triggerStart === null) return
      const substituted = substituteVars(snippet.body, contactName)
      // Replace from triggerStart to end of typed shortcut
      const beforeTrigger = value.slice(0, triggerStart)
      const afterTrigger = value.slice(triggerStart).replace(/^\/\S*/, '')
      onChange(beforeTrigger + substituted + afterTrigger)
      setShowDropdown(false)
      setTriggerStart(null)
      setSnippets([])
    },
    [value, triggerStart, contactName, onChange]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showDropdown) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setActiveIndex((i) => Math.min(i + 1, snippets.length - 1))
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setActiveIndex((i) => Math.max(i - 1, 0))
          return
        }
        if (e.key === 'Enter' && snippets[activeIndex]) {
          e.preventDefault()
          selectSnippet(snippets[activeIndex])
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setShowDropdown(false)
          return
        }
      }
      onKeyDown?.(e)
    },
    [showDropdown, snippets, activeIndex, selectSnippet, onKeyDown]
  )

  // Click outside to dismiss
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={wrapperRef} className="relative flex-1">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        className={className}
      />
      {showDropdown && snippets.length > 0 && (
        <div className="absolute bottom-full left-0 mb-1 w-full max-w-sm bg-white border border-border-brand rounded-lg shadow-lg z-50 overflow-hidden">
          {snippets.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                selectSnippet(s)
              }}
              className={`w-full text-left px-3 py-2 text-sm flex flex-col gap-0.5 hover:bg-bg ${
                i === activeIndex ? 'bg-bg' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-teal-600 text-xs">/{s.shortcut}</span>
                <span className="text-ink text-xs">{s.name}</span>
              </div>
              <span className="text-xs text-ink3 truncate">
                {s.body.slice(0, 40)}
                {s.body.length > 40 ? '…' : ''}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
