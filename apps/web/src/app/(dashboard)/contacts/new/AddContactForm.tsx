'use client'

import Link from 'next/link'
import { useFormStatus } from 'react-dom'
import { createContact } from '../actions'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {pending ? 'Saving…' : 'Save Contact'}
    </button>
  )
}

export default function AddContactForm() {
  return (
    <div className="max-w-lg">
      <div className="bg-white rounded-xl border border-border-brand p-6">
        <form action={createContact} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink2 mb-1.5">
              Full Name <span className="text-red-500">*</span>
            </label>
            <input
              name="full_name"
              type="text"
              required
              autoFocus
              placeholder="Jane Smith"
              className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent placeholder:text-gray-300"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-ink2 mb-1.5">Email</label>
            <input
              name="email"
              type="email"
              placeholder="jane@example.com"
              className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent placeholder:text-gray-300"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-ink2 mb-1.5">Phone</label>
            <input
              name="phone"
              type="tel"
              placeholder="(555) 000-0000"
              className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent placeholder:text-gray-300"
            />
          </div>

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
