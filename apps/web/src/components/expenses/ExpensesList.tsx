'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import { formatCurrency } from '@nuatis/shared'
import type { Expense, ExpenseCategory } from './types'

export default function ExpensesList() {
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [categoryFilter, setCategoryFilter] = useState('')
  const [vendorQuery, setVendorQuery] = useState('')

  const fetchExpenses = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (categoryFilter) params.set('category_id', categoryFilter)
      if (vendorQuery) params.set('q', vendorQuery)
      const res = await fetch(`/api/expenses?${params.toString()}`)
      if (res.ok) {
        const data = (await res.json()) as { data: Expense[] }
        setExpenses(data.data)
      }
    } finally {
      setLoading(false)
    }
  }, [categoryFilter, vendorQuery])

  useEffect(() => {
    fetch('/api/expense-categories')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { data: ExpenseCategory[] } | null) => {
        if (data) setCategories(data.data)
      })
  }, [])

  useEffect(() => {
    void fetchExpenses()
  }, [fetchExpenses])

  const total = expenses.reduce((sum, e) => sum + Number(e.amount), 0)

  return (
    <div className="px-8 py-8 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h1 className="text-xl font-bold text-ink">Expenses</h1>
          <p className="text-sm text-ink3 mt-0.5">
            {expenses.length} expense{expenses.length !== 1 ? 's' : ''} · {formatCurrency(total)}
          </p>
        </div>
        <Button component={Link} href="/expenses/new" variant="contained">
          + Log Expense
        </Button>
      </div>

      <div className="flex items-center gap-3 mb-4 shrink-0">
        <TextField
          select
          label="Category"
          size="small"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">All categories</MenuItem>
          {categories.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {c.name}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label="Search vendor"
          size="small"
          value={vendorQuery}
          onChange={(e) => setVendorQuery(e.target.value)}
          sx={{ minWidth: 200 }}
        />
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-ink4">Loading...</div>
      ) : expenses.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-ink4 mb-3">No expenses logged yet.</p>
            <Button component={Link} href="/expenses/new" variant="contained" size="small">
              Log your first expense
            </Button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-border-brand overflow-hidden flex-1 overflow-y-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-brand sticky top-0 bg-white">
                <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Expense</th>
                <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Vendor</th>
                <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Category</th>
                <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Date</th>
                <th className="text-right text-xs font-medium text-ink4 px-6 py-3">Amount</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr
                  key={e.id}
                  className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50"
                >
                  <td className="px-6 py-4 text-sm font-medium text-ink">
                    <Link href={`/expenses/${e.id}`} className="hover:text-teal-700">
                      {e.expense_number}
                    </Link>
                    {e.recurring_expense_id && (
                      <span className="ml-2 font-mono text-[9px] px-1.5 py-0.5 rounded uppercase tracking-wide bg-teal-50 text-teal-600">
                        RECURRING
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-ink3">{e.vendor ?? '—'}</td>
                  <td className="px-6 py-4 text-sm text-ink3">
                    {e.expense_categories?.name ?? 'Uncategorized'}
                  </td>
                  <td className="px-6 py-4 text-sm text-ink4">
                    {new Date(e.expense_date).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                      timeZone: 'UTC',
                    })}
                  </td>
                  <td className="px-6 py-4 text-sm text-ink text-right font-medium">
                    {formatCurrency(Number(e.amount))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
