'use client'

import Link from 'next/link'
import { useFormStatus } from 'react-dom'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import { createContact } from '../actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} variant="contained">
      {pending ? 'Saving…' : 'Save Contact'}
    </Button>
  )
}

export default function AddContactForm() {
  return (
    <div className="max-w-lg">
      <div className="bg-white rounded-xl border border-border-brand p-6">
        <form action={createContact} className="space-y-4">
          <TextField
            name="full_name"
            label="Full Name"
            required
            autoFocus
            placeholder="Jane Smith"
            fullWidth
          />

          <TextField
            name="email"
            type="email"
            label="Email"
            placeholder="jane@example.com"
            fullWidth
          />

          <TextField name="phone" type="tel" label="Phone" placeholder="(555) 000-0000" fullWidth />

          <div className="flex items-center gap-3 pt-2">
            <SubmitButton />
            <Link
              href="/contacts"
              className="px-4 py-2 text-sm text-ink3 hover:text-ink2 transition-colors"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
