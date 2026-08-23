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

  return (
    <div className="px-8 py-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-ink">Companies</h1>
          <p className="text-sm text-ink3 mt-0.5">{companies.length} companies</p>
        </div>
        <Button
          onClick={() => setShowCreate(true)}
          variant="contained"
          sx={{ textTransform: 'none' }}
        >
          <span className="text-base leading-none mr-1.5">+</span>
          New Company
        </Button>
      </div>

      <div className="mb-4">
        <TextField
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search companies..."
          fullWidth
        />
      </div>

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
