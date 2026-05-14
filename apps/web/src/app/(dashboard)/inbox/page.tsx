import InboxList from '@/components/inbox/InboxList'

export default function InboxPage() {
  return (
    <div className="px-8 py-8 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-ink">Inbox</h1>
        <p className="text-sm text-ink3 mt-0.5">Unread SMS conversations</p>
      </div>
      <InboxList />
    </div>
  )
}
