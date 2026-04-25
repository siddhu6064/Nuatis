'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { trackEvent } from '@/lib/analytics'

// ── Types ─────────────────────────────────────────────────────────────────────

interface NavItem {
  href: string
  label: string
  icon: string
  onboardingOnly?: boolean
  suiteOnly?: boolean
  requireModule?: string
}

interface NavGroup {
  id: string
  label: string
  items: NavItem[]
}

type GroupState = Record<string, boolean>

// ── Static nav data ───────────────────────────────────────────────────────────

const TOP_NAV: NavItem[] = [
  { href: '/onboarding', label: 'Setup', icon: '◆', onboardingOnly: true },
  { href: '/dashboard', label: 'Dashboard', icon: '▦' },
  { href: '/inbox', label: 'Inbox', icon: '◻', suiteOnly: true },
]

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'maya',
    label: 'Maya',
    items: [{ href: '/calls', label: 'Call Log', icon: '◉', requireModule: 'maya' }],
  },
  {
    id: 'customers',
    label: 'Customers',
    items: [
      { href: '/contacts', label: 'Contacts', icon: '◎', suiteOnly: true, requireModule: 'crm' },
      {
        href: '/companies',
        label: 'Companies',
        icon: '◧',
        suiteOnly: true,
        requireModule: 'companies',
      },
      { href: '/settings/lead-scoring', label: 'Lead Scoring', icon: '📊', suiteOnly: true },
    ],
  },
  {
    id: 'scheduling',
    label: 'Scheduling',
    items: [
      {
        href: '/appointments',
        label: 'Appointments',
        icon: '◷',
        suiteOnly: true,
        requireModule: 'appointments',
      },
      { href: '/settings/booking', label: 'Online Booking', icon: '📅', suiteOnly: true },
      { href: '/settings/intake-forms', label: 'Intake Forms', icon: '📋', suiteOnly: true },
      { href: '/settings/calendar', label: 'Calendar', icon: '📆', suiteOnly: true },
    ],
  },
  {
    id: 'sales',
    label: 'Sales',
    items: [
      {
        href: '/pipeline',
        label: 'Pipeline',
        icon: '◈',
        suiteOnly: true,
        requireModule: 'pipeline',
      },
      { href: '/deals', label: 'Deals', icon: '◆', suiteOnly: true, requireModule: 'deals' },
      { href: '/quotes', label: 'Quotes', icon: '◫', suiteOnly: true, requireModule: 'cpq' },
      { href: '/settings/pipelines', label: 'Pipelines', icon: '🔀', suiteOnly: true },
      { href: '/reports', label: 'Reports', icon: '📊', suiteOnly: true },
      {
        href: '/insights',
        label: 'Insights',
        icon: '▤',
        suiteOnly: true,
        requireModule: 'insights',
      },
    ],
  },
  {
    id: 'automation',
    label: 'Automation',
    items: [
      {
        href: '/automation',
        label: 'Automation',
        icon: '⚡',
        suiteOnly: true,
        requireModule: 'automation',
      },
      {
        href: '/settings/follow-ups',
        label: 'Follow-ups',
        icon: '↻',
        suiteOnly: true,
        requireModule: 'automation',
      },
      {
        href: '/settings/email-templates',
        label: 'Email Templates',
        icon: '📧',
        suiteOnly: true,
      },
      { href: '/settings/automation', label: 'Review Auto', icon: '⭐', suiteOnly: true },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { href: '/inventory', label: 'Inventory', icon: '◨', suiteOnly: true, requireModule: 'crm' },
      { href: '/staff', label: 'Staff', icon: '👥', suiteOnly: true, requireModule: 'crm' },
      { href: '/tasks', label: 'Tasks', icon: '☑', suiteOnly: true },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    items: [
      { href: '/settings/voice', label: 'Voice AI', icon: '◇', requireModule: 'maya' },
      { href: '/settings/locations', label: 'Locations', icon: '◩', suiteOnly: true },
      { href: '/settings/modules', label: 'Modules', icon: '▣', suiteOnly: true },
      { href: '/settings/integrations', label: 'Integrations', icon: '🔗', suiteOnly: true },
      { href: '/settings/notifications', label: 'Notifications', icon: '🔔', suiteOnly: true },
      {
        href: '/settings/cpq',
        label: 'Quote Settings',
        icon: '⚙',
        suiteOnly: true,
        requireModule: 'cpq',
      },
      {
        href: '/settings/inventory',
        label: 'Inventory Settings',
        icon: '⚙',
        suiteOnly: true,
        requireModule: 'crm',
      },
      { href: '/settings/audit', label: 'Audit Log', icon: '▧', suiteOnly: true },
      { href: '/settings/data-export', label: 'Data Export', icon: '📥', suiteOnly: true },
      { href: '/settings/import', label: 'Import', icon: '↑', suiteOnly: true },
      { href: '/settings/chat-widget', label: 'Chat Widget', icon: '💬', suiteOnly: true },
      { href: '/settings', label: 'Settings', icon: '◌' },
    ],
  },
]

const LS_KEY = 'nuatis_sidebar_groups'

// ── Group state helpers ───────────────────────────────────────────────────────

function computeActiveGroups(activePath: string): GroupState {
  const state: GroupState = {}
  for (const group of NAV_GROUPS) {
    state[group.id] = group.items.some(
      (item) =>
        activePath === item.href ||
        (item.href !== '/settings' && activePath.startsWith(item.href + '/'))
    )
  }
  return state
}

function loadGroupState(activePath: string): GroupState {
  const active = computeActiveGroups(activePath)
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const saved = JSON.parse(raw) as GroupState
      // Merge: keep saved values but force-open any active group
      const merged = { ...saved }
      for (const [id, isActive] of Object.entries(active)) {
        if (isActive) merged[id] = true
      }
      return merged
    }
  } catch {
    // ignore storage errors
  }
  // First visit: open active group, close everything else
  return active
}

function saveGroupState(state: GroupState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state))
  } catch {
    // ignore storage errors
  }
}

// ── Chevron icon ──────────────────────────────────────────────────────────────

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-3 h-3 shrink-0 transition-transform duration-200 ${open ? 'rotate-0' : '-rotate-90'}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M19 9l-7 7-7-7" />
    </svg>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Sidebar() {
  const path = usePathname()
  const [onboardingDone, setOnboardingDone] = useState(true)
  const [product, setProduct] = useState<'maya_only' | 'suite'>('suite')
  const [modules, setModules] = useState<Record<string, boolean>>({})
  const [unreadSms, setUnreadSms] = useState(0)
  const [lowStockCount, setLowStockCount] = useState(0)
  // Start all collapsed on SSR; hydrate from localStorage in effect
  const [groupOpen, setGroupOpen] = useState<GroupState>(() =>
    NAV_GROUPS.reduce((acc, g) => ({ ...acc, [g.id]: false }), {} as GroupState)
  )

  // Hydrate group state from localStorage on mount (runs once)
  useEffect(() => {
    setGroupOpen(loadGroupState(path))
  }, []) // intentional: only read storage on initial mount

  // Auto-expand active group on route change (never close others)
  useEffect(() => {
    const active = computeActiveGroups(path)
    setGroupOpen((prev) => {
      let changed = false
      const next = { ...prev }
      for (const [id, isActive] of Object.entries(active)) {
        if (isActive && !next[id]) {
          next[id] = true
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [path])

  useEffect(() => {
    void fetch('/api/sms/unread-count')
      .then((r) => r.json())
      .then((d: { count: number }) => setUnreadSms(d.count))
      .catch(() => {})
  }, [path])

  useEffect(() => {
    if (modules['crm'] === false) return undefined
    const fetchLowStock = () => {
      void fetch('/api/inventory?count=true&low_stock=true')
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { count?: number } | null) => {
          if (d && typeof d.count === 'number') setLowStockCount(d.count)
        })
        .catch(() => {})
    }
    fetchLowStock()
    const id = setInterval(fetchLowStock, 5 * 60 * 1000)
    return () => clearInterval(id)
  }, [modules])

  useEffect(() => {
    fetch('/api/auth/session')
      .then((r) => r.json())
      .then(
        (s: {
          user?: {
            tenantId?: string
            modules?: Record<string, boolean>
          }
        }) => {
          if (!s?.user?.tenantId) return
          if (s.user.modules) setModules(s.user.modules)
          fetch('/api/provisioning/onboarding-status')
            .then((r) => (r.ok ? r.json() : null))
            .then((data: { onboarding_completed?: boolean; product?: string } | null) => {
              if (data) {
                setOnboardingDone(data.onboarding_completed ?? true)
                if (data.product === 'maya_only') setProduct('maya_only')
              }
            })
            .catch(() => {})
        }
      )
      .catch(() => {})
  }, [])

  const isMayaOnly = product === 'maya_only'
  const moduleEnabled = (m: string) => modules[m] !== false

  function itemVisible(item: NavItem): boolean {
    if (item.onboardingOnly && onboardingDone) return false
    if (item.suiteOnly && isMayaOnly) return false
    if (item.requireModule && !moduleEnabled(item.requireModule)) return false
    return true
  }

  function isActive(item: NavItem): boolean {
    return path === item.href || (item.href !== '/settings' && path.startsWith(item.href + '/'))
  }

  function toggleGroup(id: string) {
    setGroupOpen((prev) => {
      const next = { ...prev, [id]: !prev[id] }
      saveGroupState(next)
      return next
    })
  }

  function navLinkClass(active: boolean, indent = false) {
    return [
      'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
      indent ? 'pl-6' : '',
      active
        ? 'bg-teal-50 text-teal-700 font-medium'
        : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900',
    ]
      .join(' ')
      .trim()
  }

  return (
    <aside className="w-56 bg-white border-r border-border-brand flex flex-col shrink-0">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center shrink-0">
            <span className="text-white text-sm font-bold">N</span>
          </div>
          <div>
            <p className="font-display font-bold text-[22px] tracking-tight text-ink leading-none">
              Nu<span className="text-accent">atis</span>
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5 leading-none">
              {isMayaOnly ? 'Maya AI' : 'Front Office AI'}
            </p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        {/* Always-visible top items */}
        <div className="space-y-0.5">
          {TOP_NAV.filter(itemVisible).map((item) => {
            const active = isActive(item)
            return (
              <Link key={item.href} href={item.href} className={navLinkClass(active)}>
                <span className="text-base leading-none">{item.icon}</span>
                <span>{item.label}</span>
                {item.onboardingOnly && (
                  <span className="ml-auto text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">
                    NEW
                  </span>
                )}
                {item.href === '/inbox' && unreadSms > 0 && (
                  <span className="ml-auto px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-500 text-white">
                    {unreadSms > 99 ? '99+' : unreadSms}
                  </span>
                )}
              </Link>
            )
          })}
        </div>

        {/* Grouped sections */}
        {NAV_GROUPS.map((group) => {
          const visibleItems = group.items.filter(itemVisible)
          if (visibleItems.length === 0) return null
          const open = groupOpen[group.id] ?? false

          return (
            <div key={group.id} className="mt-3">
              {/* Group header */}
              <button
                type="button"
                onClick={() => toggleGroup(group.id)}
                className="w-full flex items-center justify-between px-3 py-1 rounded hover:bg-gray-50 transition-colors cursor-pointer"
              >
                <span className="text-[11px] font-semibold uppercase tracking-[0.5px] text-gray-400">
                  {group.label}
                </span>
                <Chevron open={open} />
              </button>

              {/* Collapsible items */}
              <div
                style={{
                  maxHeight: open ? '600px' : '0',
                  overflow: 'hidden',
                  transition: 'max-height 200ms ease-in-out',
                }}
              >
                <div className="mt-0.5 space-y-0.5">
                  {visibleItems.map((item) => {
                    const active = isActive(item)
                    return (
                      <Link key={item.href} href={item.href} className={navLinkClass(active, true)}>
                        <span className="text-base leading-none">{item.icon}</span>
                        <span>{item.label}</span>
                        {item.href === '/inventory' && lowStockCount > 0 && (
                          <span
                            className="ml-auto w-2 h-2 rounded-full bg-amber-400 shrink-0"
                            aria-label={`${lowStockCount} low-stock item(s)`}
                          />
                        )}
                      </Link>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}

        {/* Upgrade CTA for maya_only */}
        {isMayaOnly && (
          <Link
            href="/upgrade"
            onClick={() => void trackEvent('upgrade_cta_clicked', { source: 'sidebar' })}
            className="flex items-center gap-3 px-3 py-2.5 mt-4 rounded-lg text-sm font-medium bg-teal-600 text-white hover:bg-teal-700 transition-colors"
          >
            <span className="text-base leading-none">⬆</span>
            <span>Upgrade to Suite</span>
          </Link>
        )}
      </nav>

      {/* User footer */}
      <div className="px-4 py-4 border-t border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
            <span className="text-teal-700 text-xs font-bold">S</span>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-gray-900 truncate">Nuatis LLC</p>
            <p className="text-[10px] text-gray-400 truncate">sid@nuatis.com</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
