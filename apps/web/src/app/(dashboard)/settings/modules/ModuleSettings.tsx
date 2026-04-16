'use client'

import { useState } from 'react'

interface ModuleInfo {
  key: string
  label: string
  description: string
  cpqHint?: string
}

const MODULES: ModuleInfo[] = [
  {
    key: 'maya',
    label: 'Maya Voice AI',
    description: 'AI voice receptionist — answers calls, books appointments',
  },
  { key: 'crm', label: 'CRM', description: 'Contact and company management' },
  {
    key: 'appointments',
    label: 'Appointments',
    description: 'Appointment scheduling and calendar view',
  },
  { key: 'pipeline', label: 'Pipeline', description: 'Sales pipeline and deal tracking (Kanban)' },
  {
    key: 'automation',
    label: 'Automation',
    description: 'Follow-up sequences and revenue operations',
  },
  { key: 'cpq', label: 'CPQ', description: 'Quotes, estimates and proposal builder' },
  { key: 'insights', label: 'Insights', description: 'Analytics and performance dashboard' },
]

const CPQ_RECOMMENDED = ['contractor', 'law_firm', 'real_estate', 'sales_crm']

interface Props {
  initialModules: Record<string, boolean>
  isOwner: boolean
  vertical: string
}

export default function ModuleSettings({ initialModules, isOwner, vertical }: Props) {
  const [modules, setModules] = useState<Record<string, boolean>>(initialModules)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)

  function showToast(type: 'success' | 'error', msg: string) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3000)
  }

  async function toggle(moduleKey: string, enabled: boolean) {
    setToggling(moduleKey)
    const prev = modules[moduleKey]
    setModules((m) => ({ ...m, [moduleKey]: enabled }))

    try {
      const res = await fetch('/api/settings/modules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module: moduleKey, enabled }),
      })

      if (res.ok) {
        const data = await res.json()
        setModules(data.modules)
        showToast(
          'success',
          `${moduleKey.toUpperCase()} module ${enabled ? 'enabled' : 'disabled'}`
        )
      } else {
        setModules((m) => ({ ...m, [moduleKey]: prev ?? true }))
        const d = await res.json().catch(() => ({}))
        showToast('error', d.error || 'Failed to update')
      }
    } catch {
      setModules((m) => ({ ...m, [moduleKey]: prev ?? true }))
      showToast('error', 'Failed to update module setting')
    } finally {
      setToggling(null)
    }
  }

  return (
    <div className="space-y-6">
      {!isOwner && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm text-amber-800">
            Contact your account owner to change module settings.
          </p>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-100">
        {MODULES.map((mod) => {
          const enabled = modules[mod.key] !== false

          let hint: string | null = null
          if (mod.key === 'cpq') {
            hint = CPQ_RECOMMENDED.includes(vertical)
              ? 'Recommended for your vertical'
              : 'Off by default for your vertical — enable if you send quotes or estimates'
          }

          return (
            <div key={mod.key} className="px-6 py-4 flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900">{mod.label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{mod.description}</p>
                {hint && (
                  <p
                    className={`text-[10px] mt-1 ${CPQ_RECOMMENDED.includes(vertical) ? 'text-teal-600' : 'text-amber-600'}`}
                  >
                    {hint}
                  </p>
                )}
              </div>
              <button
                onClick={() => toggle(mod.key, !enabled)}
                disabled={!isOwner || toggling === mod.key}
                className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${
                  enabled ? 'bg-teal-600' : 'bg-gray-300'
                } ${!isOwner ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    enabled ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          )
        })}
      </div>

      {toast && (
        <p
          className={`text-sm px-3 py-2 rounded-lg ${toast.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}
        >
          {toast.msg}
        </p>
      )}

      {isOwner && (
        <p className="text-[10px] text-gray-300">
          Changes take effect immediately. Users may need to refresh their browser.
        </p>
      )}
    </div>
  )
}
