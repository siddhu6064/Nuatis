import InboxList from '@/components/inbox/InboxList'
import ChatThread from '@/components/inbox/ChatThread'

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ chat?: string }>
}) {
  const { chat } = await searchParams

  return (
    <div className="px-8 py-8 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-ink">Inbox</h1>
        <p className="text-sm text-ink3 mt-0.5">
          {chat ? 'Webchat conversation' : 'Unread SMS conversations'}
        </p>
      </div>
      {chat ? <ChatThread sessionId={chat} /> : <InboxList />}
    </div>
  )
}
