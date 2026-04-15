'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'

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

export default function CompanyDetail({ companyId }: Props) {
  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDomain, setEditDomain] = useState('')
  const [editIndustry, setEditIndustry] = useState('')
  const [editWebsite, setEditWebsite] = useState('')

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
    return <div className="py-12 text-center text-sm text-gray-400">Loading...</div>
  }

  return (
    <div>
      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-100 p-5 mb-6">
        {editing ? (
          <div className="space-y-2 mb-3">
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full text-lg font-bold border border-gray-200 rounded px-2 py-1"
            />
            <div className="grid grid-cols-3 gap-2">
              <input
                type="text"
                value={editDomain}
                onChange={(e) => setEditDomain(e.target.value)}
                placeholder="Domain"
                className="text-sm border border-gray-200 rounded px-2 py-1"
              />
              <input
                type="text"
                value={editIndustry}
                onChange={(e) => setEditIndustry(e.target.value)}
                placeholder="Industry"
                className="text-sm border border-gray-200 rounded px-2 py-1"
              />
              <input
                type="text"
                value={editWebsite}
                onChange={(e) => setEditWebsite(e.target.value)}
                placeholder="Website"
                className="text-sm border border-gray-200 rounded px-2 py-1"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void saveEdits()}
                className="px-3 py-1 text-xs font-medium text-white bg-teal-600 rounded hover:bg-teal-700"
              >
                Save
              </button>
              <button onClick={() => setEditing(false)} className="px-3 py-1 text-xs text-gray-500">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-bold text-gray-900">{company.name}</h2>
              <button
                onClick={() => setEditing(true)}
                className="text-xs text-teal-600 hover:text-teal-700 font-medium"
              >
                Edit
              </button>
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-500">
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
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-700">
            Contacts ({company.contacts.length})
          </h3>
        </div>
        {company.contacts.length === 0 ? (
          <p className="text-xs text-gray-400 py-4 text-center">
            No contacts linked to this company
          </p>
        ) : (
          <div className="space-y-2">
            {company.contacts.map((c) => (
              <Link
                key={c.id}
                href={`/contacts/${c.id}`}
                className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50"
              >
                <div className="w-7 h-7 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
                  <span className="text-teal-700 text-xs font-bold">
                    {c.full_name?.charAt(0)?.toUpperCase() ?? '?'}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{c.full_name}</p>
                  <p className="text-xs text-gray-400">{c.email ?? c.phone ?? ''}</p>
                </div>
                {c.pipeline_stage && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-teal-50 text-teal-700">
                    {c.pipeline_stage}
                  </span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
