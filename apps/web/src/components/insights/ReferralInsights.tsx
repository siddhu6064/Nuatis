'use client'

import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import Link from 'next/link'

interface ReferralData {
  top_sources: Array<{ source: string; count: number; revenue: number }>
  top_referrers: Array<{
    contact_id: string
    contact_name: string
    referral_count: number
    revenue_generated: number
  }>
  total_referred: number
  referral_conversion_rate: number
}

export default function ReferralInsights() {
  const [data, setData] = useState<ReferralData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void fetch('/api/insights/referrals')
      .then((r) => r.json())
      .then((d: ReferralData) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return null
  if (!data || (data.total_referred === 0 && data.top_sources.length === 0)) return null

  return (
    <div className="mt-10">
      <h2 className="text-lg font-bold text-gray-900 mb-4">Referrals</h2>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 mb-1">Total Referred Contacts</p>
          <p className="text-2xl font-bold text-gray-900">{data.total_referred}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 mb-1">Referral Conversion Rate</p>
          <p className="text-2xl font-bold text-teal-600">{data.referral_conversion_rate}%</p>
          <p className="text-[11px] text-gray-400 mt-1">Referred contacts with appointments</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 mb-1">Top Sources</p>
          <p className="text-2xl font-bold text-gray-900">{data.top_sources.length}</p>
        </div>
      </div>

      {/* Top Sources chart */}
      {data.top_sources.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Top Referral Sources</h3>
          <ResponsiveContainer width="100%" height={Math.max(200, data.top_sources.length * 36)}>
            <BarChart data={data.top_sources} layout="vertical" margin={{ left: 80 }}>
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="source" tick={{ fontSize: 11 }} width={80} />
              <Tooltip
                contentStyle={{ fontSize: 12 }}
                formatter={(value) => [String(value), 'Contacts']}
              />
              <Bar dataKey="count" fill="#0d9488" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Top Referrers table */}
      {data.top_referrers.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Top Referrers</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-medium text-gray-400 pb-2">Contact</th>
                <th className="text-left text-xs font-medium text-gray-400 pb-2">Referrals</th>
              </tr>
            </thead>
            <tbody>
              {data.top_referrers.map((r) => (
                <tr key={r.contact_id} className="border-b border-gray-50 last:border-0">
                  <td className="py-2">
                    <Link
                      href={`/contacts/${r.contact_id}`}
                      className="text-teal-600 hover:text-teal-700 font-medium"
                    >
                      {r.contact_name}
                    </Link>
                  </td>
                  <td className="py-2 text-gray-600">{r.referral_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
