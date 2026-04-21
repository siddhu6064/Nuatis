'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'

type ExportStatus = 'pending' | 'processing' | 'completed' | 'failed'

interface ExportJob {
  id: string
  created_at: string
  status: ExportStatus
  file_size_bytes: number | null
  tables: string[]
}

const TABLES = [
  { key: 'contacts', label: 'Contacts' },
  { key: 'activity_log', label: 'Activity Log' },
  { key: 'appointments', label: 'Appointments' },
  { key: 'deals', label: 'Deals' },
  { key: 'quotes', label: 'Quotes' },
  { key: 'tasks', label: 'Tasks' },
]

const STATUS_STYLES: Record<ExportStatus, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-yellow-50', text: 'text-yellow-700', label: 'Pending' },
  processing: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Processing' },
  completed: { bg: 'bg-green-50', text: 'text-green-700', label: 'Completed' },
  failed: { bg: 'bg-red-50', text: 'text-red-600', label: 'Failed' },
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export default function DataExportPage() {
  const { data: session } = useSession()
  const [selectedTables, setSelectedTables] = useState<string[]>(TABLES.map((t) => t.key))
  const [exporting, setExporting] = useState(false)
  const [history, setHistory] = useState<ExportJob[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const token = (session as unknown as Record<string, unknown>)?.accessToken ?? ''
  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token as string}` } : {}),
  }

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }

  const fetchHistory = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`/api/settings/data-export`, { headers: authHeaders })
      if (res.ok) {
        const data: ExportJob[] = await res.json()
        setHistory(data)
      }
    } catch {
      // silently fail
    } finally {
      setHistoryLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (token) fetchHistory()
  }, [token, fetchHistory])

  function toggleTable(key: string) {
    setSelectedTables((prev) =>
      prev.includes(key) ? prev.filter((t) => t !== key) : [...prev, key]
    )
  }

  async function startExport() {
    if (selectedTables.length === 0) {
      showToast('error', 'Select at least one table to export')
      return
    }
    setExporting(true)
    try {
      const res = await fetch(`/api/settings/data-export`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ tables: selectedTables }),
      })
      if (res.ok) {
        const job: ExportJob = await res.json()
        setHistory((prev) => [job, ...prev])
        showToast('success', 'Export started — you will be notified when it is ready')
      } else {
        const d = await res.json().catch(() => ({}))
        showToast('error', (d as { error?: string }).error || 'Failed to start export')
      }
    } catch {
      showToast('error', 'Failed to start export')
    } finally {
      setExporting(false)
    }
  }

  function downloadExport(id: string) {
    window.open(`/api/settings/data-export/${id}/download`, '_blank')
  }

  return (
    <div className="px-8 py-8 max-w-2xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900 mb-1">Data Export</h1>
        <p className="text-sm text-gray-500">Download a copy of your data in CSV format.</p>
      </div>

      {/* Table selection */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-900 mb-0.5">Select Tables</h2>
          <p className="text-xs text-gray-400">Choose which data to include in your export.</p>
        </div>

        <div className="space-y-2">
          {TABLES.map(({ key, label }) => (
            <label
              key={key}
              className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={selectedTables.includes(key)}
                onChange={() => toggleTable(key)}
                className="rounded text-teal-600 focus:ring-teal-500"
              />
              <span className="text-sm text-gray-800">{label}</span>
            </label>
          ))}
        </div>

        <div className="pt-2 space-y-3">
          <button
            onClick={startExport}
            disabled={exporting || selectedTables.length === 0}
            className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {exporting ? 'Export in progress...' : 'Export Data'}
          </button>

          <div className="space-y-1">
            <p className="text-xs text-gray-400">Files expire after 48 hours.</p>
            <p className="text-xs text-gray-400">
              This export is compliant with data portability requirements (GDPR Art. 20).
            </p>
          </div>
        </div>
      </div>

      {/* Export history */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Export History</h2>
        </div>

        {historyLoading ? (
          <div className="px-6 py-6 text-sm text-gray-400">Loading history...</div>
        ) : history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-sm font-medium text-gray-400">No exports yet</p>
            <p className="text-xs text-gray-300 mt-1">
              Your export history will appear here once you run your first export.
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Date</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Status</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">File Size</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Download</th>
              </tr>
            </thead>
            <tbody>
              {history.map((job) => {
                const badge = STATUS_STYLES[job.status] ?? STATUS_STYLES.failed
                const isExpired =
                  job.status === 'completed' &&
                  new Date(job.created_at).getTime() < Date.now() - 48 * 60 * 60 * 1000

                return (
                  <tr
                    key={job.id}
                    className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50"
                  >
                    <td className="px-6 py-3.5 text-xs text-gray-500 whitespace-nowrap">
                      {formatDate(job.created_at)}
                    </td>
                    <td className="px-6 py-3.5">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badge.bg} ${badge.text}`}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-6 py-3.5 text-xs text-gray-500">
                      {job.file_size_bytes != null ? formatBytes(job.file_size_bytes) : '—'}
                    </td>
                    <td className="px-6 py-3.5">
                      {job.status === 'completed' ? (
                        isExpired ? (
                          <span className="text-xs text-gray-400 italic">Expired</span>
                        ) : (
                          <button
                            onClick={() => downloadExport(job.id)}
                            className="text-xs font-medium text-teal-600 hover:text-teal-800 transition-colors"
                          >
                            Download
                          </button>
                        )
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium transition-all ${
            toast.type === 'success'
              ? 'bg-teal-600 text-white'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}
