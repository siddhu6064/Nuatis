'use client'

import { useState, useEffect, useCallback } from 'react'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Switch from '@mui/material/Switch'
import type { ExpenseCategory } from '@/components/expenses/types'
import RecurringExpensesPanel from './RecurringExpensesPanel'

export default function ExpensesSettingsPage() {
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const fetchCategories = useCallback(async () => {
    const res = await fetch('/api/expense-categories?include_archived=true')
    if (res.ok) {
      const data = (await res.json()) as { data: ExpenseCategory[] }
      setCategories(data.data)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchCategories()
  }, [fetchCategories])

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  async function handleAdd() {
    const name = newName.trim()
    if (!name) return
    setSaving(true)
    try {
      const res = await fetch('/api/expense-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error ?? 'Failed to add category')
      }
      setNewName('')
      await fetchCategories()
      setToast({ type: 'success', msg: 'Category added' })
    } catch (err) {
      setToast({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to add' })
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleArchive(category: ExpenseCategory) {
    const res = await fetch(`/api/expense-categories/${category.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_archived: !category.is_archived }),
    })
    if (res.ok) {
      await fetchCategories()
    } else {
      setToast({ type: 'error', msg: 'Failed to update category' })
    }
  }

  return (
    <div className="px-8 py-8 max-w-2xl">
      <h1 className="text-xl font-bold text-ink mb-1">Expense Settings</h1>
      <p className="text-sm text-ink4 mb-6">
        Manage expense categories and recurring expense rules.
      </p>

      <div className="bg-white rounded-xl border border-border-brand mb-8">
        <div className="px-5 py-4 border-b border-border-brand">
          <h2 className="text-sm font-semibold text-ink">Categories</h2>
        </div>
        <div className="px-5 py-4">
          {loading ? (
            <p className="text-sm text-ink4">Loading…</p>
          ) : (
            <div className="space-y-2">
              {categories.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0"
                >
                  <span
                    className={`text-sm ${c.is_archived ? 'text-ink4 line-through' : 'text-ink'}`}
                  >
                    {c.name}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ink4">
                      {c.is_archived ? 'Archived' : 'Active'}
                    </span>
                    <Switch
                      checked={!c.is_archived}
                      onChange={() => void handleToggleArchive(c)}
                      size="small"
                      slotProps={{ input: { 'aria-label': `Toggle ${c.name} active` } }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border-brand">
            <TextField
              size="small"
              placeholder="New category name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void handleAdd()}
              fullWidth
            />
            <Button
              variant="outlined"
              size="small"
              disabled={saving || !newName.trim()}
              onClick={() => void handleAdd()}
            >
              Add
            </Button>
          </div>
        </div>
      </div>

      <RecurringExpensesPanel categories={categories.filter((c) => !c.is_archived)} />

      {toast && (
        <div
          className={`fixed top-4 right-4 z-[60] px-4 py-2 text-sm rounded-lg shadow-lg ${
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
