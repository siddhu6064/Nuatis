'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'

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
          <h1 className="text-xl font-bold text-gray-900">Companies</h1>
          <p className="text-sm text-gray-500 mt-0.5">{companies.length} companies</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
        >
          <span className="text-base leading-none">+</span>
          New Company
        </button>
      </div>

      <div className="mb-4">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search companies..."
          className="w-full px-4 py-2.5 text-sm border border-gray-200 rounded-lg focus:ring-1 focus:ring-teal-500 focus:border-teal-500 placeholder-gray-400"
        />
      </div>

      {showCreate && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
          <div className="grid grid-cols-3 gap-3 mb-3">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Company name *"
              autoFocus
              className="text-sm border border-gray-200 rounded px-3 py-2"
            />
            <input
              type="text"
              value={newDomain}
              onChange={(e) => setNewDomain(e.target.value)}
              placeholder="Domain (acme.com)"
              className="text-sm border border-gray-200 rounded px-3 py-2"
            />
            <input
              type="text"
              value={newIndustry}
              onChange={(e) => setNewIndustry(e.target.value)}
              placeholder="Industry"
              className="text-sm border border-gray-200 rounded px-3 py-2"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setShowCreate(false)}
              className="px-3 py-1.5 text-xs text-gray-500"
            >
              Cancel
            </button>
            <button
              onClick={() => void createCompany()}
              disabled={!newName.trim() || saving}
              className="px-4 py-1.5 text-xs font-medium text-white bg-teal-600 rounded-md hover:bg-teal-700 disabled:opacity-50"
            >
              {saving ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100">
        {loading ? (
          <div className="py-20 text-center text-sm text-gray-400">Loading...</div>
        ) : companies.length === 0 ? (
          <div className="py-20 text-center">
            <p className="text-sm text-gray-400">No companies yet</p>
            <button
              onClick={() => setShowCreate(true)}
              className="mt-3 text-xs text-teal-600 hover:text-teal-700 font-medium"
            >
              Create your first company &rarr;
            </button>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Name</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Domain</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Industry</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Contacts</th>
                <th className="text-left text-xs font-medium text-gray-400 px-6 py-3">Added</th>
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
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{co.name}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{co.domain ?? '\u2014'}</td>
                  <td className="px-6 py-4 text-sm text-gray-500">{co.industry ?? '\u2014'}</td>
                  <td className="px-6 py-4">
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-teal-50 text-teal-700">
                      {co.contact_count}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-400">
                    {new Date(co.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        void archiveCompany(co.id)
                      }}
                      className="text-xs text-gray-400 hover:text-red-500"
                    >
                      Archive
                    </button>
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
