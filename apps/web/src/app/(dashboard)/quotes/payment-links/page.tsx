'use client'

import { useState, useEffect, useRef } from 'react'
import TextField from '@mui/material/TextField'
import InputAdornment from '@mui/material/InputAdornment'
import Button from '@mui/material/Button'
import { Modal } from '@/components/ui/Modal'

interface Contact {
  id: string
  full_name: string
  phone: string | null
}

interface PaymentLink {
  id: string
  url: string
  amount: number
  description: string
  label: string | null
  created_at: string
  contact_id: string | null
  contacts: { full_name: string; phone: string | null } | null
}

interface CreatedLink {
  id: string
  url: string
  amount: number
  description: string
}

export default function PaymentLinksPage() {
  const [links, setLinks] = useState<PaymentLink[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)

  // Form state
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [label, setLabel] = useState('')
  const [contactSearch, setContactSearch] = useState('')
  const [contactResults, setContactResults] = useState<Contact[]>([])
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState('')
  const [createdLink, setCreatedLink] = useState<CreatedLink | null>(null)
  const [copied, setCopied] = useState(false)
  const [smsSending, setSmsSending] = useState(false)
  const [smsSent, setSmsSent] = useState(false)

  // Deactivating state per link
  const [deactivating, setDeactivating] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const searchRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void fetchLinks()
  }, [])

  useEffect(() => {
    if (!contactSearch.trim()) {
      setContactResults([])
      return
    }
    const t = setTimeout(() => void searchContacts(contactSearch), 300)
    return () => clearTimeout(t)
  }, [contactSearch])

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  async function fetchLinks() {
    setLoading(true)
    try {
      const res = await fetch('/api/payment-links')
      if (res.ok) {
        const d = (await res.json()) as { payment_links: PaymentLink[] }
        setLinks(d.payment_links)
      }
    } finally {
      setLoading(false)
    }
  }

  async function searchContacts(q: string) {
    const res = await fetch(`/api/contacts?search=${encodeURIComponent(q)}&limit=8`)
    if (res.ok) {
      const d = (await res.json()) as { contacts: Contact[] }
      setContactResults(d.contacts ?? [])
      setSearchOpen(true)
    }
  }

  function openModal() {
    setAmount('')
    setDescription('')
    setLabel('')
    setContactSearch('')
    setSelectedContact(null)
    setContactResults([])
    setFormError('')
    setCreatedLink(null)
    setCopied(false)
    setSmsSent(false)
    setShowModal(true)
  }

  async function createLink() {
    const amt = parseFloat(amount)
    if (isNaN(amt) || amt <= 0) {
      setFormError('Enter a valid amount.')
      return
    }
    if (!description.trim()) {
      setFormError('Description is required.')
      return
    }
    setCreating(true)
    setFormError('')
    try {
      const res = await fetch('/api/payment-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: amt,
          description: description.trim(),
          label: label.trim() || null,
          contactId: selectedContact?.id ?? null,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setFormError((d as { error?: string }).error ?? 'Failed to create link.')
        return
      }
      const data = (await res.json()) as CreatedLink
      setCreatedLink(data)
      void fetchLinks()
    } catch {
      setFormError('Network error.')
    } finally {
      setCreating(false)
    }
  }

  function copyUrl(url: string, id?: string) {
    navigator.clipboard.writeText(url).then(() => {
      if (id) {
        setCopiedId(id)
        setTimeout(() => setCopiedId(null), 2000)
      } else {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    })
  }

  async function sendSms() {
    if (!selectedContact?.id || !createdLink) return
    setSmsSending(true)
    try {
      const res = await fetch(`/api/contacts/${selectedContact.id}/sms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `Here is your payment link for ${createdLink.description}: ${createdLink.url}`,
        }),
      })
      if (res.ok) setSmsSent(true)
    } finally {
      setSmsSending(false)
    }
  }

  async function deactivate(id: string) {
    setDeactivating(id)
    try {
      await fetch(`/api/payment-links/${id}`, { method: 'DELETE' })
      setLinks((prev) => prev.filter((l) => l.id !== id))
    } finally {
      setDeactivating(null)
    }
  }

  return (
    <div className="px-8 py-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-ink">Payment Links</h1>
          <p className="text-sm text-ink4 mt-0.5">Collect deposits and fees instantly via Stripe</p>
        </div>
        <button
          onClick={openModal}
          className="text-sm text-white bg-teal-600 hover:bg-teal-700 px-4 py-2 rounded-lg font-medium"
        >
          Get Payment Link
        </button>
      </div>

      {/* Links table */}
      {loading ? (
        <div className="text-sm text-ink4 py-12 text-center">Loading...</div>
      ) : links.length === 0 ? (
        <div className="bg-white rounded-xl border border-border-brand p-12 text-center">
          <p className="text-sm text-ink4">
            No payment links yet — create one to collect deposits or fees instantly
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-border-brand overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-brand">
                <th className="text-left text-xs font-medium text-ink4 px-5 py-3">Description</th>
                <th className="text-right text-xs font-medium text-ink4 px-5 py-3">Amount</th>
                <th className="text-left text-xs font-medium text-ink4 px-5 py-3">Contact</th>
                <th className="text-left text-xs font-medium text-ink4 px-5 py-3">Created</th>
                <th className="text-left text-xs font-medium text-ink4 px-5 py-3">URL</th>
                <th className="text-right text-xs font-medium text-ink4 px-5 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {links.map((link) => (
                <tr key={link.id} className="border-b border-gray-50 last:border-0">
                  <td className="px-5 py-3 text-sm text-ink">
                    {link.description}
                    {link.label && (
                      <span className="ml-2 text-xs text-ink4 bg-bg px-1.5 py-0.5 rounded">
                        {link.label}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-sm text-ink font-medium text-right">
                    ${Number(link.amount).toFixed(2)}
                  </td>
                  <td className="px-5 py-3 text-sm text-ink3">
                    {link.contacts?.full_name ?? <span className="text-ink4">—</span>}
                  </td>
                  <td className="px-5 py-3 text-xs text-ink4">
                    {new Date(link.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="px-5 py-3 text-xs text-ink4 max-w-[160px]">
                    <span className="truncate block" title={link.url}>
                      {link.url.replace('https://', '')}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => copyUrl(link.url, link.id)}
                        className="text-xs text-teal-600 hover:text-teal-700"
                      >
                        {copiedId === link.id ? 'Copied!' : 'Copy'}
                      </button>
                      <span className="text-ink4">·</span>
                      <button
                        onClick={() => void deactivate(link.id)}
                        disabled={deactivating === link.id}
                        className="text-xs text-red-500 hover:text-red-600 disabled:opacity-50"
                      >
                        {deactivating === link.id ? 'Deactivating...' : 'Deactivate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <Modal
          onClose={() => setShowModal(false)}
          title={createdLink ? 'Payment Link Created' : 'Get Payment Link'}
          footer={
            createdLink ? (
              <Button onClick={() => setShowModal(false)} variant="text" color="inherit">
                Close
              </Button>
            ) : (
              <>
                <Button onClick={() => setShowModal(false)} variant="text" color="inherit">
                  Cancel
                </Button>
                <Button onClick={() => void createLink()} disabled={creating} variant="contained">
                  {creating ? 'Creating…' : 'Create Link'}
                </Button>
              </>
            )
          }
        >
          {createdLink ? (
            /* Success state */
            <div>
              <p className="text-xs text-ink3 mb-3">
                {createdLink.description} · ${Number(createdLink.amount).toFixed(2)}
              </p>
              <div className="flex items-center gap-2 mb-4">
                <TextField
                  slotProps={{ htmlInput: { readOnly: true, style: { fontFamily: 'monospace' } } }}
                  value={createdLink.url}
                  fullWidth
                  size="small"
                />
                <Button onClick={() => copyUrl(createdLink.url)} variant="contained" size="small">
                  {copied ? 'Copied!' : 'Copy Link'}
                </Button>
              </div>
              {selectedContact?.phone && (
                <Button
                  onClick={() => void sendSms()}
                  disabled={smsSending || smsSent}
                  variant="outlined"
                  fullWidth
                >
                  {smsSent
                    ? '✓ Sent via SMS'
                    : smsSending
                      ? 'Sending…'
                      : `Send via SMS to ${selectedContact.full_name}`}
                </Button>
              )}
            </div>
          ) : (
            /* Create form */
            <div className="space-y-4">
              <TextField
                label="Amount"
                type="number"
                slotProps={{
                  htmlInput: { min: '0.01', step: '0.01' },
                  input: { startAdornment: <InputAdornment position="start">$</InputAdornment> },
                }}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                fullWidth
                size="small"
              />

              <TextField
                label="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Deposit for roof repair"
                fullWidth
                size="small"
              />

              <TextField
                label="Label"
                helperText="internal, optional"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Job #4421"
                fullWidth
                size="small"
              />

              <div>
                <label className="text-xs font-medium text-ink3 block mb-1">
                  Link to contact <span className="text-ink4 font-normal">(optional)</span>
                </label>
                {selectedContact ? (
                  <div className="flex items-center justify-between px-3 py-2 border border-teal-300 bg-teal-50 rounded-lg">
                    <span className="text-sm text-teal-700">{selectedContact.full_name}</span>
                    <button
                      onClick={() => {
                        setSelectedContact(null)
                        setContactSearch('')
                      }}
                      className="text-xs text-teal-500 hover:text-teal-700"
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <div className="relative" ref={searchRef}>
                    <input
                      type="text"
                      value={contactSearch}
                      onChange={(e) => setContactSearch(e.target.value)}
                      onFocus={() => contactResults.length > 0 && setSearchOpen(true)}
                      placeholder="Search contacts..."
                      className="w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                    {searchOpen && contactResults.length > 0 && (
                      <div className="absolute z-10 top-full mt-1 w-full bg-white border border-border-brand rounded-lg shadow-lg overflow-hidden">
                        {contactResults.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => {
                              setSelectedContact(c)
                              setContactSearch('')
                              setContactResults([])
                              setSearchOpen(false)
                            }}
                            className="w-full text-left px-3 py-2 text-sm text-ink hover:bg-bg"
                          >
                            {c.full_name}
                            {c.phone && <span className="text-xs text-ink4 ml-2">{c.phone}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {formError && <p className="text-xs text-rose-600">{formError}</p>}
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
