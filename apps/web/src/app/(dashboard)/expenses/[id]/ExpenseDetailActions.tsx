'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@mui/material/Button'

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

interface Props {
  expenseId: string
  hasReceipt: boolean
}

export default function ExpenseDetailActions({ expenseId, hasReceipt }: Props) {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function handleReceiptSelected(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const receipt_data = await readFileAsBase64(file)
      const res = await fetch(`/api/expenses/${expenseId}/receipt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receipt_data,
          receipt_filename: file.name,
          receipt_file_type: file.type,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error ?? 'Failed to upload receipt')
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload receipt')
    } finally {
      setBusy(false)
    }
  }

  async function handleRemoveReceipt() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/expenses/${expenseId}/receipt`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to remove receipt')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove receipt')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!confirm('Delete this expense? This cannot be undone.')) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/expenses/${expenseId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete expense')
      router.push('/expenses')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete expense')
      setBusy(false)
    }
  }

  return (
    <div>
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2.5 text-sm text-red-700 mb-4">
          {error}
        </div>
      )}
      <div className="flex items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,.doc,.docx"
          className="hidden"
          onChange={(e) => void handleReceiptSelected(e.target.files?.[0])}
        />
        <Button
          variant="outlined"
          size="small"
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          {hasReceipt ? 'Replace Receipt' : 'Add Receipt'}
        </Button>
        {hasReceipt && (
          <Button
            variant="text"
            size="small"
            color="error"
            disabled={busy}
            onClick={() => void handleRemoveReceipt()}
          >
            Remove Receipt
          </Button>
        )}
        <Button
          variant="text"
          size="small"
          color="error"
          disabled={busy}
          onClick={() => void handleDelete()}
          sx={{ ml: 'auto' }}
        >
          Delete Expense
        </Button>
      </div>
    </div>
  )
}
