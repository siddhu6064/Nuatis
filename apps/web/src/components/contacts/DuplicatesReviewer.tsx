'use client'

import { useState, useEffect, useCallback } from 'react'

interface ContactSummary {
  id: string
  full_name: string
  phone: string | null
  email: string | null
  created_at: string
}

interface DupPair {
  contact_a: ContactSummary
  contact_b: ContactSummary
  confidence: number
  match_reason: string
}

const CONFIDENCE_BADGE: Record<string, string> = {
  '100': 'bg-green-100 text-green-700',
  '80': 'bg-amber-100 text-amber-700',
  '70': 'bg-gray-100 text-gray-600',
}

function badgeClass(confidence: number): string {
  if (confidence >= 100) return CONFIDENCE_BADGE['100']!
  if (confidence >= 80) return CONFIDENCE_BADGE['80']!
  return CONFIDENCE_BADGE['70']!
}

export default function DuplicatesReviewer() {
  const [pairs, setPairs] = useState<DupPair[]>([])
  const [loading, setLoading] = useState(true)
  const [dismissed, setDismissed] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem('nuatis_dismissed_dupes')
      return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
    } catch {
      return new Set()
    }
  })
  const [mergeModal, setMergeModal] = useState<DupPair | null>(null)
  const [primaryId, setPrimaryId] = useState<string>('')
  const [fieldChoices, setFieldChoices] = useState<Record<string, string>>({})
  const [merging, setMerging] = useState(false)

  const fetchDuplicates = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/contacts/duplicates')
      if (res.ok) {
        const data = (await res.json()) as { pairs: DupPair[] }
        setPairs(data.pairs)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchDuplicates()
  }, [fetchDuplicates])

  const dismiss = (pair: DupPair) => {
    const key = [pair.contact_a.id, pair.contact_b.id].sort().join(':')
    const next = new Set(dismissed)
    next.add(key)
    setDismissed(next)
    localStorage.setItem('nuatis_dismissed_dupes', JSON.stringify([...next]))
  }

  const openMerge = (pair: DupPair) => {
    setMergeModal(pair)
    setPrimaryId(pair.contact_a.id)
    setFieldChoices({
      name: 'primary',
      phone: 'primary',
      email: 'primary',
      custom_fields: 'primary',
    })
  }

  const doMerge = async () => {
    if (!mergeModal) return
    setMerging(true)
    try {
      const secondaryId =
        primaryId === mergeModal.contact_a.id ? mergeModal.contact_b.id : mergeModal.contact_a.id

      const res = await fetch('/api/contacts/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          primary_id: primaryId,
          secondary_id: secondaryId,
          field_choices: { ...fieldChoices, tags: 'merge' },
        }),
      })

      if (res.ok) {
        setPairs((prev) =>
          prev.filter(
            (p) =>
              !(
                (p.contact_a.id === mergeModal.contact_a.id &&
                  p.contact_b.id === mergeModal.contact_b.id) ||
                (p.contact_a.id === mergeModal.contact_b.id &&
                  p.contact_b.id === mergeModal.contact_a.id)
              )
          )
        )
        setMergeModal(null)
      }
    } finally {
      setMerging(false)
    }
  }

  const visiblePairs = pairs.filter((p) => {
    const key = [p.contact_a.id, p.contact_b.id].sort().join(':')
    return !dismissed.has(key)
  })

  if (loading) {
    return <div className="py-12 text-center text-sm text-gray-400">Scanning for duplicates...</div>
  }

  if (visiblePairs.length === 0) {
    return (
      <div className="py-12 text-center">
        <span className="text-3xl">{'\u2713'}</span>
        <p className="text-sm font-medium text-gray-600 mt-2">No duplicate contacts found</p>
        <p className="text-xs text-gray-400 mt-1">Your contact list looks clean</p>
      </div>
    )
  }

  const primary = mergeModal
    ? primaryId === mergeModal.contact_a.id
      ? mergeModal.contact_a
      : mergeModal.contact_b
    : null
  const secondary = mergeModal
    ? primaryId === mergeModal.contact_a.id
      ? mergeModal.contact_b
      : mergeModal.contact_a
    : null

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        {visiblePairs.length} potential duplicate pairs found
      </p>

      <div className="space-y-4">
        {visiblePairs.map((pair) => {
          const key = [pair.contact_a.id, pair.contact_b.id].sort().join(':')
          return (
            <div key={key} className="border border-gray-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${badgeClass(pair.confidence)}`}
                >
                  {pair.confidence}% match
                </span>
                <span className="text-[10px] text-gray-400">{pair.match_reason}</span>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-3">
                {[pair.contact_a, pair.contact_b].map((c) => (
                  <div key={c.id} className="bg-gray-50 rounded-lg p-3">
                    <p className="text-sm font-medium text-gray-900">{c.full_name}</p>
                    <p className="text-xs text-gray-500">{c.phone ?? 'No phone'}</p>
                    <p className="text-xs text-gray-500">{c.email ?? 'No email'}</p>
                    <p className="text-[10px] text-gray-400 mt-1">
                      Created{' '}
                      {new Date(c.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => openMerge(pair)}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-teal-600 rounded-md hover:bg-teal-700"
                >
                  Merge {'\u2192'}
                </button>
                <button
                  onClick={() => dismiss(pair)}
                  className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700"
                >
                  Not a duplicate
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Merge modal */}
      {mergeModal && primary && secondary && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMergeModal(null)} />
          <div className="relative bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-lg p-6 max-h-[80vh] overflow-y-auto">
            <h3 className="text-sm font-bold text-gray-900 mb-4">Merge Contacts</h3>

            {/* Primary selector */}
            <div className="mb-4">
              <p className="text-[10px] font-medium text-gray-400 uppercase mb-1.5">
                Keep as primary
              </p>
              <div className="flex gap-2">
                {[mergeModal.contact_a, mergeModal.contact_b].map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setPrimaryId(c.id)}
                    className={`flex-1 px-3 py-2 rounded-lg text-xs text-left border transition-colors ${
                      primaryId === c.id
                        ? 'border-teal-500 bg-teal-50 text-teal-700'
                        : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <span className="font-medium">{c.full_name}</span>
                    <br />
                    {c.phone ?? c.email ?? ''}
                  </button>
                ))}
              </div>
            </div>

            {/* Field choices */}
            <div className="space-y-2 mb-4">
              {(['name', 'phone', 'email'] as const).map((field) => {
                const pVal =
                  field === 'name'
                    ? primary.full_name
                    : field === 'phone'
                      ? primary.phone
                      : primary.email
                const sVal =
                  field === 'name'
                    ? secondary.full_name
                    : field === 'phone'
                      ? secondary.phone
                      : secondary.email

                return (
                  <div key={field} className="flex items-center gap-3 text-xs">
                    <span className="w-14 text-gray-400 capitalize">{field}</span>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name={field}
                        checked={fieldChoices[field] !== 'secondary'}
                        onChange={() => setFieldChoices({ ...fieldChoices, [field]: 'primary' })}
                        className="w-3 h-3 text-teal-600"
                      />
                      <span className="text-gray-700">{pVal ?? '\u2014'}</span>
                    </label>
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name={field}
                        checked={fieldChoices[field] === 'secondary'}
                        onChange={() => setFieldChoices({ ...fieldChoices, [field]: 'secondary' })}
                        className="w-3 h-3 text-teal-600"
                      />
                      <span className="text-gray-700">{sVal ?? '\u2014'}</span>
                    </label>
                  </div>
                )
              })}
              <div className="flex items-center gap-3 text-xs">
                <span className="w-14 text-gray-400">Tags</span>
                <span className="text-gray-500 italic">Merge both</span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
              <button
                onClick={() => setMergeModal(null)}
                className="px-4 py-2 text-xs text-gray-500"
              >
                Cancel
              </button>
              <button
                onClick={() => void doMerge()}
                disabled={merging}
                className="px-4 py-2 text-xs font-medium text-white bg-teal-600 rounded-lg hover:bg-teal-700 disabled:opacity-50"
              >
                {merging ? 'Merging...' : 'Merge contacts'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
