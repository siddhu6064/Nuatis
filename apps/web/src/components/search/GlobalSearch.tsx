'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface SearchContact {
  id: string
  name: string
  phone: string | null
  email: string | null
  pipeline_stage_name: string | null
}

interface SearchAppointment {
  id: string
  title: string
  start_time: string
  contact_name: string | null
  contact_id: string | null
}

interface SearchQuote {
  id: string
  title: string
  status: string
  total: number
  contact_name: string | null
  contact_id: string | null
}

interface SearchResults {
  contacts: SearchContact[]
  appointments: SearchAppointment[]
  quotes: SearchQuote[]
  total: number
}

const RECENT_KEY = 'nuatis_recent_searches'

function getRecentSearches(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    return raw ? (JSON.parse(raw) as string[]).slice(0, 5) : []
  } catch {
    return []
  }
}

function saveRecentSearch(q: string) {
  try {
    const recent = getRecentSearches().filter((s) => s !== q)
    recent.unshift(q)
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, 5)))
  } catch {
    // ignore
  }
}

export default function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setRecentSearches(getRecentSearches())
      setTimeout(() => inputRef.current?.focus(), 50)
    } else {
      setQuery('')
      setResults(null)
      setSelectedIndex(0)
    }
  }, [open])

  // Debounced search
  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults(null)
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`)
      if (res.ok) {
        const data = (await res.json()) as SearchResults
        setResults(data)
        setSelectedIndex(0)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void doSearch(query), 200)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, doSearch])

  // Build flat list of navigable items
  const allItems: Array<{ type: string; id: string; href: string; label: string; sub: string }> = []
  if (results) {
    for (const c of results.contacts) {
      allItems.push({
        type: 'contact',
        id: c.id,
        href: `/contacts/${c.id}`,
        label: c.name,
        sub: c.email || c.phone || '',
      })
    }
    for (const a of results.appointments) {
      allItems.push({
        type: 'appointment',
        id: a.id,
        href: '/appointments',
        label: a.title,
        sub: a.contact_name
          ? `${a.contact_name} \u00B7 ${new Date(a.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
          : new Date(a.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      })
    }
    for (const q of results.quotes) {
      allItems.push({
        type: 'quote',
        id: q.id,
        href: `/quotes/${q.id}`,
        label: q.title,
        sub: `${q.status} \u00B7 $${Number(q.total).toFixed(2)}`,
      })
    }
  }

  const navigate = (href: string) => {
    if (query.trim()) saveRecentSearch(query.trim())
    setOpen(false)
    router.push(href)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, allItems.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && allItems[selectedIndex]) {
      e.preventDefault()
      navigate(allItems[selectedIndex].href)
    }
  }

  const typeIcon: Record<string, string> = {
    contact: '\u25CE',
    appointment: '\u25F7',
    quote: '\u25EB',
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />

      {/* Modal */}
      <div className="relative w-full max-w-[560px] bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
          <span className="text-gray-400 text-sm">{'\u{1F50D}'}</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search contacts, appointments, quotes..."
            className="flex-1 text-sm border-0 focus:ring-0 p-0 placeholder-gray-400"
          />
          <kbd className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[400px] overflow-y-auto">
          {loading && (
            <div className="px-4 py-6 text-center text-sm text-gray-400">Searching...</div>
          )}

          {!loading && query.length < 2 && recentSearches.length > 0 && (
            <div className="px-4 py-3">
              <p className="text-[10px] font-medium text-gray-400 uppercase mb-2">Recent</p>
              {recentSearches.map((s) => (
                <button
                  key={s}
                  onClick={() => setQuery(s)}
                  className="block w-full text-left text-sm text-gray-600 hover:bg-gray-50 px-2 py-1.5 rounded"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {!loading && results && results.total === 0 && (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              No results for &ldquo;{query}&rdquo;
            </div>
          )}

          {!loading && results && results.total > 0 && (
            <div>
              {results.contacts.length > 0 && (
                <div>
                  <p className="px-4 pt-3 pb-1 text-[10px] font-medium text-gray-400 uppercase">
                    Contacts ({results.contacts.length})
                  </p>
                  {results.contacts.map((c, i) => {
                    const idx = i
                    return (
                      <button
                        key={c.id}
                        onClick={() => navigate(`/contacts/${c.id}`)}
                        className={`flex items-center gap-3 w-full text-left px-4 py-2 text-sm transition-colors ${
                          selectedIndex === idx
                            ? 'bg-teal-50 text-teal-700'
                            : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <span className="text-gray-400">{typeIcon['contact']}</span>
                        <span className="font-medium flex-1">{c.name}</span>
                        <span className="text-xs text-gray-400">{c.email || c.phone}</span>
                      </button>
                    )
                  })}
                </div>
              )}

              {results.appointments.length > 0 && (
                <div>
                  <p className="px-4 pt-3 pb-1 text-[10px] font-medium text-gray-400 uppercase">
                    Appointments ({results.appointments.length})
                  </p>
                  {results.appointments.map((a, i) => {
                    const idx = results.contacts.length + i
                    return (
                      <button
                        key={a.id}
                        onClick={() => navigate('/appointments')}
                        className={`flex items-center gap-3 w-full text-left px-4 py-2 text-sm transition-colors ${
                          selectedIndex === idx
                            ? 'bg-teal-50 text-teal-700'
                            : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <span className="text-gray-400">{typeIcon['appointment']}</span>
                        <span className="font-medium flex-1">{a.title}</span>
                        <span className="text-xs text-gray-400">
                          {a.contact_name
                            ? `${a.contact_name}`
                            : new Date(a.start_time).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                              })}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}

              {results.quotes.length > 0 && (
                <div>
                  <p className="px-4 pt-3 pb-1 text-[10px] font-medium text-gray-400 uppercase">
                    Quotes ({results.quotes.length})
                  </p>
                  {results.quotes.map((q, i) => {
                    const idx = results.contacts.length + results.appointments.length + i
                    return (
                      <button
                        key={q.id}
                        onClick={() => navigate(`/quotes/${q.id}`)}
                        className={`flex items-center gap-3 w-full text-left px-4 py-2 text-sm transition-colors ${
                          selectedIndex === idx
                            ? 'bg-teal-50 text-teal-700'
                            : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <span className="text-gray-400">{typeIcon['quote']}</span>
                        <span className="font-medium flex-1">{q.title}</span>
                        <span className="text-xs text-gray-400">
                          {q.status} &middot; ${Number(q.total).toFixed(2)}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
              <div className="h-2" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
