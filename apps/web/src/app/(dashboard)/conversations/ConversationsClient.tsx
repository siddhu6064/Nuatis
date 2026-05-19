'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import SnippetPicker from '@/components/SnippetPicker'
import type { Conversation, ConversationMessage } from '@nuatis/shared'

type TabType = 'open' | 'resolved'

interface ContactDetail {
  id: string
  name: string | null
  phone: string
  email: string | null
  sms_opt_in: boolean
}

function formatTime(iso: string) {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffDays === 0) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'short' })
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function initials(name: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return (parts[0]![0] ?? '?').toUpperCase()
  return ((parts[0]![0] ?? '') + (parts[parts.length - 1]![0] ?? '')).toUpperCase()
}

export default function ConversationsClient() {
  const [tab, setTab] = useState<TabType>('open')
  const [search, setSearch] = useState('')
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [contact, setContact] = useState<ContactDetail | null>(null)
  const [msgLoading, setMsgLoading] = useState(false)
  const [compose, setCompose] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)

  const fetchConversations = useCallback(async () => {
    const r = await fetch(`/api/conversations?status=${tab}&limit=50`)
    if (!r.ok) return
    const d = (await r.json()) as { conversations: Conversation[] }
    setConversations(d.conversations)
    setLoading(false)
  }, [tab])

  const fetchMessages = useCallback(async (contactId: string) => {
    setMsgLoading(true)
    const r = await fetch(`/api/conversations/${contactId}/messages`)
    if (!r.ok) {
      setMsgLoading(false)
      return
    }
    const d = (await r.json()) as { messages: ConversationMessage[]; contact: ContactDetail }
    setMessages(d.messages)
    setContact(d.contact)
    setMsgLoading(false)
  }, [])

  useEffect(() => {
    setLoading(true)
    void fetchConversations()
  }, [fetchConversations])

  // Poll every 10s when tab visible
  useEffect(() => {
    const poll = () => {
      if (document.visibilityState !== 'visible') return
      void fetchConversations()
      if (selectedId) void fetchMessages(selectedId)
    }
    const id = setInterval(poll, 10000)
    return () => clearInterval(id)
  }, [fetchConversations, fetchMessages, selectedId])

  useEffect(() => {
    if (!selectedId) {
      setMessages([])
      setContact(null)
      return
    }
    void fetchMessages(selectedId)
  }, [selectedId, fetchMessages])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight
    }
  }, [messages])

  async function handleSend() {
    if (!selectedId || !compose.trim() || sending) return
    setSending(true)
    setSendError(null)
    const r = await fetch(`/api/conversations/${selectedId}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: compose.trim() }),
    })
    setSending(false)
    if (!r.ok) {
      const err = (await r.json()) as { error?: string }
      setSendError(err.error ?? 'Failed to send')
      return
    }
    setCompose('')
    void fetchMessages(selectedId)
    void fetchConversations()
  }

  async function handleResolve() {
    if (!selectedId) return
    await fetch(`/api/conversations/${selectedId}/resolve`, { method: 'POST' })
    setSelectedId(null)
    void fetchConversations()
  }

  async function handleReopen() {
    if (!selectedId) return
    await fetch(`/api/conversations/${selectedId}/reopen`, { method: 'POST' })
    setSelectedId(null)
    void fetchConversations()
  }

  const filtered = conversations.filter((c) => {
    if (!search) return true
    const s = search.toLowerCase()
    return (c.contact_name ?? '').toLowerCase().includes(s) || (c.contact_phone ?? '').includes(s)
  })

  const selected = conversations.find((c) => c.id === selectedId) ?? null

  return (
    <div
      className="grid divide-x divide-border-brand overflow-hidden"
      style={{ gridTemplateColumns: '320px 1fr', height: 'calc(100vh - 49px)' }}
    >
      {/* ── Left panel ── */}
      <div className="flex flex-col overflow-hidden">
        <div className="px-4 pt-4 pb-3 border-b border-border-brand shrink-0">
          <h1 className="text-base font-semibold text-ink mb-3">Conversations</h1>
          <div className="flex gap-1 mb-3">
            {(['open', 'resolved'] as TabType[]).map((t) => (
              <button
                key={t}
                onClick={() => {
                  setTab(t)
                  setSelectedId(null)
                }}
                className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-colors capitalize ${
                  tab === t ? 'bg-teal-600 text-white' : 'bg-bg text-ink3 hover:text-ink'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or phone…"
            className="w-full text-sm px-3 py-1.5 rounded-lg border border-border-brand bg-bg text-ink placeholder:text-ink4 focus:outline-none focus:ring-1 focus:ring-teal-500"
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32 text-ink4 text-sm">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-ink4 text-sm">
              No {tab} conversations
            </div>
          ) : (
            filtered.map((conv) => {
              const active = conv.id === selectedId
              return (
                <button
                  key={conv.id}
                  onClick={() => setSelectedId(conv.id)}
                  className={`w-full text-left px-4 py-3 border-b border-border-brand transition-colors ${
                    active ? 'bg-teal-50' : 'hover:bg-bg'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-teal-100 text-teal-700 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {initials(conv.contact_name)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 mb-0.5">
                        <span className="text-sm font-medium text-ink truncate">
                          {conv.contact_name ?? conv.contact_phone}
                        </span>
                        <span className="text-[10px] text-ink4 shrink-0">
                          {conv.last_message_at ? formatTime(conv.last_message_at) : ''}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-1">
                        <p className="text-xs text-ink3 truncate">
                          {conv.direction === 'outbound' ? 'You: ' : ''}
                          {conv.last_message ?? ''}
                        </p>
                        {conv.unread_count > 0 && (
                          <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-500 text-white">
                            {conv.unread_count > 99 ? '99+' : conv.unread_count}
                          </span>
                        )}
                      </div>
                      {conv.ai_handled && (
                        <span className="text-[9px] text-teal-600 font-medium">AI</span>
                      )}
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </div>

      {/* ── Right panel ── */}
      {!selectedId ? (
        <div className="flex items-center justify-center text-ink4 text-sm">
          Select a conversation
        </div>
      ) : (
        <div className="flex flex-col overflow-hidden">
          {/* Header */}
          <div className="px-5 py-3 border-b border-border-brand flex items-center justify-between shrink-0">
            <div>
              <p className="text-sm font-semibold text-ink">
                {selected?.contact_name ?? contact?.name ?? ''}
              </p>
              <p className="text-xs text-ink4">{selected?.contact_phone ?? contact?.phone ?? ''}</p>
            </div>
            {selected?.status === 'open' ? (
              <button
                onClick={() => void handleResolve()}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 transition-colors"
              >
                Resolve
              </button>
            ) : (
              <button
                onClick={() => void handleReopen()}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-bg border border-border-brand text-ink3 hover:text-ink transition-colors"
              >
                Reopen
              </button>
            )}
          </div>

          {/* Messages thread */}
          <div ref={threadRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
            {msgLoading ? (
              <div className="flex items-center justify-center h-32 text-ink4 text-sm">
                Loading…
              </div>
            ) : messages.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-ink4 text-sm">
                No messages yet
              </div>
            ) : (
              messages.map((msg) => {
                const out = msg.direction === 'outbound'
                return (
                  <div key={msg.id} className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                        out
                          ? 'bg-teal-600 text-white rounded-br-sm'
                          : 'bg-bg text-ink rounded-bl-sm'
                      }`}
                    >
                      <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                      <div
                        className={`flex items-center gap-1 mt-1 ${out ? 'justify-end' : 'justify-start'}`}
                      >
                        <span className={`text-[10px] ${out ? 'text-teal-200' : 'text-ink4'}`}>
                          {formatTime(msg.created_at)}
                        </span>
                        {msg.ai_handled && (
                          <span
                            className={`text-[9px] font-medium ${out ? 'text-teal-200' : 'text-teal-600'}`}
                          >
                            AI
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Compose bar */}
          <div className="px-4 py-3 border-t border-border-brand shrink-0">
            {contact?.sms_opt_in === false ? (
              <p className="text-xs text-red-500 text-center py-2">Contact has opted out of SMS</p>
            ) : (
              <>
                <SnippetPicker
                  value={compose}
                  onChange={setCompose}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      void handleSend()
                    }
                  }}
                  placeholder="Type a message… (⌘↵ to send)"
                  rows={3}
                  maxLength={1600}
                  contactName={contact?.name ?? selected?.contact_name ?? undefined}
                />
                {sendError && <p className="text-xs text-red-500 mt-1">{sendError}</p>}
                <div className="flex justify-end mt-2">
                  <button
                    onClick={() => void handleSend()}
                    disabled={!compose.trim() || sending}
                    className="px-4 py-2 text-sm font-medium rounded-lg bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
