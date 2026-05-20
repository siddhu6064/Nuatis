'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { trackEvent } from '@/lib/analytics'
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd'
import type { DropResult } from '@hello-pangea/dnd'

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
  { href: '/dashboard', label: 'Dashboard', icon: '▦' },
  { href: '/inbox', label: 'Inbox', icon: '◻', suiteOnly: true },
  { href: '/insights', label: 'Insights', icon: '▤', suiteOnly: true, requireModule: 'insights' },
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
      { href: '/conversations', label: 'Conversations', icon: '💬', suiteOnly: true },
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
      { href: '/settings/availability', label: 'Availability', icon: '🕐', suiteOnly: true },
      { href: '/settings/calendar-groups', label: 'Calendar Groups', icon: '◈', suiteOnly: true },
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
      {
        href: '/quotes/payment-links',
        label: 'Payment Links',
        icon: '🔗',
        suiteOnly: true,
        requireModule: 'cpq',
      },
      {
        href: '/quotes/ledger',
        label: 'Ledger',
        icon: '📒',
        suiteOnly: true,
        requireModule: 'cpq',
      },
      { href: '/reports', label: 'Reports', icon: '📊', suiteOnly: true },
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
      { href: '/reputation', label: 'Reputation', icon: '★', suiteOnly: true },
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
      // Setup first — only visible during onboarding
      { href: '/onboarding', label: 'Setup', icon: '◆', onboardingOnly: true },
      {
        href: '/settings/business-profile',
        label: 'Business Profile',
        icon: '▦',
        requireModule: 'maya',
      },
      { href: '/settings/voice', label: 'Voice AI', icon: '◇', requireModule: 'maya' },
      { href: '/settings/locations', label: 'Locations', icon: '◩', suiteOnly: true },
      { href: '/settings/modules', label: 'Modules', icon: '▣', suiteOnly: true },
      { href: '/settings/integrations', label: 'Integrations', icon: '🔗', suiteOnly: true },
      { href: '/settings/notifications', label: 'Notifications', icon: '🔔', suiteOnly: true },
      { href: '/settings/payments', label: 'Payments', icon: '💳', suiteOnly: true },
      { href: '/settings/pipelines', label: 'Pipelines', icon: '🔀', suiteOnly: true },
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
      { href: '/settings/sms-health', label: 'Delivery Health', icon: '📊', suiteOnly: true },
      { href: '/settings/audit-log', label: 'Audit Log', icon: '🛡', suiteOnly: true },
      { href: '/settings/data-export', label: 'Data Export', icon: '📥', suiteOnly: true },
      { href: '/settings/reports', label: 'Scheduled Reports', icon: '📨', suiteOnly: true },
      { href: '/settings/import', label: 'Import', icon: '↑', suiteOnly: true },
      { href: '/settings/chat-widget', label: 'Chat Widget', icon: '💬', suiteOnly: true },
      { href: '/settings/trigger-links', label: 'Trigger Links', icon: '🔗', suiteOnly: true },
      { href: '/settings/snippets', label: 'Snippets', icon: '✂', suiteOnly: true },
    ],
  },
]

// Settings is always pinned to the bottom — excluded from drag ordering
const SETTINGS_ID = 'settings'
const REORDERABLE_IDS = NAV_GROUPS.filter((g) => g.id !== SETTINGS_ID).map((g) => g.id)

const LS_KEY = 'nuatis_sidebar_groups'
const ORDER_LS_KEY = 'nuatis_sidebar_order'
const ITEMS_LS_PREFIX = 'nuatis_sidebar_items_'

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
      const merged = { ...saved }
      for (const [id, isActive] of Object.entries(active)) {
        if (isActive) merged[id] = true
      }
      return merged
    }
  } catch {
    // ignore storage errors
  }
  return active
}

function saveGroupState(state: GroupState) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state))
  } catch {
    // ignore storage errors
  }
}

function loadNavOrder(): string[] {
  try {
    const raw = localStorage.getItem(ORDER_LS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as string[]
      const validSet = new Set(REORDERABLE_IDS)
      const filtered = parsed.filter((id) => validSet.has(id))
      const savedSet = new Set(filtered)
      const missing = REORDERABLE_IDS.filter((id) => !savedSet.has(id))
      return [...filtered, ...missing]
    }
  } catch {
    // ignore
  }
  return REORDERABLE_IDS
}

function saveNavOrder(order: string[]) {
  try {
    localStorage.setItem(ORDER_LS_KEY, JSON.stringify(order))
  } catch {
    // ignore
  }
}

function loadItemOrder(groupId: string, items: NavItem[]): string[] {
  const allHrefs = items.map((i) => i.href)
  try {
    const raw = localStorage.getItem(ITEMS_LS_PREFIX + groupId)
    if (raw) {
      const parsed = JSON.parse(raw) as string[]
      const validSet = new Set(allHrefs)
      const filtered = parsed.filter((h) => validSet.has(h))
      const savedSet = new Set(filtered)
      const missing = allHrefs.filter((h) => !savedSet.has(h))
      return [...filtered, ...missing]
    }
  } catch {
    // ignore
  }
  return allHrefs
}

function saveItemOrder(groupId: string, order: string[]) {
  try {
    localStorage.setItem(ITEMS_LS_PREFIX + groupId, JSON.stringify(order))
  } catch {
    // ignore
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

export default function Sidebar({
  open = false,
  onClose,
}: {
  open?: boolean
  onClose?: () => void
}) {
  const path = usePathname()
  const mountedPath = useRef(path)
  const [onboardingDone, setOnboardingDone] = useState(true)
  const [product, setProduct] = useState<'maya_only' | 'suite'>('suite')
  const [modules, setModules] = useState<Record<string, boolean>>({})
  const [unreadSms, setUnreadSms] = useState(0)
  const [openConversations, setOpenConversations] = useState(0)
  const [lowStockCount, setLowStockCount] = useState(0)
  const [userName, setUserName] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [popoverOpen, setPopoverOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [groupOpen, setGroupOpen] = useState<GroupState>(() =>
    NAV_GROUPS.reduce((acc, g) => ({ ...acc, [g.id]: false }), {} as GroupState)
  )
  const [navOrder, setNavOrder] = useState<string[]>(REORDERABLE_IDS)
  const [itemOrders, setItemOrders] = useState<Record<string, string[]>>(() =>
    NAV_GROUPS.reduce<Record<string, string[]>>((acc, g) => {
      acc[g.id] = g.items.map((i) => i.href)
      return acc
    }, {})
  )

  // Hydrate from localStorage on mount
  useEffect(() => {
    setGroupOpen(loadGroupState(path))
    setNavOrder(loadNavOrder())
    const orders: Record<string, string[]> = {}
    for (const group of NAV_GROUPS) {
      orders[group.id] = loadItemOrder(group.id, group.items)
    }
    setItemOrders(orders)
  }, []) // intentional: only read storage on initial mount

  // Auto-expand active group on route change
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

  // Close mobile drawer on navigation (skip initial mount)
  useEffect(() => {
    if (path === mountedPath.current) return
    onClose?.()
  }, [path, onClose])

  useEffect(() => {
    void fetch('/api/sms/unread-count')
      .then((r) => r.json())
      .then((d: { count: number }) => setUnreadSms(d.count))
      .catch(() => {})
  }, [path])

  useEffect(() => {
    void fetch('/api/conversations?status=open&limit=1')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { total?: number } | null) => {
        if (d && typeof d.total === 'number') setOpenConversations(d.total)
      })
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
            name?: string
            email?: string
          }
        }) => {
          if (!s?.user?.tenantId) return
          if (s.user.modules) setModules(s.user.modules)
          if (s.user.name) setUserName(s.user.name)
          if (s.user.email) setUserEmail(s.user.email)
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

  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ modules: Record<string, boolean> }>
      if (ce.detail?.modules) setModules(ce.detail.modules)
    }
    window.addEventListener('nuatis:modules-changed', handler)
    return () => window.removeEventListener('nuatis:modules-changed', handler)
  }, [])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverOpen(false)
      }
    }
    if (popoverOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [popoverOpen])

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

  function handleDragEnd(result: DropResult) {
    if (!result.destination) return
    const { source, destination } = result

    // Section reorder
    if (source.droppableId === 'sidebar-sections') {
      if (source.index === destination.index) return
      const next = [...navOrder]
      const [moved] = next.splice(source.index, 1)
      next.splice(destination.index, 0, moved!)
      setNavOrder(next)
      saveNavOrder(next)
      return
    }

    // Item reorder within a section (no cross-section drops)
    if (source.droppableId.endsWith('-items') && source.droppableId === destination.droppableId) {
      if (source.index === destination.index) return
      const groupId = source.droppableId.slice(0, -6) // strip '-items'
      const group = NAV_GROUPS.find((g) => g.id === groupId)
      if (!group) return

      const hrefToItem = Object.fromEntries(group.items.map((i) => [i.href, i]))
      const current = itemOrders[groupId] ?? group.items.map((i) => i.href)

      // Visible hrefs in current order — these match the Draggable indices
      const visibleHrefs = current.filter((h) => {
        const item = hrefToItem[h]
        return item && itemVisible(item)
      })

      const movedHref = visibleHrefs[source.index]!
      const targetHref = visibleHrefs[destination.index]!

      // Remove moved item from full list, then re-insert near target
      const withoutMoved = current.filter((h) => h !== movedHref)
      const targetPos = withoutMoved.indexOf(targetHref)
      const insertAt = source.index < destination.index ? targetPos + 1 : targetPos
      const next = [...withoutMoved]
      next.splice(insertAt, 0, movedHref)

      setItemOrders((prev) => ({ ...prev, [groupId]: next }))
      saveItemOrder(groupId, next)
    }
  }

  function resetOrder() {
    setNavOrder(REORDERABLE_IDS)
    const defaultOrders = NAV_GROUPS.reduce<Record<string, string[]>>((acc, g) => {
      acc[g.id] = g.items.map((i) => i.href)
      return acc
    }, {})
    setItemOrders(defaultOrders)
    try {
      localStorage.removeItem(ORDER_LS_KEY)
      const keysToRemove: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (key?.startsWith(ITEMS_LS_PREFIX)) keysToRemove.push(key)
      }
      for (const key of keysToRemove) localStorage.removeItem(key)
    } catch {
      // ignore
    }
  }

  function navLinkClass(active: boolean) {
    return [
      'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
      active ? 'bg-teal-50 text-teal-700 font-medium' : 'text-ink3 hover:bg-bg hover:text-ink',
    ]
      .join(' ')
      .trim()
  }

  function renderGroupItems(group: NavGroup) {
    const hrefToItem = Object.fromEntries(group.items.map((i) => [i.href, i]))
    const current = itemOrders[group.id] ?? group.items.map((i) => i.href)
    const orderedItems = current
      .map((h) => hrefToItem[h])
      .filter((item): item is NavItem => item !== undefined && itemVisible(item))
    const open = groupOpen[group.id] ?? false

    return (
      <div
        style={{
          maxHeight: open ? '600px' : '0',
          overflow: 'hidden',
          transition: 'max-height 200ms ease-in-out',
        }}
      >
        <Droppable droppableId={`${group.id}-items`} type="item">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps} className="mt-0.5">
              {orderedItems.map((item, index) => {
                const active = isActive(item)
                return (
                  <Draggable key={item.href} draggableId={item.href} index={index}>
                    {(dragProvided, dragSnapshot) => (
                      <div
                        ref={dragProvided.innerRef}
                        {...dragProvided.draggableProps}
                        className={`group/item flex items-center rounded-lg mb-0.5 transition-colors ${
                          active ? 'bg-teal-50' : 'hover:bg-bg'
                        }`}
                        style={{
                          opacity: dragSnapshot.isDragging ? 0.8 : 1,
                          ...dragProvided.draggableProps.style,
                        }}
                      >
                        <span
                          {...dragProvided.dragHandleProps}
                          className="pl-2 pr-0.5 shrink-0 text-xs text-ink4 leading-none opacity-0 group-hover/item:opacity-100 transition-opacity cursor-grab active:cursor-grabbing select-none"
                          aria-label="Drag to reorder"
                        >
                          ⠿
                        </span>
                        <Link
                          href={item.href}
                          className={`flex-1 flex items-center gap-3 pl-1 pr-3 py-2 text-sm rounded-r-lg transition-colors ${
                            active ? 'text-teal-700 font-medium' : 'text-ink3 hover:text-ink'
                          }`}
                        >
                          <span className="text-base leading-none">{item.icon}</span>
                          <span>{item.label}</span>
                          {item.onboardingOnly && (
                            <span className="ml-auto text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">
                              NEW
                            </span>
                          )}
                          {item.href === '/inventory' && lowStockCount > 0 && (
                            <span
                              className="ml-auto w-2 h-2 rounded-full bg-amber-400 shrink-0"
                              aria-label={`${lowStockCount} low-stock item(s)`}
                            />
                          )}
                          {item.href === '/conversations' && openConversations > 0 && (
                            <span className="ml-auto px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-500 text-white">
                              {openConversations > 99 ? '99+' : openConversations}
                            </span>
                          )}
                        </Link>
                      </div>
                    )}
                  </Draggable>
                )
              })}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </div>
    )
  }

  // Ordered reorderable groups, then settings always last
  const orderedGroups = navOrder
    .map((id) => NAV_GROUPS.find((g) => g.id === id))
    .filter((g): g is NavGroup => g !== undefined)
  const settingsGroup = NAV_GROUPS.find((g) => g.id === SETTINGS_ID)!

  return (
    <aside
      className={`w-56 bg-white border-r border-border-brand flex flex-col shrink-0 transition-transform duration-200 fixed inset-y-0 left-0 z-30 md:relative md:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Brand */}
      <div className="px-5 py-5 border-b border-border-brand">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center shrink-0">
            <span className="text-white text-sm font-bold">N</span>
          </div>
          <div>
            <p className="font-display font-bold text-[22px] tracking-tight text-ink leading-none">
              Nu<span className="text-teal-brand">atis</span>
            </p>
            <p className="text-[10px] text-ink4 mt-0.5 leading-none">
              {isMayaOnly ? 'Maya AI' : 'Front Office AI'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="md:hidden ml-auto p-1 rounded-lg text-ink4 hover:bg-bg transition-colors"
            aria-label="Close menu"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
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
                {item.href === '/inbox' && unreadSms > 0 && (
                  <span className="ml-auto px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-500 text-white">
                    {unreadSms > 99 ? '99+' : unreadSms}
                  </span>
                )}
              </Link>
            )
          })}
        </div>

        {/* Single DragDropContext for both section and item reordering */}
        <DragDropContext onDragEnd={handleDragEnd}>
          {/* Draggable sections */}
          <Droppable droppableId="sidebar-sections" type="section">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps}>
                {orderedGroups.map((group, index) => {
                  const visibleItems = group.items.filter(itemVisible)
                  if (visibleItems.length === 0) return null
                  const open = groupOpen[group.id] ?? false
                  return (
                    <Draggable key={group.id} draggableId={group.id} index={index}>
                      {(dragProvided, dragSnapshot) => (
                        <div
                          ref={dragProvided.innerRef}
                          {...dragProvided.draggableProps}
                          className="mt-3 group/section"
                          style={{
                            ...dragProvided.draggableProps.style,
                            opacity: dragSnapshot.isDragging ? 0.85 : 1,
                          }}
                        >
                          {/* Group header row */}
                          <div className="flex items-center px-1 py-1 rounded hover:bg-bg transition-colors">
                            {/* Drag handle */}
                            <span
                              {...dragProvided.dragHandleProps}
                              className="text-ink4 text-sm leading-none opacity-0 group-hover/section:opacity-100 transition-opacity cursor-grab active:cursor-grabbing select-none mr-1 shrink-0"
                              aria-label="Drag to reorder section"
                            >
                              ⠿
                            </span>
                            {/* Expand / collapse */}
                            <button
                              type="button"
                              onClick={() => toggleGroup(group.id)}
                              className="flex-1 flex items-center justify-between px-2 py-0 rounded cursor-pointer"
                            >
                              <span className="text-[11px] font-semibold uppercase tracking-[0.5px] text-ink4">
                                {group.label}
                              </span>
                              <Chevron open={open} />
                            </button>
                          </div>

                          {/* Collapsible items with per-section DnD */}
                          {renderGroupItems(group)}
                        </div>
                      )}
                    </Draggable>
                  )
                })}
                {provided.placeholder}
              </div>
            )}
          </Droppable>

          {/* Settings — always pinned last, not draggable as a section */}
          {(() => {
            const hrefToItem = Object.fromEntries(settingsGroup.items.map((i) => [i.href, i]))
            const current = itemOrders[SETTINGS_ID] ?? settingsGroup.items.map((i) => i.href)
            const orderedItems = current
              .map((h) => hrefToItem[h])
              .filter((item): item is NavItem => item !== undefined && itemVisible(item))
            if (orderedItems.length === 0) return null
            const open = groupOpen[SETTINGS_ID] ?? false
            return (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => toggleGroup(SETTINGS_ID)}
                  className="w-full flex items-center justify-between px-3 py-1 rounded hover:bg-bg transition-colors cursor-pointer"
                >
                  <span className="text-[11px] font-semibold uppercase tracking-[0.5px] text-ink4">
                    {settingsGroup.label}
                  </span>
                  <Chevron open={open} />
                </button>
                <div
                  style={{
                    maxHeight: open ? '600px' : '0',
                    overflow: 'hidden',
                    transition: 'max-height 200ms ease-in-out',
                  }}
                >
                  <Droppable droppableId="settings-items" type="item">
                    {(provided) => (
                      <div ref={provided.innerRef} {...provided.droppableProps} className="mt-0.5">
                        {orderedItems.map((item, index) => {
                          const active = isActive(item)
                          return (
                            <Draggable key={item.href} draggableId={item.href} index={index}>
                              {(dragProvided, dragSnapshot) => (
                                <div
                                  ref={dragProvided.innerRef}
                                  {...dragProvided.draggableProps}
                                  className={`group/item flex items-center rounded-lg mb-0.5 transition-colors ${
                                    active ? 'bg-teal-50' : 'hover:bg-bg'
                                  }`}
                                  style={{
                                    opacity: dragSnapshot.isDragging ? 0.8 : 1,
                                    ...dragProvided.draggableProps.style,
                                  }}
                                >
                                  <span
                                    {...dragProvided.dragHandleProps}
                                    className="pl-2 pr-0.5 shrink-0 text-xs text-ink4 leading-none opacity-0 group-hover/item:opacity-100 transition-opacity cursor-grab active:cursor-grabbing select-none"
                                    aria-label="Drag to reorder"
                                  >
                                    ⠿
                                  </span>
                                  <Link
                                    href={item.href}
                                    className={`flex-1 flex items-center gap-3 pl-1 pr-3 py-2 text-sm rounded-r-lg transition-colors ${
                                      active
                                        ? 'text-teal-700 font-medium'
                                        : 'text-ink3 hover:text-ink'
                                    }`}
                                  >
                                    <span className="text-base leading-none">{item.icon}</span>
                                    <span>{item.label}</span>
                                    {item.onboardingOnly && (
                                      <span className="ml-auto text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">
                                        NEW
                                      </span>
                                    )}
                                  </Link>
                                </div>
                              )}
                            </Draggable>
                          )
                        })}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>

                  {/* Reset order — inside Settings, always last */}
                  <button
                    type="button"
                    onClick={resetOrder}
                    className="w-full text-left pl-6 pr-3 py-2 font-mono text-[10px] text-ink4 hover:text-ink3 transition-colors"
                  >
                    ↺ Reset order
                  </button>
                </div>
              </div>
            )
          })()}
        </DragDropContext>

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
      <div className="px-4 py-4 border-t border-border-brand relative" ref={popoverRef}>
        {/* Popover */}
        {popoverOpen && (
          <div className="absolute bottom-full left-2 right-2 mb-2 bg-white rounded-xl border border-border-brand shadow-lg z-50 overflow-hidden">
            <div className="px-4 py-3">
              <p className="text-xs font-semibold text-ink truncate">{userName || 'User'}</p>
              <p className="text-[10px] text-ink4 truncate mt-0.5">{userEmail}</p>
            </div>
            <div className="border-t border-border-brand" />
            <button
              type="button"
              onClick={() => void signOut({ callbackUrl: '/api/auth/signin' })}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-red-600 hover:bg-red-50 transition-colors"
            >
              <svg
                className="w-3.5 h-3.5 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
              Sign out
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => setPopoverOpen((prev) => !prev)}
          className="w-full flex items-center gap-2.5 rounded-lg hover:bg-bg transition-colors p-1 -mx-1"
        >
          <div className="w-7 h-7 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
            <span className="text-teal-700 text-xs font-bold">
              {(userName || 'U')[0]?.toUpperCase()}
            </span>
          </div>
          <div className="min-w-0 text-left">
            <p className="text-xs font-medium text-ink truncate">{userName || 'User'}</p>
            <p className="text-[10px] text-ink4 truncate">{userEmail}</p>
          </div>
        </button>
      </div>
    </aside>
  )
}
