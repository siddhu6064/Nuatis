import DuplicatesReviewer from '@/components/contacts/DuplicatesReviewer'
import Link from 'next/link'

export default function DuplicatesPage() {
  return (
    <div className="px-8 py-8 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/contacts" className="text-ink4 hover:text-ink3 text-sm">
          &larr; Contacts
        </Link>
      </div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-ink">Duplicate Contacts</h1>
        <p className="text-sm text-ink3 mt-0.5">
          Review and merge contacts that may be duplicates.
        </p>
      </div>
      <DuplicatesReviewer />
    </div>
  )
}
