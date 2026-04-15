import DuplicatesReviewer from '@/components/contacts/DuplicatesReviewer'
import Link from 'next/link'

export default function DuplicatesPage() {
  return (
    <div className="px-8 py-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/contacts" className="text-gray-400 hover:text-gray-600 text-sm">
          &larr; Contacts
        </Link>
      </div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Duplicate Contacts</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Review and merge contacts that may be duplicates.
        </p>
      </div>
      <DuplicatesReviewer />
    </div>
  )
}
