'use client'

import { useState } from 'react'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'

interface StaffOption {
  id: string
  name: string
}

interface Props {
  orderId: string
  staff: StaffOption[]
  initialStaffId: string | null
  initialStaffName: string | null
}

export default function OrderStaffControl({ orderId, staff, initialStaffId }: Props) {
  const [staffId, setStaffId] = useState(initialStaffId ?? '')
  const [saving, setSaving] = useState(false)

  async function handleChange(value: string) {
    setStaffId(value)
    setSaving(true)
    try {
      await fetch(`/api/orders/${orderId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assigned_staff_id: value || null }),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <TextField
      select
      label="Staff"
      value={staffId}
      onChange={(e) => void handleChange(e.target.value)}
      disabled={saving}
      size="small"
      sx={{ minWidth: 180 }}
    >
      <MenuItem value="">— Unassigned —</MenuItem>
      {staff.map((s) => (
        <MenuItem key={s.id} value={s.id}>
          {s.name}
        </MenuItem>
      ))}
    </TextField>
  )
}
