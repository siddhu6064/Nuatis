'use client'

import { useState, useEffect, useCallback } from 'react'

interface UserRow {
  id: string
  full_name: string
  email: string
  role: 'owner' | 'admin' | 'manager' | 'staff'
}

const ROLE_LABEL: Record<UserRow['role'], string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  staff: 'Staff',
}

const ASSIGNABLE_ROLES: UserRow['role'][] = ['admin', 'manager', 'staff']

export default function TeamSettingsPage() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const fetchUsers = useCallback(async () => {
    const res = await fetch('/api/users')
    if (res.ok) setUsers((await res.json()) as UserRow[])
    setLoading(false)
  }, [])

  useEffect(() => {
    void fetchUsers()
  }, [fetchUsers])

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  async function handleRoleChange(userId: string, role: UserRow['role']) {
    setSavingId(userId)
    try {
      const res = await fetch(`/api/users/${userId}/role`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error((d as { error?: string }).error ?? 'Failed to update role')
      }
      await fetchUsers()
      setToast({ type: 'success', msg: 'Role updated' })
    } catch (err) {
      setToast({ type: 'error', msg: err instanceof Error ? err.message : 'Failed to update' })
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div className="px-8 py-8 max-w-2xl">
      <h1 className="text-xl font-bold text-ink mb-1">Team</h1>
      <p className="text-sm text-ink4 mb-6">
        Manager can run day-to-day work — contacts, appointments, deals, quotas, time-off — but not
        billing, integrations, or org settings. Owner role can&apos;t be changed here.
      </p>

      <div className="bg-white rounded-xl border border-border-brand">
        <div className="px-5 py-4">
          {loading ? (
            <p className="text-sm text-ink4">Loading…</p>
          ) : (
            <div className="space-y-1">
              {users.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center justify-between gap-2 py-2 border-b border-gray-50 last:border-0"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-ink truncate">{u.full_name}</p>
                    <p className="text-xs text-ink4 truncate">{u.email}</p>
                  </div>
                  {u.role === 'owner' ? (
                    <span className="text-xs text-ink4 shrink-0">Owner</span>
                  ) : (
                    <select
                      value={u.role}
                      disabled={savingId === u.id}
                      onChange={(e) =>
                        void handleRoleChange(u.id, e.target.value as UserRow['role'])
                      }
                      className="text-sm border border-border-brand rounded-lg px-2 py-1.5 shrink-0
                                 outline-none focus:border-teal-500"
                    >
                      {ASSIGNABLE_ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {toast && (
        <div
          className={`fixed top-4 right-4 z-[60] px-4 py-2 text-sm rounded-lg shadow-lg ${
            toast.type === 'success'
              ? 'bg-teal-600 text-white'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  )
}
