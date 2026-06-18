'use client'

import { useState } from 'react'

type PlanTier = 'core' | 'pro' | 'scale'

interface ModuleDisplay {
  key: string
  label: string
  description: string
  minPlan: PlanTier
  alwaysOn?: boolean
  hidden?: boolean
}

// TODO: mirrors apps/api/src/config/module-registry.ts (display metadata only —
// security validation lives on the API side). Keep in sync until @nuatis/shared
// hosts the registry. Hidden modules (companies/deals/appointments) are valid
// keys but render no toggle row here.
const MODULE_DISPLAY: ModuleDisplay[] = [
  {
    key: 'maya',
    label: 'Maya Voice AI',
    description: 'AI receptionist that answers calls, books appointments, and captures leads 24/7.',
    minPlan: 'core',
    alwaysOn: true,
  },
  {
    key: 'crm',
    label: 'CRM',
    description: 'Contacts, companies, deals, activity timeline, and lead scoring.',
    minPlan: 'core',
    alwaysOn: true,
  },
  {
    key: 'scheduling',
    label: 'Scheduling',
    description: 'Appointment booking, calendar sync, public booking page, and SMS reminders.',
    minPlan: 'core',
  },
  {
    key: 'pipeline',
    label: 'Pipeline',
    description: 'Lead Kanban, multi-pipeline support, stage probability, and revenue forecasting.',
    minPlan: 'core',
  },
  {
    key: 'automation',
    label: 'Automation',
    description:
      'BullMQ scanners for stalled leads, no-shows, lapsed clients, and review requests.',
    minPlan: 'pro',
  },
  {
    key: 'insights',
    label: 'Insights',
    description: 'Analytics dashboard, ROI reporting, Maya metrics, and custom report builder.',
    minPlan: 'pro',
  },
  {
    key: 'campaigns',
    label: 'AI Campaigns',
    description:
      'Segment-driven AI-generated campaigns across SMS, email, and social with approval gate.',
    minPlan: 'pro',
  },
  {
    key: 'cpq',
    label: 'CPQ',
    description:
      'Service catalog, quote builder, PDF proposals, payment links, and transaction ledger.',
    minPlan: 'scale',
  },
  // Hidden — valid keys, no toggle row.
  { key: 'companies', label: 'Companies', description: '', minPlan: 'core', hidden: true },
  { key: 'deals', label: 'Deals', description: '', minPlan: 'core', hidden: true },
  { key: 'appointments', label: 'Appointments', description: '', minPlan: 'core', hidden: true },
]

const TIER_ORDER: Record<PlanTier, number> = { core: 0, pro: 1, scale: 2 }
const PLAN_LABEL: Record<PlanTier, string> = { core: 'Core', pro: 'Pro', scale: 'Scale' }

interface Props {
  initialModules: Record<string, boolean>
  isOwner: boolean
  vertical: string
  plan: string | null
}

export default function ModuleSettings({ initialModules, isOwner, plan }: Props) {
  const [modules, setModules] = useState<Record<string, boolean>>(initialModules)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)

  // Tenant plan tier index. Null/unknown plan → core-level (lowest).
  const planIndex = plan && plan in TIER_ORDER ? TIER_ORDER[plan as PlanTier] : 0

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
        window.dispatchEvent(
          new CustomEvent('nuatis:modules-changed', { detail: { modules: data.modules } })
        )
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

  const visible = MODULE_DISPLAY.filter((m) => !m.hidden)

  return (
    <div className="space-y-6">
      {!isOwner && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <p className="text-sm text-amber-800">
            Contact your account owner to change module settings.
          </p>
        </div>
      )}

      <div className="bg-white rounded-xl border border-border-brand divide-y divide-border-brand">
        {visible.map((mod) => {
          // Comped: an explicit stored `true` keeps the module enabled regardless
          // of plan tier — the toggle stays interactive (never plan-disabled).
          const isComped = initialModules[mod.key] === true
          const meetsPlan = planIndex >= TIER_ORDER[mod.minPlan]
          const stored = modules[mod.key]
          const enabled = mod.alwaysOn ? true : typeof stored === 'boolean' ? stored : meetsPlan

          // A module is plan-locked only when it neither meets the plan nor is comped.
          const planLocked = !mod.alwaysOn && !meetsPlan && !isComped
          const interactive = isOwner && !mod.alwaysOn && !planLocked

          return (
            <div key={mod.key} className="px-6 py-4 flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-ink">{mod.label}</p>
                  {mod.alwaysOn && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-ink4">
                      Always included
                    </span>
                  )}
                  {!mod.alwaysOn && isComped && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-teal-50 text-teal-700">
                      Enabled
                    </span>
                  )}
                </div>
                <p className="text-xs text-ink4 mt-0.5">{mod.description}</p>
                {planLocked && (
                  <p className="text-[10px] mt-1 text-amber-600">
                    Available on {PLAN_LABEL[mod.minPlan]} plan —{' '}
                    <a href="/pricing" className="underline">
                      Upgrade
                    </a>
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`text-xs font-medium w-5 text-right ${enabled ? 'text-teal-600' : 'text-ink4'}`}
                >
                  {enabled ? 'On' : 'Off'}
                </span>
                <button
                  onClick={() => toggle(mod.key, !enabled)}
                  disabled={!interactive || toggling === mod.key}
                  aria-checked={enabled}
                  role="switch"
                  className={`relative w-10 h-5 rounded-full transition-colors ${
                    enabled ? 'bg-teal-600' : 'bg-gray-300'
                  } ${!interactive ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      enabled ? 'translate-x-5' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
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
