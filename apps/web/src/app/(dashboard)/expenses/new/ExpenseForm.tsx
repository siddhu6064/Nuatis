'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import type { ExpenseCategory } from '@/components/expenses/types'

function todayLocal(): string {
  const d = new Date()
  const offset = d.getTimezoneOffset()
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10)
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function ExpenseForm() {
  const router = useRouter()
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [categoryId, setCategoryId] = useState('')
  const [amount, setAmount] = useState('')
  const [expenseDate, setExpenseDate] = useState(todayLocal())
  const [vendor, setVendor] = useState('')
  const [notes, setNotes] = useState('')
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/expense-categories')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { data: ExpenseCategory[] } | null) => {
        if (data) setCategories(data.data)
      })
  }, [])

  async function handleSubmit() {
    setError('')
    const amountNum = Number(amount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError('Amount must be a number greater than 0')
      return
    }

    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        amount: amountNum,
        category_id: categoryId || null,
        expense_date: expenseDate,
        vendor: vendor.trim() || null,
        notes: notes.trim() || null,
      }

      if (receiptFile) {
        body['receipt_data'] = await readFileAsBase64(receiptFile)
        body['receipt_filename'] = receiptFile.name
        body['receipt_file_type'] = receiptFile.type
      }

      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error ?? 'Failed to log expense')
      }

      const created = (await res.json()) as { id: string }
      router.push(`/expenses/${created.id}`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to log expense')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border-brand p-6 space-y-4">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex gap-4">
        <TextField
          label="Amount"
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          slotProps={{ htmlInput: { min: 0, step: 0.01 } }}
          fullWidth
        />
        <TextField
          label="Date"
          type="date"
          value={expenseDate}
          onChange={(e) => setExpenseDate(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          fullWidth
        />
      </div>

      <TextField
        select
        label="Category"
        value={categoryId}
        onChange={(e) => setCategoryId(e.target.value)}
        fullWidth
      >
        <MenuItem value="">Uncategorized</MenuItem>
        {categories.map((c) => (
          <MenuItem key={c.id} value={c.id}>
            {c.name}
          </MenuItem>
        ))}
      </TextField>

      <TextField
        label="Vendor"
        value={vendor}
        onChange={(e) => setVendor(e.target.value)}
        fullWidth
      />

      <TextField
        label="Notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        multiline
        minRows={2}
        fullWidth
      />

      <div>
        <label className="text-sm font-medium text-ink block mb-1.5">Receipt (optional)</label>
        <input
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,.doc,.docx"
          onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
          className="text-sm text-ink3"
        />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Button variant="outlined" onClick={() => router.back()} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={() => void handleSubmit()} disabled={saving}>
          {saving ? 'Saving...' : 'Log Expense'}
        </Button>
      </div>
    </div>
  )
}
