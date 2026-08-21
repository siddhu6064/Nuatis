'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Switch from '@mui/material/Switch'

interface Props {
  quoteId: string
  requiresSignature: boolean
}

export default function QuoteSignatureToggle({ quoteId, requiresSignature }: Props) {
  const router = useRouter()
  const [checked, setChecked] = useState(requiresSignature)
  const [loading, setLoading] = useState(false)

  async function toggle(value: boolean) {
    setChecked(value)
    setLoading(true)
    try {
      await fetch(`/api/quotes/${quoteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requires_signature: value }),
      })
      router.refresh()
    } catch {
      // revert on error
      setChecked(!value)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-border-brand p-4 flex items-center gap-3 mb-6">
      <Switch
        checked={checked}
        disabled={loading}
        onChange={(e) => toggle(e.target.checked)}
        size="small"
      />
      <label className="cursor-pointer select-none">
        <span className="block text-sm font-medium text-ink">Require e-signature</span>
        <span className="block text-xs text-ink3 mt-0.5">
          Client must sign before quote is accepted.
        </span>
      </label>
      {loading && <span className="ml-auto text-xs text-ink4">Saving...</span>}
    </div>
  )
}
