'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

interface Deal {
  id: string
  title: string
  value: number
  stage_name: string | null
  stage_color: string | null
  close_date: string | null
  probability: number
  is_closed_won: boolean
  is_closed_lost: boolean
}

interface Props {
  contactId: string
}

export default function ContactDeals({ contactId }: Props) {
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)

  const fetchDeals = useCallback(async () => {
    const res = await fetch(`/api/deals?contact_id=${contactId}`)
    if (res.ok) {
      const data = (await res.json()) as { deals: Deal[] }
      setDeals(data.deals)
    }
  }, [contactId])

  useEffect(() => {
    setLoading(true)
    void fetchDeals().finally(() => setLoading(false))
  }, [fetchDeals])

  if (loading) return <div className="py-4 text-center text-sm text-gray-400">Loading deals...</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-700">Deals</h3>
        <Link
          href={`/deals?contact_id=${contactId}`}
          className="text-xs text-teal-600 hover:text-teal-700 font-medium"
        >
          + New deal
        </Link>
      </div>

      {deals.length === 0 ? (
        <p className="text-xs text-gray-400 py-2">No deals linked to this contact</p>
      ) : (
        <div className="space-y-2">
          {deals.map((deal) => (
            <Link
              key={deal.id}
              href={`/deals/${deal.id}`}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{deal.title}</p>
                <p className="text-xs text-teal-600 font-semibold">
                  ${Number(deal.value).toLocaleString()}
                </p>
              </div>
              {deal.stage_name && (
                <span
                  className="px-2 py-0.5 rounded text-[10px] font-medium"
                  style={{
                    backgroundColor: `${deal.stage_color ?? '#9ca3af'}20`,
                    color: deal.stage_color ?? '#6b7280',
                  }}
                >
                  {deal.stage_name}
                </span>
              )}
              {(deal.is_closed_won || deal.is_closed_lost) && (
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    deal.is_closed_won ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {deal.is_closed_won ? 'Won' : 'Lost'}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
