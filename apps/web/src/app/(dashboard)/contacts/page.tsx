import { Suspense } from 'react'
import ContactsList from '@/components/contacts/ContactsList'

export default function ContactsPage() {
  return (
    <Suspense fallback={<div className="px-8 py-8 text-sm text-gray-400">Loading...</div>}>
      <ContactsList />
    </Suspense>
  )
}
