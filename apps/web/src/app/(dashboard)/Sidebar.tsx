'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { trackEvent } from '@/lib/analytics'

interface NavItem {
  href: string
  label: string
  icon: string
  onboardingOnly?: boolean
  suiteOnly?: boolean
  requireModule?: string
}

const NAV: NavItem[] = [
  { href: '/onboarding', label: 'Setup', icon: '◆', onboardingOnly: true },
  { href: '/dashboard', label: 'Dashboard', icon: '▦' },
  { href: '/inbox', label: 'Inbox', icon: '◻', suiteOnly: true },
  { href: '/contacts', label: 'Contacts', icon: '◎', suiteOnly: true, requireModule: 'crm' },
  {
    href: '/companies',
    label: 'Companies',
    icon: '◧',
    suiteOnly: true,
    requireModule: 'companies',
  },
  { href: '/pipeline', label: 'Pipeline', icon: '◈', suiteOnly: true, requireModule: 'pipeline' },
  { href: '/deals', label: 'Deals', icon: '◆', suiteOnly: true, requireModule: 'deals' },
  {
    href: '/appointments',
    label: 'Appointments',
    icon: '◷',
    suiteOnly: true,
    requireModule: 'appointments',
  },
  { href: '/calls', label: 'Call Log', icon: '◉', requireModule: 'maya' },
  {
    href: '/automation',
    label: 'Automation',
    icon: '⚡',
    suiteOnly: true,
    requireModule: 'automation',
  },
  { href: '/insights', label: 'Insights', icon: '▤', suiteOnly: true, requireModule: 'insights' },
  { href: '/quotes', label: 'Quotes', icon: '◫', suiteOnly: true, requireModule: 'cpq' },
  { href: '/reports', label: 'Reports', icon: '📊', suiteOnly: true },
  { href: '/tasks', label: 'Tasks', icon: '☑', suiteOnly: true },
  { href: '/settings/voice', label: 'Voice AI', icon: '◇', requireModule: 'maya' },
  { href: '/settings/locations', label: 'Locations', icon: '◩', suiteOnly: true },
  {
    href: '/settings/follow-ups',
    label: 'Follow-ups',
    icon: '↻',
    suiteOnly: true,
    requireModule: 'automation',
  },
  {
    href: '/settings/cpq',
    label: 'Quote Settings',
    icon: '⚙',
    suiteOnly: true,
    requireModule: 'cpq',
  },
  { href: '/settings/import', label: 'Import', icon: '↑', suiteOnly: true },
  { href: '/settings/audit', label: 'Audit Log', icon: '▧', suiteOnly: true },
  { href: '/settings/modules', label: 'Modules', icon: '▣', suiteOnly: true },
  { href: '/settings/integrations', label: 'Integrations', icon: '🔗', suiteOnly: true },
  { href: '/settings/email-templates', label: 'Email Templates', icon: '📧', suiteOnly: true },
  { href: '/settings/booking', label: 'Online Booking', icon: '📅', suiteOnly: true },
  { href: '/settings/intake-forms', label: 'Intake Forms', icon: '📋', suiteOnly: true },
  { href: '/settings/lead-scoring', label: 'Lead Scoring', icon: '📊', suiteOnly: true },
  { href: '/settings/automation', label: 'Review Auto', icon: '⭐', suiteOnly: true },
  { href: '/settings/notifications', label: 'Notifications', icon: '🔔', suiteOnly: true },
  { href: '/settings/pipelines', label: 'Pipelines', icon: '🔀', suiteOnly: true },
  { href: '/settings/chat-widget', label: 'Chat Widget', icon: '💬', suiteOnly: true },
  { href: '/settings/data-export', label: 'Data Export', icon: '📥', suiteOnly: true },
  { href: '/settings/calendar', label: 'Calendar', icon: '📆', suiteOnly: true },
  { href: '/settings', label: 'Settings', icon: '◌' },
]

export default function Sidebar() {
  const path = usePathname()
  const [onboardingDone, setOnboardingDone] = useState(true)
  const [product, setProduct] = useState<'maya_only' | 'suite'>('suite')
  const [modules, setModules] = useState<Record<string, boolean>>({})
  const [unreadSms, setUnreadSms] = useState(0)

  useEffect(() => {
    void fetch('/api/sms/unread-count')
      .then((r) => r.json())
      .then((d: { count: number }) => setUnreadSms(d.count))
      .catch(() => {})
  }, [path]) // re-fetch when navigating

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
  // If modules is empty (not loaded or missing), treat all as enabled — never lock user out
  const moduleEnabled = (m: string) => modules[m] !== false

  const visibleNav = NAV.filter((item) => {
    if (item.onboardingOnly && onboardingDone) return false
    if (item.suiteOnly && isMayaOnly) return false
    if (item.requireModule && !moduleEnabled(item.requireModule)) return false
    return true
  })

  return (
    <aside className="w-56 bg-white border-r border-border-brand flex flex-col shrink-0">
      {/* Brand */}
      <div className="px-5 py-5 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center shrink-0">
            <span className="text-white text-sm font-bold">N</span>
          </div>
          <div>
            <p className="font-display text-[22px] tracking-tight text-ink leading-none">
              Nua<span className="text-accent">tis</span>
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5 leading-none">
              {isMayaOnly ? 'Maya AI' : 'Front Office AI'}
            </p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {visibleNav.map((item) => {
          const active =
            path === item.href || (item.href !== '/settings' && path.startsWith(item.href + '/'))
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`
                flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors
                ${
                  active
                    ? 'bg-teal-50 text-teal-700 font-medium'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                }
              `}
            >
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

        {/* Upgrade CTA for maya_only */}
        {isMayaOnly && (
          <Link
            href="/upgrade"
            onClick={() => void trackEvent('upgrade_cta_clicked', { source: 'sidebar' })}
            className="flex items-center gap-3 px-3 py-2.5 mt-2 rounded-lg text-sm font-medium bg-teal-600 text-white hover:bg-teal-700 transition-colors"
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
