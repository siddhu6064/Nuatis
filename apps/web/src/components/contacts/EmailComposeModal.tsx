'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'

interface EmailTemplate {
  id: string
  name: string
}

interface EmailAccount {
  id: string
  email: string
  provider: string
  is_default: boolean
}

interface Props {
  contactId: string
  contactEmail: string
  contactName: string
  onClose: () => void
  onSent: () => void
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim()
}

export default function EmailComposeModal({
  contactId,
  contactEmail,
  contactName,
  onClose,
  onSent,
}: Props) {
  const { data: session } = useSession()
  const token = (session as { accessToken?: string } | null)?.accessToken

  const [templates, setTemplates] = useState<EmailTemplate[]>([])
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [error, setError] = useState('')

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }

  // Fetch templates and accounts on mount
  useEffect(() => {
    void fetch(`/api/email-templates`, { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { templates?: EmailTemplate[] } | null) => {
        if (d?.templates) setTemplates(d.templates)
      })
      .catch(() => {})

    void fetch(`/api/email-integrations`, { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { accounts?: EmailAccount[] } | null) => {
        if (d?.accounts) {
          setAccounts(d.accounts)
          const def = d.accounts.find((a) => a.is_default)
          if (def) setSelectedAccountId(def.id)
          else if (d.accounts.length > 0 && d.accounts[0]) setSelectedAccountId(d.accounts[0].id)
        }
      })
      .catch(() => {})
  }, [])

  // Load template preview when a template is selected
  const handleTemplateChange = async (templateId: string) => {
    setSelectedTemplateId(templateId)
    if (!templateId) {
      setSubject('')
      setBody('')
      return
    }
    setLoadingPreview(true)
    try {
      const res = await fetch(`/api/email-templates/${templateId}/preview?contactId=${contactId}`, {
        headers,
      })
      if (res.ok) {
        const d = (await res.json()) as { subject?: string; body?: string; bodyHtml?: string }
        setSubject(d.subject ?? '')
        setBody(d.bodyHtml ?? d.body ?? '')
      }
    } catch {
      // ignore
    } finally {
      setLoadingPreview(false)
    }
  }

  const handleSend = async () => {
    if (!subject.trim()) {
      setError('Subject is required.')
      return
    }
    if (!body.trim()) {
      setError('Body is required.')
      return
    }
    if (!selectedAccountId) {
      setError('Please select a From account.')
      return
    }
    setError('')
    setSending(true)
    try {
      const res = await fetch(`/api/email-integrations/send/${contactId}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          subject,
          bodyHtml: body,
          bodyText: stripTags(body),
          emailAccountId: selectedAccountId,
          ...(selectedTemplateId ? { templateId: selectedTemplateId } : {}),
        }),
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        setError(d.error ?? 'Failed to send email.')
        return
      }
      onSent()
      onClose()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Compose Email</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3">
          {accounts.length === 0 ? (
            <div className="text-sm text-gray-600 py-2">
              No email accounts connected.{' '}
              <a
                href="/settings/integrations"
                className="text-teal-600 hover:text-teal-700 font-medium"
              >
                Connect one in Integrations
              </a>
            </div>
          ) : (
            <>
              {/* Template picker */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Template</label>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => void handleTemplateChange(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="">No template</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                {loadingPreview && (
                  <p className="text-xs text-gray-400 mt-1">Loading template...</p>
                )}
              </div>

              {/* From */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">From</label>
                <select
                  value={selectedAccountId}
                  onChange={(e) => setSelectedAccountId(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.email}
                      {a.is_default ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {/* To */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">To</label>
                <input
                  type="email"
                  value={contactEmail || `${contactName} (no email on file)`}
                  readOnly
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-gray-50 text-gray-600 cursor-not-allowed"
                />
              </div>

              {/* Subject */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Subject</label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Enter subject..."
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>

              {/* Body */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Body</label>
                <textarea
                  rows={8}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Write your message..."
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 resize-none"
                />
              </div>

              {/* Error */}
              {error && <p className="text-xs text-red-600">{error}</p>}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-gray-100">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          {accounts.length > 0 && (
            <button
              onClick={() => void handleSend()}
              disabled={sending}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {sending ? 'Sending...' : 'Send'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
