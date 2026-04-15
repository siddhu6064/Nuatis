'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface SmsMessage {
  id: string
  body: string
  direction: string
  status: string
  created_at: string
  from_number: string
  to_number: string
}

interface Props {
  contactId: string
  contactName: string
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

function formatDateSep(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diff = today.getTime() - msgDay.getTime()
  if (diff === 0) return 'Today'
  if (diff === 86400000) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function isSameDay(a: string, b: string): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}

export default function SmsThread({ contactId, contactName }: Props) {
  const [messages, setMessages] = useState<SmsMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const fetchMessages = useCallback(async () => {
    const res = await fetch(`/api/contacts/${contactId}/sms`)
    if (res.ok) {
      const data = (await res.json()) as { messages: SmsMessage[]; unread_count: number }
      setMessages(data.messages)
    }
  }, [contactId])

  useEffect(() => {
    setLoading(true)
    void fetchMessages().finally(() => setLoading(false))
    // Mark as read (fire-and-forget)
    void fetch(`/api/contacts/${contactId}/sms/read`, { method: 'POST' })
  }, [contactId, fetchMessages])

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = async () => {
    const msg = input.trim()
    if (!msg) return
    setSending(true)

    // Optimistic add
    const optimistic: SmsMessage = {
      id: `temp-${Date.now()}`,
      body: msg,
      direction: 'outbound',
      status: 'sending',
      created_at: new Date().toISOString(),
      from_number: '',
      to_number: '',
    }
    setMessages((prev) => [...prev, optimistic])
    setInput('')

    try {
      const res = await fetch(`/api/contacts/${contactId}/sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      })

      if (res.ok) {
        // Replace optimistic with real
        void fetchMessages()
      } else {
        // Mark as failed
        setMessages((prev) =>
          prev.map((m) => (m.id === optimistic.id ? { ...m, status: 'failed' } : m))
        )
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === optimistic.id ? { ...m, status: 'failed' } : m))
      )
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const initials = contactName
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

  if (loading)
    return <div className="py-6 text-center text-sm text-gray-400">Loading messages...</div>

  return (
    <div className="flex flex-col h-[500px]">
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-gray-400">
              No messages yet &mdash; send the first message below
            </p>
          </div>
        ) : (
          messages.map((msg, i) => {
            const showDateSep = i === 0 || !isSameDay(messages[i - 1]!.created_at, msg.created_at)
            const isInbound = msg.direction === 'inbound'

            return (
              <div key={msg.id}>
                {showDateSep && (
                  <div className="flex items-center gap-2 my-3">
                    <div className="flex-1 h-px bg-gray-100" />
                    <span className="text-[10px] text-gray-400 font-medium">
                      {formatDateSep(msg.created_at)}
                    </span>
                    <div className="flex-1 h-px bg-gray-100" />
                  </div>
                )}
                <div className={`flex ${isInbound ? 'justify-start' : 'justify-end'} mb-1`}>
                  <div
                    className={`flex items-end gap-1.5 max-w-[75%] ${isInbound ? '' : 'flex-row-reverse'}`}
                  >
                    {isInbound && (
                      <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center shrink-0 mb-0.5">
                        <span className="text-[9px] font-bold text-gray-500">{initials}</span>
                      </div>
                    )}
                    <div>
                      <div
                        className={`px-3 py-2 rounded-2xl text-sm ${
                          isInbound
                            ? 'bg-gray-100 text-gray-800 rounded-bl-md'
                            : 'bg-teal-600 text-white rounded-br-md'
                        } ${msg.status === 'failed' ? 'opacity-60 border border-red-300' : ''}`}
                      >
                        <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                      </div>
                      <div
                        className={`flex items-center gap-1 mt-0.5 ${isInbound ? '' : 'justify-end'}`}
                      >
                        <span className="text-[9px] text-gray-400">
                          {formatTime(msg.created_at)}
                        </span>
                        {msg.status === 'sending' && (
                          <span className="text-[9px] text-gray-400">Sending...</span>
                        )}
                        {msg.status === 'failed' && (
                          <span className="text-[9px] text-red-500">Failed</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Send input */}
      <div className="border-t border-gray-100 px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            maxLength={320}
            rows={1}
            placeholder="Send a message..."
            className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 resize-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 placeholder-gray-400"
          />
          <button
            onClick={() => void handleSend()}
            disabled={!input.trim() || sending}
            className="px-3 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50 shrink-0 text-sm"
          >
            {'\u2191'}
          </button>
        </div>
        {input.length > 280 && (
          <p className="text-[10px] text-gray-400 mt-1 text-right">{input.length}/320</p>
        )}
      </div>
    </div>
  )
}
