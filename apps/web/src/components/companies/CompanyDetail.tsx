'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'

interface Company {
  id: string
  name: string
  domain: string | null
  industry: string | null
  employee_count: number | null
  website: string | null
  address: string | null
  city: string | null
  state: string | null
  notes: string | null
  contacts: Array<{
    id: string
    full_name: string
    phone: string | null
    email: string | null
    pipeline_stage: string | null
  }>
}

interface Props {
  companyId: string
}

interface ActivityItem {
  id: string
  type: string
  body: string | null
  actor_name: string | null
  created_at: string
}

interface ContactResult {
  id: string
  full_name: string
  email: string | null
  phone: string | null
}

export default function CompanyDetail({ companyId }: Props) {
  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDomain, setEditDomain] = useState('')
  const [editIndustry, setEditIndustry] = useState('')
  const [editWebsite, setEditWebsite] = useState('')

  // Link contact state
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkSearch, setLinkSearch] = useState('')
  const [linkResults, setLinkResults] = useState<ContactResult[]>([])
  const [linkBusy, setLinkBusy] = useState(false)
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null)
  const linkDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [activity, setActivity] = useState<ActivityItem[] | null>(null)

  const fetchCompany = useCallback(async () => {
    const res = await fetch(`/api/companies/${companyId}`)
    if (res.ok) {
      const data = (await res.json()) as Company
      setCompany(data)
      setEditName(data.name)
      setEditDomain(data.domain ?? '')
      setEditIndustry(data.industry ?? '')
      setEditWebsite(data.website ?? '')
    }
  }, [companyId])

  useEffect(() => {
    setLoading(true)
    void fetchCompany().finally(() => setLoading(false))
  }, [fetchCompany])

  useEffect(() => {
    fetch(`/api/companies/${companyId}/activity`)
      .then((r) => r.json())
      .then((data: { items: ActivityItem[] }) => setActivity(data.items))
  }, [companyId])

  const handleLinkSearch = (q: string) => {
    setLinkSearch(q)
    if (linkDebounce.current) clearTimeout(linkDebounce.current)
    if (!q.trim()) {
      setLinkResults([])
      return
    }
    linkDebounce.current = setTimeout(async () => {
      const res = await fetch(`/api/contacts?q=${encodeURIComponent(q.trim())}&limit=8`)
      if (res.ok) {
        const data = (await res.json()) as { contacts: ContactResult[] }
        setLinkResults(data.contacts ?? [])
      }
    }, 250)
  }

  const linkContact = async (contactId: string) => {
    setLinkBusy(true)
    await fetch(`/api/contacts/${contactId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: companyId }),
    })
    setLinkBusy(false)
    setLinkOpen(false)
    setLinkSearch('')
    setLinkResults([])
    void fetchCompany()
  }

  const unlinkContact = async (contactId: string) => {
    setUnlinkingId(contactId)
    await fetch(`/api/contacts/${contactId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company_id: null }),
    })
    setUnlinkingId(null)
    void fetchCompany()
  }

  const saveEdits = async () => {
    await fetch(`/api/companies/${companyId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editName.trim(),
        domain: editDomain.trim() || null,
        industry: editIndustry.trim() || null,
        website: editWebsite.trim() || null,
      }),
    })
    setEditing(false)
    void fetchCompany()
  }

  if (loading || !company) {
    return <div className="py-12 text-center text-sm text-ink4">Loading...</div>
  }

  return (
    <div>
      {/* Header */}
      <div className="bg-white rounded-xl border border-border-brand p-5 mb-6">
        {editing ? (
          <div className="space-y-2 mb-3">
            <TextField
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              fullWidth
              size="small"
              sx={{ '& input': { fontSize: 18, fontWeight: 700 } }}
            />
            <div className="grid grid-cols-3 gap-2">
              <TextField
                value={editDomain}
                onChange={(e) => setEditDomain(e.target.value)}
                placeholder="Domain"
                size="small"
              />
              <TextField
                value={editIndustry}
                onChange={(e) => setEditIndustry(e.target.value)}
                placeholder="Industry"
                size="small"
              />
              <TextField
                value={editWebsite}
                onChange={(e) => setEditWebsite(e.target.value)}
                placeholder="Website"
                size="small"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => void saveEdits()} variant="contained" size="small">
                Save
              </Button>
              <Button onClick={() => setEditing(false)} size="small" color="inherit">
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-bold text-ink">{company.name}</h2>
              <Button
                onClick={() => setEditing(true)}
                size="small"
                sx={{ fontSize: 12, minWidth: 0, textTransform: 'none' }}
              >
                Edit
              </Button>
            </div>
            <div className="flex items-center gap-4 text-sm text-ink3">
              {company.domain && <span>{company.domain}</span>}
              {company.industry && <span>{company.industry}</span>}
              {company.website && (
                <a
                  href={
                    company.website.startsWith('http')
                      ? company.website
                      : `https://${company.website}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-teal-600 hover:text-teal-700"
                >
                  {company.website}
                </a>
              )}
            </div>
          </>
        )}
      </div>

      {/* Contacts */}
      <div className="bg-white rounded-xl border border-border-brand p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-ink2">Contacts ({company.contacts.length})</h3>
          <Button
            onClick={() => {
              setLinkOpen((o) => !o)
              setLinkSearch('')
              setLinkResults([])
            }}
            size="small"
            sx={{ fontSize: 12, minWidth: 0, textTransform: 'none' }}
          >
            + Link Contact
          </Button>
        </div>

        {/* Inline contact search */}
        {linkOpen && (
          <div className="mb-3 relative">
            <TextField
              autoFocus
              value={linkSearch}
              onChange={(e) => handleLinkSearch(e.target.value)}
              placeholder="Search contacts by name…"
              size="small"
              fullWidth
            />
            {linkResults.length > 0 && (
              <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-border-brand rounded-lg shadow-lg max-h-56 overflow-y-auto">
                {linkResults.map((r) => (
                  <ButtonBase
                    key={r.id}
                    disabled={linkBusy}
                    onClick={() => void linkContact(r.id)}
                    sx={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                      px: 1.5,
                      py: 1,
                      textAlign: 'left',
                      '&:hover': { bgcolor: '#f9f8f5' },
                      '&.Mui-disabled': { opacity: 0.5 },
                    }}
                  >
                    <div className="w-6 h-6 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
                      <span className="text-teal-700 text-[10px] font-bold">
                        {r.full_name?.charAt(0)?.toUpperCase() ?? '?'}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{r.full_name}</p>
                      <p className="text-xs text-ink4 truncate">{r.email ?? r.phone ?? ''}</p>
                    </div>
                  </ButtonBase>
                ))}
              </div>
            )}
          </div>
        )}

        {company.contacts.length === 0 ? (
          <p className="text-xs text-ink4 py-4 text-center">No contacts linked to this company</p>
        ) : (
          <div className="space-y-2">
            {company.contacts.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-bg">
                <Link href={`/contacts/${c.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-7 h-7 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
                    <span className="text-teal-700 text-xs font-bold">
                      {c.full_name?.charAt(0)?.toUpperCase() ?? '?'}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink truncate">{c.full_name}</p>
                    <p className="text-xs text-ink4">{c.email ?? c.phone ?? ''}</p>
                  </div>
                  {c.pipeline_stage && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-teal-50 text-teal-700">
                      {c.pipeline_stage}
                    </span>
                  )}
                </Link>
                <Button
                  disabled={unlinkingId === c.id}
                  onClick={() => void unlinkContact(c.id)}
                  size="small"
                  color="inherit"
                  sx={{ fontSize: 12, minWidth: 0, textTransform: 'none', ml: 1, flexShrink: 0 }}
                >
                  Unlink
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Activity */}
      <div className="bg-white rounded-xl border border-border-brand p-5 mt-6">
        <h3 className="text-sm font-semibold text-ink2 mb-3">Activity</h3>
        {activity === null ? (
          <p className="text-xs text-ink4 py-4 text-center">Loading…</p>
        ) : activity.length === 0 ? (
          <p className="text-xs text-ink4 py-4 text-center">No activity yet.</p>
        ) : (
          <ul className="space-y-2">
            {activity.map((item) => (
              <li key={item.id} className="text-sm">
                <span className="text-ink">{item.body}</span>
                <span className="text-ink4 text-xs ml-2">
                  {item.actor_name ?? 'System'} · {new Date(item.created_at).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
