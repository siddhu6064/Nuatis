'use client'

import { useState, useEffect, useCallback } from 'react'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import type { ExpenseCategory } from '@/components/expenses/types'

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function firstOfMonth(): string {
  const d = new Date()
  return isoDate(new Date(d.getFullYear(), d.getMonth(), 1))
}

export default function AccountingExportPage() {
  const [startDate, setStartDate] = useState(firstOfMonth())
  const [endDate, setEndDate] = useState(isoDate(new Date()))
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [glCodes, setGlCodes] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)

  const loadCategories = useCallback(() => {
    fetch('/api/expense-categories')
      .then((r) => r.json())
      .then((data: { data: ExpenseCategory[] }) => {
        setCategories(data.data)
        setGlCodes(Object.fromEntries(data.data.map((c) => [c.id, c.gl_code ?? ''])))
      })
  }, [])

  useEffect(() => {
    loadCategories()
  }, [loadCategories])

  async function saveGlCode(id: string) {
    setSavingId(id)
    try {
      await fetch(`/api/expense-categories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gl_code: glCodes[id]?.trim() || null }),
      })
    } finally {
      setSavingId(null)
    }
  }

  async function handleDownload() {
    setError(null)
    setDownloading(true)
    try {
      const res = await fetch(`/api/accounting-export?start_date=${startDate}&end_date=${endDate}`)
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        setError(err.error ?? 'Failed to generate export')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `accounting-export-${startDate}-to-${endDate}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setError('Could not reach the server')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="px-8 py-8 max-w-2xl">
      <h1 className="text-xl font-bold text-ink mb-1">Accounting Export</h1>
      <p className="text-sm text-ink3 mb-6">
        Download a QuickBooks/Xero-compatible journal CSV (Date, Description, Account, Debit,
        Credit) built from your payments and expenses.
      </p>

      <div className="bg-white rounded-xl border border-border-brand p-5 mb-6">
        <div className="flex items-end gap-3">
          <TextField
            label="Start date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            size="small"
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="End date"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            size="small"
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <Button onClick={() => void handleDownload()} disabled={downloading} variant="contained">
            {downloading ? 'Generating…' : 'Download CSV'}
          </Button>
        </div>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      </div>

      <div className="bg-white rounded-xl border border-border-brand p-5">
        <h2 className="text-sm font-semibold text-ink mb-1">Chart of accounts mapping</h2>
        <p className="text-xs text-ink3 mb-3">
          Map each expense category to a GL code. Categories without one export under their name.
        </p>
        <div className="space-y-2">
          {categories.map((c) => (
            <div key={c.id} className="flex items-center gap-2">
              <span className="text-sm text-ink flex-1">{c.name}</span>
              <TextField
                placeholder="GL code"
                value={glCodes[c.id] ?? ''}
                onChange={(e) => setGlCodes((prev) => ({ ...prev, [c.id]: e.target.value }))}
                onBlur={() => void saveGlCode(c.id)}
                size="small"
                sx={{ width: 140 }}
                disabled={savingId === c.id}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
