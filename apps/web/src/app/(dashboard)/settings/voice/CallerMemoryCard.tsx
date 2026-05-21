'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

interface MemoryRow {
  id: string
  phone_masked: string
  name: string | null
  call_count: number
  last_call_at: string | null
  summary_excerpt: string | null
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 2) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function CallerMemoryCard({
  initialMemoryEnabled,
}: {
  initialMemoryEnabled: boolean
}) {
  const router = useRouter()
  const [memoryEnabled, setMemoryEnabled] = useState(initialMemoryEnabled)
  const [toggling, setToggling] = useState(false)
  const [rows, setRows] = useState<MemoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchMemory = useCallback(async () => {
    try {
      const res = await fetch('/api/caller-memory?limit=5', { credentials: 'include' })
      if (res.ok) {
        const json = (await res.json()) as { data: MemoryRow[] }
        setRows(json.data)
      }
    } catch {
      // silent — table just stays empty
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchMemory()
  }, [fetchMemory])

  async function toggleMemory() {
    setToggling(true)
    setError(null)
    try {
      const res = await fetch('/api/maya-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maya_memory_enabled: !memoryEnabled }),
      })
      if (res.ok) {
        setMemoryEnabled((v) => !v)
        router.refresh()
      } else {
        const data = (await res.json()) as { error?: string }
        setError(data.error ?? 'Failed to toggle')
      }
    } catch {
      setError('Failed to toggle caller memory')
    } finally {
      setToggling(false)
    }
  }

  return (
    <div className="max-w-xl space-y-6 mt-6">
      {/* Toggle card */}
      <div className="bg-white rounded-xl border border-border-brand p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">Enable caller memory</h2>
            <p className="text-xs text-ink4 mt-0.5 max-w-xs">
              Maya remembers returning callers and personalises each conversation using context from
              previous calls.
            </p>
          </div>
          <button
            onClick={toggleMemory}
            disabled={toggling}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:opacity-50 ${
              memoryEnabled ? 'bg-teal-600' : 'bg-bg3'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                memoryEnabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
        {error && (
          <p className="mt-2 text-xs text-red-600">{error}</p>
        )}
      </div>

      {/* Memory table card */}
      <div className="bg-white rounded-xl border border-border-brand p-6">
        <h2 className="text-sm font-semibold text-ink mb-1">Recent caller memories</h2>
        <p className="text-xs text-ink4 mb-4">
          Caller context Maya has built from past conversations
        </p>

        {loading ? (
          <div className="space-y-3 animate-pulse">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-10 bg-bg rounded-lg" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-ink4 py-4 text-center">
            No caller memories yet — Maya builds memory automatically after each call.
          </p>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-brand">
                  <th className="text-left text-xs font-medium text-ink3 pb-2 pr-4">Phone</th>
                  <th className="text-left text-xs font-medium text-ink3 pb-2 pr-4">Name</th>
                  <th className="text-left text-xs font-medium text-ink3 pb-2 pr-4">Calls</th>
                  <th className="text-left text-xs font-medium text-ink3 pb-2 pr-4">Last Call</th>
                  <th className="text-left text-xs font-medium text-ink3 pb-2 pr-4">Memory</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-2.5 pr-4 font-mono text-xs text-ink whitespace-nowrap">
                      {row.phone_masked}
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-ink whitespace-nowrap">
                      {row.name ?? <span className="text-ink4">Unknown</span>}
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-ink tabular-nums">{row.call_count}</td>
                    <td className="py-2.5 pr-4 text-xs text-ink4 whitespace-nowrap">
                      {relativeTime(row.last_call_at)}
                    </td>
                    <td className="py-2.5 pr-4 text-xs text-ink4 max-w-[200px] truncate">
                      {row.summary_excerpt ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
