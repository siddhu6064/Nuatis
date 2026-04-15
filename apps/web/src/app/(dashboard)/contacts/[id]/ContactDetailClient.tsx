'use client'

import { useState, useCallback } from 'react'
import AddNoteForm from '@/components/contacts/AddNoteForm'
import ContactTasks from '@/components/contacts/ContactTasks'
import ActivityTimeline from '@/components/contacts/ActivityTimeline'

interface Props {
  contactId: string
}

export default function ContactDetailClient({ contactId }: Props) {
  const [refreshKey, setRefreshKey] = useState(0)

  const handleNoteAdded = useCallback(() => {
    setRefreshKey((k) => k + 1)
  }, [])

  return (
    <>
      {/* Add Note */}
      <div className="mb-6">
        <AddNoteForm contactId={contactId} onNoteAdded={handleNoteAdded} />
      </div>

      {/* Tasks */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-6">
        <ContactTasks contactId={contactId} />
      </div>

      {/* Activity Timeline */}
      <div className="bg-white rounded-xl border border-gray-100">
        <div className="px-4 py-3 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Activity</h2>
        </div>
        <ActivityTimeline contactId={contactId} refreshKey={refreshKey} />
      </div>
    </>
  )
}
