'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Button from '@mui/material/Button'
import { getInitials } from '@nuatis/shared'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'agent'
  content: string
  created_at: string
}

interface SessionDetail {
  id: string
  status: string
  mode: 'ai' | 'human'
  visitor_name: string | null
  visitor_email: string | null
  handoff_requested_at: string | null
  handoff_reason: string | null
  started_at: string
}

interface Props {
  sessionId: string
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function ChatThread({ sessionId }: Props) {
  const router = useRouter()
  const [session, setSession] = useState<SessionDetail | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [modeSaving, setModeSaving] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastCursorRef = useRef<string | null>(null)

  const fetchThread = useCallback(async () => {
    const res = await fetch(`/api/webchat/sessions/${sessionId}`)
    if (!res.ok) return
    const data = (await res.json()) as { session: SessionDetail; messages: ChatMessage[] }
    setSession(data.session)
    setMessages(data.messages)
    lastCursorRef.current = data.messages.at(-1)?.created_at ?? null
  }, [sessionId])

  useEffect(() => {
    setLoading(true)
    void fetchThread().finally(() => setLoading(false))
  }, [fetchThread])

  const poll = useCallback(async () => {
    const after = lastCursorRef.current
    const url = after
      ? `/api/webchat/sessions/${sessionId}/messages?after=${encodeURIComponent(after)}`
      : `/api/webchat/sessions/${sessionId}/messages`
    const res = await fetch(url)
    if (!res.ok) return
    const data = (await res.json()) as { messages: ChatMessage[]; mode: 'ai' | 'human' }
    if (data.messages.length) {
      setMessages((prev) => [...prev, ...data.messages])
      lastCursorRef.current = data.messages.at(-1)?.created_at ?? lastCursorRef.current
    }
    setSession((prev) => (prev ? { ...prev, mode: data.mode } : prev))
  }, [sessionId])

  useEffect(() => {
    const t = setInterval(() => void poll(), 5000)
    return () => clearInterval(t)
  }, [poll])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = async () => {
    const body = input.trim()
    if (!body) return
    setSending(true)
    setInput('')
    try {
      const res = await fetch(`/api/webchat/sessions/${sessionId}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      })
      if (res.ok) {
        const data = (await res.json()) as { message: ChatMessage; mode: 'ai' | 'human' }
        setMessages((prev) => [...prev, data.message])
        lastCursorRef.current = data.message.created_at
        setSession((prev) => (prev ? { ...prev, mode: data.mode } : prev))
      }
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

  async function toggleMode() {
    if (!session) return
    const nextMode = session.mode === 'human' ? 'ai' : 'human'
    setModeSaving(true)
    try {
      const res = await fetch(`/api/webchat/sessions/${sessionId}/mode`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: nextMode }),
      })
      if (res.ok) {
        setSession((prev) => (prev ? { ...prev, mode: nextMode } : prev))
      }
    } finally {
      setModeSaving(false)
    }
  }

  async function handleClose() {
    await fetch(`/api/webchat/sessions/${sessionId}/close`, { method: 'POST' })
    router.push('/inbox')
  }

  if (loading) {
    return <div className="py-12 text-center text-sm text-ink4">Loading conversation...</div>
  }

  if (!session) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-ink3">Conversation not found.</p>
        <Button size="small" onClick={() => router.push('/inbox')} sx={{ mt: 1 }}>
          Back to inbox
        </Button>
      </div>
    )
  }

  const visitorLabel = session.visitor_name ?? 'Website Visitor'

  return (
    <div className="bg-white rounded-xl border border-border-brand flex flex-col h-[600px]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border-brand flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={() => router.push('/inbox')}
            className="text-ink4 hover:text-ink text-sm shrink-0"
            aria-label="Back to inbox"
          >
            &larr;
          </button>
          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
            <span className="text-blue-700 text-xs font-bold">
              {getInitials(visitorLabel) || 'W'}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink truncate">{visitorLabel}</p>
            {session.visitor_email && (
              <p className="text-xs text-ink4 truncate">{session.visitor_email}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`text-[10px] px-2 py-1 rounded-full font-medium ${
              session.mode === 'human' ? 'bg-teal-100 text-teal-700' : 'bg-bg2 text-ink3'
            }`}
          >
            {session.mode === 'human' ? "You're handling this" : 'AI handling'}
          </span>
          <Button
            size="small"
            variant="outlined"
            disabled={modeSaving}
            onClick={() => void toggleMode()}
          >
            {session.mode === 'human' ? 'Hand back to AI' : 'Take over'}
          </Button>
        </div>
      </div>

      {session.handoff_requested_at && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-800 shrink-0">
          Visitor requested a human{session.handoff_reason ? `: ${session.handoff_reason}` : ''}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-ink4">No messages yet</p>
          </div>
        ) : (
          messages.map((m) => {
            const isVisitor = m.role === 'user'
            return (
              <div
                key={m.id}
                className={`flex ${isVisitor ? 'justify-start' : 'justify-end'} mb-1`}
              >
                <div className="max-w-[75%]">
                  <div
                    className={`px-3 py-2 rounded-2xl text-sm ${
                      isVisitor
                        ? 'bg-bg2 text-ink rounded-bl-md'
                        : m.role === 'agent'
                          ? 'bg-teal-600 text-white rounded-br-md'
                          : 'bg-blue-50 text-blue-900 rounded-br-md'
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  </div>
                  <div
                    className={`flex items-center gap-1 mt-0.5 ${isVisitor ? '' : 'justify-end'}`}
                  >
                    <span className="text-[9px] text-ink4">
                      {m.role === 'assistant' ? 'AI · ' : m.role === 'agent' ? 'You · ' : ''}
                      {formatTime(m.created_at)}
                    </span>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Reply input */}
      <div className="border-t border-border-brand px-4 py-3 shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder="Reply to visitor..."
            className="w-full text-sm border border-border-brand rounded-lg px-3 py-2 resize-none focus:ring-1 focus:ring-teal-500 focus:border-teal-500 placeholder-gray-400"
          />
          <Button
            onClick={() => void handleSend()}
            disabled={!input.trim() || sending}
            variant="contained"
            sx={{ minWidth: 0, px: 1.5, flexShrink: 0 }}
          >
            {'↑'}
          </Button>
        </div>
        <div className="flex justify-end mt-1.5">
          <Button size="small" onClick={() => void handleClose()} sx={{ color: 'text.secondary' }}>
            Close conversation
          </Button>
        </div>
      </div>
    </div>
  )
}
