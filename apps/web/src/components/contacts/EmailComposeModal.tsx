'use client'

import { useState, useEffect } from 'react'
import TextField from '@mui/material/TextField'
import MenuItem from '@mui/material/MenuItem'
import Button from '@mui/material/Button'
import { Modal } from '@/components/ui/Modal'

interface EmailTemplate {
  id: string
  name: string
}

interface EmailAccount {
  id: string
  email_address: string
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
    <Modal
      onClose={onClose}
      title="Compose Email"
      footer={
        <>
          <Button onClick={onClose} variant="text" color="inherit">
            Cancel
          </Button>
          {accounts.length > 0 && (
            <Button onClick={() => void handleSend()} disabled={sending} variant="contained">
              {sending ? 'Sending…' : 'Send'}
            </Button>
          )}
        </>
      }
    >
      {accounts.length === 0 ? (
        <div className="text-sm text-ink3 py-2">
          No email accounts connected.{' '}
          <a
            href="/settings/integrations"
            className="text-teal-600 hover:text-teal-700 font-medium"
          >
            Connect one in Integrations
          </a>
        </div>
      ) : (
        <div className="space-y-3">
          <TextField
            select
            label="Template"
            value={selectedTemplateId}
            onChange={(e) => void handleTemplateChange(e.target.value)}
            fullWidth
            size="small"
            helperText={loadingPreview ? 'Loading template…' : undefined}
          >
            <MenuItem value="">No template</MenuItem>
            {templates.map((t) => (
              <MenuItem key={t.id} value={t.id}>
                {t.name}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label="From"
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            fullWidth
            size="small"
          >
            {accounts.map((a) => (
              <MenuItem key={a.id} value={a.id}>
                {a.email_address}
                {a.is_default ? ' (default)' : ''}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="To"
            value={contactEmail || `${contactName} (no email on file)`}
            slotProps={{ htmlInput: { readOnly: true } }}
            fullWidth
            size="small"
          />

          <TextField
            label="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Enter subject..."
            fullWidth
            size="small"
          />

          <TextField
            label="Body"
            multiline
            rows={8}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your message..."
            fullWidth
            size="small"
          />

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      )}
    </Modal>
  )
}
