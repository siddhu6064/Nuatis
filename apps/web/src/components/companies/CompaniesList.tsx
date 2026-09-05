'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'

interface Company {
  id: string
  name: string
  domain: string | null
  industry: string | null
  employee_count: number | null
  contact_count: number
  created_at: string
}

interface DuplicatePair {
  company_a: { id: string; name: string }
  company_b: { id: string; name: string }
  confidence: number
  match_reason: string
}

export default function CompaniesList() {
  const router = useRouter()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDomain, setNewDomain] = useState('')
  const [newIndustry, setNewIndustry] = useState('')
  const [saving, setSaving] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showDuplicates, setShowDuplicates] = useState(false)
  const [duplicates, setDuplicates] = useState<DuplicatePair[] | null>(null)
  const [merging, setMerging] = useState<string | null>(null)

  const fetchCompanies = useCallback(async () => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    const res = await fetch(`/api/companies?${params}`)
    if (res.ok) {
      const data = (await res.json()) as { companies: Company[] }
      setCompanies(data.companies)
    }
  }, [q])

  useEffect(() => {
    setLoading(true)
    void fetchCompanies().finally(() => setLoading(false))
  }, [fetchCompanies])

  const createCompany = async () => {
    if (!newName.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          domain: newDomain.trim() || undefined,
          industry: newIndustry.trim() || undefined,
        }),
      })
      if (res.ok) {
        setNewName('')
        setNewDomain('')
        setNewIndustry('')
        setShowCreate(false)
        void fetchCompanies()
      }
    } finally {
      setSaving(false)
    }
  }

  const archiveCompany = async (id: string) => {
    await fetch(`/api/companies/${id}`, { method: 'DELETE' })
    setCompanies((prev) => prev.filter((c) => c.id !== id))
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function archiveSelected() {
    if (selectedIds.size === 0) return
    await fetch('/api/companies/bulk/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(selectedIds) }),
    })
    setCompanies((prev) => prev.filter((c) => !selectedIds.has(c.id)))
    setSelectedIds(new Set())
  }

  async function loadDuplicates() {
    setShowDuplicates(true)
    const res = await fetch('/api/companies/duplicates')
    if (res.ok) {
      const data = (await res.json()) as { pairs: DuplicatePair[] }
      setDuplicates(data.pairs)
    }
  }

  async function mergePair(pair: DuplicatePair) {
    setMerging(pair.company_b.id)
    try {
      await fetch('/api/companies/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primary_id: pair.company_a.id, secondary_id: pair.company_b.id }),
      })
      setDuplicates((prev) => prev?.filter((p) => p !== pair) ?? null)
      void fetchCompanies()
    } finally {
      setMerging(null)
    }
  }

  return (
    <div className="px-8 py-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-ink">Companies</h1>
          <p className="text-sm text-ink3 mt-0.5">{companies.length} companies</p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => void loadDuplicates()}
            color="inherit"
            sx={{ textTransform: 'none' }}
          >
            Find duplicates
          </Button>
          <Button
            onClick={() => setShowCreate(true)}
            variant="contained"
            sx={{ textTransform: 'none' }}
          >
            <span className="text-base leading-none mr-1.5">+</span>
            New Company
          </Button>
        </div>
      </div>

      <div className="mb-4">
        <TextField
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search companies..."
          fullWidth
        />
      </div>

      {showDuplicates && (
        <div className="bg-white rounded-xl border border-border-brand p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-ink">Possible duplicates</h2>
            <button
              type="button"
              onClick={() => setShowDuplicates(false)}
              className="text-xs text-ink4 hover:text-ink"
            >
              Close
            </button>
          </div>
          {duplicates === null ? (
            <p className="text-sm text-ink4">Scanning…</p>
          ) : duplicates.length === 0 ? (
            <p className="text-sm text-ink4">No likely duplicates found.</p>
          ) : (
            <ul className="space-y-2">
              {duplicates.map((pair) => (
                <li
                  key={`${pair.company_a.id}:${pair.company_b.id}`}
                  className="flex items-center justify-between border border-border-brand rounded-lg px-3 py-2"
                >
                  <span className="text-sm text-ink">
                    {pair.company_a.name} <span className="text-ink4">↔</span> {pair.company_b.name}{' '}
                    <span className="text-xs text-ink4">(matched on {pair.match_reason})</span>
                  </span>
                  <Button
                    onClick={() => void mergePair(pair)}
                    disabled={merging === pair.company_b.id}
                    size="small"
                    variant="outlined"
                  >
                    {merging === pair.company_b.id ? 'Merging…' : 'Merge into first'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between bg-teal-50 border border-teal-100 rounded-lg px-4 py-2 mb-4">
          <span className="text-sm text-teal-800">{selectedIds.size} selected</span>
          <Button onClick={() => void archiveSelected()} size="small" color="error">
            Archive selected
          </Button>
        </div>
      )}

      {showCreate && (
        <div className="bg-white rounded-xl border border-border-brand p-4 mb-4">
          <div className="grid grid-cols-3 gap-3 mb-3">
            <TextField
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Company name *"
              autoFocus
              size="small"
            />
            <TextField
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder="Domain (acme.com)"
              size="small"
            />
            <TextField
              value={newIndustry}
              onChange={(e) => setNewIndustry(e.target.value)}
              placeholder="Industry"
              size="small"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setShowCreate(false)} size="small" color="inherit">
              Cancel
            </Button>
            <Button
              onClick={() => void createCompany()}
              disabled={!newName.trim() || saving}
              variant="contained"
              size="small"
            >
              {saving ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-border-brand">
        {loading ? (
          <div className="py-20 text-center text-sm text-ink4">Loading...</div>
        ) : companies.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-sm text-ink4">No companies yet</p>
            <Button
              onClick={() => setShowCreate(true)}
              size="small"
              sx={{ mt: 1.5, fontSize: 12, fontWeight: 500, textTransform: 'none' }}
            >
              Create your first company &rarr;
            </Button>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-brand">
                <th className="px-6 py-3 w-8">
                  <input
                    type="checkbox"
                    aria-label="Select all companies"
                    checked={selectedIds.size > 0 && selectedIds.size === companies.length}
                    onChange={(e) =>
                      setSelectedIds(
                        e.target.checked ? new Set(companies.map((c) => c.id)) : new Set()
                      )
                    }
                  />
                </th>
                <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Name</th>
                <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Domain</th>
                <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Industry</th>
                <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Contacts</th>
                <th className="text-left text-xs font-medium text-ink4 px-6 py-3">Added</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {companies.map((co) => (
                <tr
                  key={co.id}
                  className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors cursor-pointer"
                  onClick={() => router.push(`/companies/${co.id}`)}
                >
                  <td className="px-6 py-4" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select ${co.name}`}
                      checked={selectedIds.has(co.id)}
                      onChange={() => toggleSelected(co.id)}
                    />
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-ink">{co.name}</td>
                  <td className="px-6 py-4 text-sm text-ink3">{co.domain ?? '\u2014'}</td>
                  <td className="px-6 py-4 text-sm text-ink3">{co.industry ?? '\u2014'}</td>
                  <td className="px-6 py-4">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-teal-50 text-teal-700">
                      {co.contact_count}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-ink4">
                    {new Date(co.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="px-6 py-4">
                    <Button
                      onClick={(e) => {
                        e.stopPropagation()
                        void archiveCompany(co.id)
                      }}
                      size="small"
                      color="inherit"
                      sx={{ fontSize: 12, minWidth: 0, textTransform: 'none' }}
                    >
                      Archive
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
