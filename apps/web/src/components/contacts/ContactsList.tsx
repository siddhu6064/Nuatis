'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import ContactFilters, { type FilterState, EMPTY_FILTERS } from './ContactFilters'
import SavedViews from './SavedViews'

interface Contact {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  pipeline_stage: string | null
  source: string | null
  created_at: string
}

interface SavedView {
  id: string
  name: string
  filters: Record<string, unknown>
  sort_by: string | null
  sort_dir: string | null
  is_default: boolean
  user_id: string | null
  sort_order: number
}

function filtersFromParams(params: URLSearchParams): FilterState {
  return {
    q: params.get('q') ?? '',
    pipeline_stage_id: params.get('pipeline_stage_id')?.split(',').filter(Boolean) ?? [],
    source: params.get('source')?.split(',').filter(Boolean) ?? [],
    tags: params.get('tags')?.split(',').filter(Boolean) ?? [],
    last_contacted_from: params.get('last_contacted_from') ?? '',
    last_contacted_to: params.get('last_contacted_to') ?? '',
    created_from: params.get('created_from') ?? '',
    created_to: params.get('created_to') ?? '',
    has_open_quote: params.get('has_open_quote') === 'true',
    sort_by: params.get('sort_by') ?? 'created_at',
    sort_dir: params.get('sort_dir') ?? 'desc',
  }
}

function filtersToParams(filters: FilterState): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.pipeline_stage_id.length > 0)
    params.set('pipeline_stage_id', filters.pipeline_stage_id.join(','))
  if (filters.source.length > 0) params.set('source', filters.source.join(','))
  if (filters.tags.length > 0) params.set('tags', filters.tags.join(','))
  if (filters.last_contacted_from) params.set('last_contacted_from', filters.last_contacted_from)
  if (filters.last_contacted_to) params.set('last_contacted_to', filters.last_contacted_to)
  if (filters.created_from) params.set('created_from', filters.created_from)
  if (filters.created_to) params.set('created_to', filters.created_to)
  if (filters.has_open_quote) params.set('has_open_quote', 'true')
  if (filters.sort_by !== 'created_at') params.set('sort_by', filters.sort_by)
  if (filters.sort_dir !== 'desc') params.set('sort_dir', filters.sort_dir)
  return params
}

function hasActiveFilters(f: FilterState): boolean {
  return (
    !!f.q ||
    f.pipeline_stage_id.length > 0 ||
    f.source.length > 0 ||
    f.tags.length > 0 ||
    !!f.last_contacted_from ||
    !!f.last_contacted_to ||
    !!f.created_from ||
    !!f.created_to ||
    f.has_open_quote
  )
}

function activeFilterCount(f: FilterState): number {
  let count = 0
  if (f.q) count++
  if (f.pipeline_stage_id.length > 0) count++
  if (f.source.length > 0) count++
  if (f.tags.length > 0) count++
  if (f.last_contacted_from || f.last_contacted_to) count++
  if (f.created_from || f.created_to) count++
  if (f.has_open_quote) count++
  return count
}

export default function ContactsList() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [filters, setFilters] = useState<FilterState>(() => filtersFromParams(searchParams))
  const [contacts, setContacts] = useState<Contact[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [showFilters, setShowFilters] = useState(false)
  const [activeViewId, setActiveViewId] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchContacts = useCallback(async (f: FilterState) => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('limit', '50')
    if (f.q) params.set('q', f.q)
    if (f.pipeline_stage_id.length > 0)
      params.set('pipeline_stage_id', f.pipeline_stage_id.join(','))
    if (f.source.length > 0) params.set('source', f.source.join(','))
    if (f.tags.length > 0) params.set('tags', f.tags.join(','))
    if (f.last_contacted_from) params.set('last_contacted_from', f.last_contacted_from)
    if (f.last_contacted_to) params.set('last_contacted_to', f.last_contacted_to)
    if (f.created_from) params.set('created_from', f.created_from)
    if (f.created_to) params.set('created_to', f.created_to)
    if (f.has_open_quote) params.set('has_open_quote', 'true')
    params.set('sort_by', f.sort_by)
    params.set('sort_dir', f.sort_dir)

    try {
      const res = await fetch(`/api/contacts?${params}`)
      if (res.ok) {
        const data = (await res.json()) as { contacts: Contact[]; total: number }
        setContacts(data.contacts)
        setTotal(data.total)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  // Sync filters to URL
  const updateFilters = useCallback(
    (newFilters: FilterState) => {
      setFilters(newFilters)
      setActiveViewId(null) // Deselect view when filters change manually
      const params = filtersToParams(newFilters)
      const qs = params.toString()
      router.push(qs ? `/contacts?${qs}` : '/contacts', { scroll: false })
    },
    [router]
  )

  // Debounced fetch
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => void fetchContacts(filters), 150)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [filters, fetchContacts])

  const handleSelectView = (view: SavedView) => {
    const f: FilterState = {
      ...EMPTY_FILTERS,
      q: (view.filters['q'] as string) ?? '',
      pipeline_stage_id: ((view.filters['pipeline_stage_id'] as string) ?? '')
        .split(',')
        .filter(Boolean),
      source: ((view.filters['source'] as string) ?? '').split(',').filter(Boolean),
      tags: ((view.filters['tags'] as string) ?? '').split(',').filter(Boolean),
      last_contacted_from: (view.filters['last_contacted_from'] as string) ?? '',
      last_contacted_to: (view.filters['last_contacted_to'] as string) ?? '',
      created_from: (view.filters['created_from'] as string) ?? '',
      created_to: (view.filters['created_to'] as string) ?? '',
      has_open_quote: view.filters['has_open_quote'] === 'true',
      sort_by: view.sort_by ?? 'created_at',
      sort_dir: view.sort_dir ?? 'desc',
    }
    setFilters(f)
    setActiveViewId(view.id)
    const params = filtersToParams(f)
    const qs = params.toString()
    router.push(qs ? `/contacts?${qs}` : '/contacts', { scroll: false })
  }

  const filterCount = activeFilterCount(filters)

  // Active filter chips
  const chips: Array<{ label: string; onRemove: () => void }> = []
  if (filters.q)
    chips.push({
      label: `Search: "${filters.q}"`,
      onRemove: () => updateFilters({ ...filters, q: '' }),
    })
  if (filters.pipeline_stage_id.length > 0)
    chips.push({
      label: `Stage (${filters.pipeline_stage_id.length})`,
      onRemove: () => updateFilters({ ...filters, pipeline_stage_id: [] }),
    })
  if (filters.source.length > 0)
    chips.push({
      label: `Source (${filters.source.length})`,
      onRemove: () => updateFilters({ ...filters, source: [] }),
    })
  if (filters.tags.length > 0)
    chips.push({
      label: `Tags: ${filters.tags.join(', ')}`,
      onRemove: () => updateFilters({ ...filters, tags: [] }),
    })
  if (filters.last_contacted_from || filters.last_contacted_to)
    chips.push({
      label: 'Last contacted',
      onRemove: () => updateFilters({ ...filters, last_contacted_from: '', last_contacted_to: '' }),
    })
  if (filters.created_from || filters.created_to)
    chips.push({
      label: 'Created date',
      onRemove: () => updateFilters({ ...filters, created_from: '', created_to: '' }),
    })
  if (filters.has_open_quote)
    chips.push({
      label: 'Has open quote',
      onRemove: () => updateFilters({ ...filters, has_open_quote: false }),
    })

  return (
    <div className="flex h-full">
      <div className="flex-1 px-8 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Contacts</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              {loading ? '...' : `Showing ${contacts.length} of ${total}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-colors ${
                showFilters || filterCount > 0
                  ? 'border-teal-200 bg-teal-50 text-teal-700'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}
            >
              <span className="text-xs">&#9776;</span>
              Filter
              {filterCount > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-teal-600 text-white">
                  {filterCount}
                </span>
              )}
            </button>
            <Link
              href="/contacts/new"
              className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
            >
              <span className="text-base leading-none">+</span>
              Add Contact
            </Link>
          </div>
        </div>

        {/* Search bar */}
        <div className="mb-4">
          <input
            type="text"
            value={filters.q}
            onChange={(e) => updateFilters({ ...filters, q: e.target.value })}
            placeholder="Search by name, phone, email..."
            className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:ring-1 focus:ring-teal-500 focus:border-teal-500 placeholder-gray-400"
          />
        </div>

        {/* Saved Views */}
        <SavedViews
          activeViewId={activeViewId}
          onSelectView={handleSelectView}
          currentFilters={filters}
          hasActiveFilters={hasActiveFilters(filters)}
        />

        {/* Active filter chips */}
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-4">
            {chips.map((chip) => (
              <span
                key={chip.label}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600"
              >
                {chip.label}
                <button onClick={chip.onRemove} className="text-gray-400 hover:text-gray-600">
                  &times;
                </button>
              </span>
            ))}
            <button
              onClick={() => updateFilters(EMPTY_FILTERS)}
              className="text-[11px] text-red-500 hover:text-red-600 px-1"
            >
              Clear all
            </button>
          </div>
        )}

        {/* Contacts table */}
        <div className="bg-white rounded-xl border border-gray-100">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <p className="text-sm text-gray-400">Loading...</p>
            </div>
          ) : contacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center mb-3">
                <span className="text-gray-300 text-xl">&#9678;</span>
              </div>
              {hasActiveFilters(filters) ? (
                <>
                  <p className="text-sm font-medium text-gray-400">
                    No contacts match these filters
                  </p>
                  <button
                    onClick={() => updateFilters(EMPTY_FILTERS)}
                    className="mt-3 text-xs text-teal-600 hover:text-teal-700 font-medium"
                  >
                    Clear filters
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-gray-400">No contacts yet</p>
                  <p className="text-xs text-gray-300 mt-1">
                    Add your first contact to get started
                  </p>
                  <Link
                    href="/contacts/new"
                    className="mt-4 text-xs text-teal-600 hover:text-teal-700 font-medium"
                  >
                    Add Contact &rarr;
                  </Link>
                </>
              )}
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Name</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Email</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Phone</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Stage</th>
                  <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Added</th>
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => (
                  <tr
                    key={contact.id}
                    className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors cursor-pointer"
                    onClick={() => router.push(`/contacts/${contact.id}`)}
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
                          <span className="text-teal-700 text-xs font-bold">
                            {contact.full_name?.charAt(0)?.toUpperCase() ?? '?'}
                          </span>
                        </div>
                        <span className="text-sm font-medium text-gray-900">
                          {contact.full_name}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">{contact.email ?? '\u2014'}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{contact.phone ?? '\u2014'}</td>
                    <td className="px-6 py-4">
                      {contact.pipeline_stage ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-teal-50 text-teal-700">
                          {contact.pipeline_stage}
                        </span>
                      ) : (
                        <span className="text-sm text-gray-300">\u2014</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-400">
                      {new Date(contact.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Filter sidebar */}
      {showFilters && (
        <ContactFilters
          filters={filters}
          onChange={updateFilters}
          onClose={() => setShowFilters(false)}
        />
      )}
    </div>
  )
}
