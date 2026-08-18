'use client'

import { useState, useEffect, useCallback } from 'react'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import FormControlLabel from '@mui/material/FormControlLabel'
import Button from '@mui/material/Button'
import { Modal } from '@/components/ui/Modal'

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
  '70': 'bg-bg2 text-ink3',
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
    return <div className="py-12 text-center text-sm text-ink4">Scanning for duplicates...</div>
  }

  if (visiblePairs.length === 0) {
    return (
      <div className="py-12 text-center">
        <span className="text-3xl">{'\u2713'}</span>
        <p className="text-sm font-medium text-ink3 mt-2">No duplicate contacts found</p>
        <p className="text-xs text-ink4 mt-1">Your contact list looks clean</p>
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
      <p className="text-sm text-ink3 mb-4">
        {visiblePairs.length} potential duplicate pairs found
      </p>

      <div className="space-y-4">
        {visiblePairs.map((pair) => {
          const key = [pair.contact_a.id, pair.contact_b.id].sort().join(':')
          return (
            <div key={key} className="border border-border-brand rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${badgeClass(pair.confidence)}`}
                >
                  {pair.confidence}% match
                </span>
                <span className="text-[10px] text-ink4">{pair.match_reason}</span>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-3">
                {[pair.contact_a, pair.contact_b].map((c) => (
                  <div key={c.id} className="bg-bg rounded-lg p-3">
                    <p className="text-sm font-medium text-ink">{c.full_name}</p>
                    <p className="text-xs text-ink3">{c.phone ?? 'No phone'}</p>
                    <p className="text-xs text-ink3">{c.email ?? 'No email'}</p>
                    <p className="text-[10px] text-ink4 mt-1">
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
                  className="px-3 py-1.5 text-xs text-ink3 hover:text-ink2"
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
        <Modal
          onClose={() => setMergeModal(null)}
          title="Merge Contacts"
          maxWidth="sm"
          footer={
            <>
              <Button
                onClick={() => setMergeModal(null)}
                variant="text"
                color="inherit"
                size="small"
              >
                Cancel
              </Button>
              <Button
                onClick={() => void doMerge()}
                disabled={merging}
                variant="contained"
                size="small"
              >
                {merging ? 'Merging...' : 'Merge contacts'}
              </Button>
            </>
          }
        >
          {/*
            Primary selector: intentionally left as plain Tailwind buttons,
            not MUI ToggleButtonGroup. This is a custom card-picker, not a
            semantic radio choice \u2014 introducing a new MUI component type
            here isn't justified by this one usage. The field choices below
            ARE a real radio choice (mutually exclusive per field), so those
            convert to RadioGroup/Radio, matching the pattern already
            established in subscriptions' CancelModal.
          */}
          <div className="mb-4">
            <p className="text-[10px] font-medium text-ink4 uppercase mb-1.5">Keep as primary</p>
            <div className="flex gap-2">
              {[mergeModal.contact_a, mergeModal.contact_b].map((c) => (
                <button
                  key={c.id}
                  onClick={() => setPrimaryId(c.id)}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs text-left border transition-colors ${
                    primaryId === c.id
                      ? 'border-teal-500 bg-teal-50 text-teal-700'
                      : 'border-border-brand text-ink3 hover:bg-bg'
                  }`}
                >
                  <span className="font-medium">{c.full_name}</span>
                  <br />
                  {c.phone ?? c.email ?? ''}
                </button>
              ))}
            </div>
          </div>

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
                  <span className="w-14 text-ink4 capitalize">{field}</span>
                  <RadioGroup
                    row
                    value={fieldChoices[field] === 'secondary' ? 'secondary' : 'primary'}
                    onChange={(e) => setFieldChoices({ ...fieldChoices, [field]: e.target.value })}
                  >
                    <FormControlLabel
                      value="primary"
                      control={<Radio size="small" />}
                      label={<span className="text-ink2 text-xs">{pVal ?? '\u2014'}</span>}
                    />
                    <FormControlLabel
                      value="secondary"
                      control={<Radio size="small" />}
                      label={<span className="text-ink2 text-xs">{sVal ?? '\u2014'}</span>}
                    />
                  </RadioGroup>
                </div>
              )
            })}
            <div className="flex items-center gap-3 text-xs">
              <span className="w-14 text-ink4">Tags</span>
              <span className="text-ink3 italic">Merge both</span>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
