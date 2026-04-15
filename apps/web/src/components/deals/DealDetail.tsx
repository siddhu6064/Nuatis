'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import ActivityTimeline from '@/components/contacts/ActivityTimeline'

interface Deal {
  id: string
  title: string
  value: number
  pipeline_stage_id: string | null
  contact_id: string | null
  company_id: string | null
  close_date: string | null
  probability: number
  notes: string | null
  is_closed_won: boolean
  is_closed_lost: boolean
  stage_name: string | null
  stage_color: string | null
  contact_name: string | null
  company_name: string | null
}

interface Stage {
  id: string
  name: string
  color: string
}

interface Props {
  dealId: string
}

export default function DealDetail({ dealId }: Props) {
  const [deal, setDeal] = useState<Deal | null>(null)
  const [stages, setStages] = useState<Stage[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notes, setNotes] = useState('')

  const fetchDeal = useCallback(async () => {
    const res = await fetch(`/api/deals/${dealId}`)
    if (res.ok) {
      const d = (await res.json()) as Deal
      setDeal(d)
      setNotes(d.notes ?? '')
    }
  }, [dealId])

  useEffect(() => {
    setLoading(true)
    void Promise.all([
      fetchDeal(),
      fetch('/api/contacts/stages')
        .then((r) => r.json())
        .then((d: { stages: Stage[] }) => setStages(d.stages))
        .catch(() => {}),
    ]).finally(() => setLoading(false))
  }, [fetchDeal])

  const updateDeal = async (updates: Record<string, unknown>) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/deals/${dealId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (res.ok) void fetchDeal()
    } finally {
      setSaving(false)
    }
  }

  if (loading || !deal)
    return <div className="py-12 text-center text-sm text-gray-400">Loading...</div>

  const isClosed = deal.is_closed_won || deal.is_closed_lost

  return (
    <div>
      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-gray-900">{deal.title}</h2>
          {isClosed && (
            <span
              className={`px-2 py-0.5 rounded text-xs font-bold ${deal.is_closed_won ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
            >
              {deal.is_closed_won ? 'Won' : 'Lost'}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm mb-4">
          <div>
            <span className="text-gray-400 text-xs">Value</span>
            <p className="text-xl font-bold text-teal-600">
              ${Number(deal.value).toLocaleString()}
            </p>
          </div>
          <div>
            <span className="text-gray-400 text-xs">Probability</span>
            <div className="flex items-center gap-2 mt-0.5">
              <input
                type="range"
                min="0"
                max="100"
                value={deal.probability}
                onChange={(e) => void updateDeal({ probability: parseInt(e.target.value) })}
                className="flex-1 h-1.5 accent-teal-600"
              />
              <span className="text-sm font-medium text-gray-700 w-8">{deal.probability}%</span>
            </div>
          </div>
          <div>
            <span className="text-gray-400 text-xs">Stage</span>
            <select
              value={deal.pipeline_stage_id ?? ''}
              onChange={(e) => void updateDeal({ pipeline_stage_id: e.target.value })}
              className="mt-0.5 w-full text-sm border border-gray-200 rounded px-2 py-1"
            >
              {stages.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span className="text-gray-400 text-xs">Close Date</span>
            <input
              type="date"
              value={deal.close_date ?? ''}
              onChange={(e) => void updateDeal({ close_date: e.target.value || null })}
              className="mt-0.5 w-full text-sm border border-gray-200 rounded px-2 py-1"
            />
          </div>
        </div>

        {!isClosed && (
          <div className="flex gap-2">
            <button
              onClick={() => void updateDeal({ is_closed_won: true })}
              disabled={saving}
              className="px-4 py-1.5 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50"
            >
              Mark Won
            </button>
            <button
              onClick={() => void updateDeal({ is_closed_lost: true })}
              disabled={saving}
              className="px-4 py-1.5 text-xs font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 disabled:opacity-50"
            >
              Mark Lost
            </button>
          </div>
        )}
      </div>

      {/* Contact + Company */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <span className="text-[10px] font-medium text-gray-400 uppercase">Contact</span>
          {deal.contact_id && deal.contact_name ? (
            <Link
              href={`/contacts/${deal.contact_id}`}
              className="block text-sm font-medium text-teal-600 hover:text-teal-700 mt-1"
            >
              {deal.contact_name}
            </Link>
          ) : (
            <p className="text-sm text-gray-400 mt-1">{'\u2014'}</p>
          )}
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <span className="text-[10px] font-medium text-gray-400 uppercase">Company</span>
          {deal.company_id && deal.company_name ? (
            <Link
              href={`/companies/${deal.company_id}`}
              className="block text-sm font-medium text-teal-600 hover:text-teal-700 mt-1"
            >
              {deal.company_name}
            </Link>
          ) : (
            <p className="text-sm text-gray-400 mt-1">{'\u2014'}</p>
          )}
        </div>
      </div>

      {/* Notes */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-6">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">Notes</h3>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (notes !== (deal.notes ?? '')) void updateDeal({ notes })
          }}
          rows={3}
          placeholder="Add notes..."
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 placeholder-gray-300 resize-none"
        />
      </div>

      {/* Activity */}
      {deal.contact_id && (
        <div className="bg-white rounded-xl border border-gray-100">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">Activity</h3>
          </div>
          <ActivityTimeline contactId={deal.contact_id} />
        </div>
      )}
    </div>
  )
}
