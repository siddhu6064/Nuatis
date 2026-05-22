'use client'

import { useState, useEffect } from 'react'
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
  type DraggableProvidedDragHandleProps,
} from '@hello-pangea/dnd'
import Link from 'next/link'
import PipelineFunnel from '@/components/dashboard/PipelineFunnel'
import LeadSourceReport from '@/components/dashboard/LeadSourceReport'
import GbpInsightsWidget from './GbpInsightsWidget'

// ── Widget IDs ─────────────────────────────────────────────────────────────────

const WIDGET_IDS = [
  'stat-cards',
  'pipeline-funnel',
  'lead-source',
  'google-profile',
  'activity-actions',
] as const
type WidgetId = (typeof WIDGET_IDS)[number]

const DEFAULT_ORDER: WidgetId[] = [...WIDGET_IDS]

// ── localStorage helpers ──────────────────────────────────────────────────────

const LS_KEY = 'nuatis-dashboard-layout'

function loadOrder(): WidgetId[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as string[]
      const validSet = new Set<string>(WIDGET_IDS)
      const filtered = parsed.filter((id): id is WidgetId => validSet.has(id))
      const savedSet = new Set(filtered)
      const missing = WIDGET_IDS.filter((id) => !savedSet.has(id))
      return [...filtered, ...missing]
    }
  } catch {
    // ignore storage errors
  }
  return DEFAULT_ORDER
}

function saveOrder(order: WidgetId[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(order))
  } catch {
    // ignore storage errors
  }
}

// ── Static constants ──────────────────────────────────────────────────────────

const COLOR: Record<string, string> = {
  teal: 'bg-teal-50 text-teal-600',
  blue: 'bg-blue-50 text-blue-600',
  amber: 'bg-amber-50 text-amber-600',
  purple: 'bg-purple-50 text-purple-600',
}

const ACTIONS = [
  { label: 'Add Contact', icon: '+', href: '/contacts/new' },
  { label: 'New Appointment', icon: '◷', href: '/appointments/new' },
  { label: 'View Pipeline', icon: '◈', href: '/pipeline' },
  { label: 'Open Demo', icon: '▶', href: '/demo/dashboard' },
]

// ── Types ─────────────────────────────────────────────────────────────────────

export interface StatItem {
  label: string
  value: string
  icon: string
  color: string
  href?: string
}

interface Props {
  stats: StatItem[]
  userName: string
}

// ── DragHandle ────────────────────────────────────────────────────────────────

function DragHandle({
  dragHandleProps,
}: {
  dragHandleProps: DraggableProvidedDragHandleProps | null
}) {
  if (!dragHandleProps) return null
  return (
    <span
      {...dragHandleProps}
      className="absolute top-3 right-3 z-10 w-6 h-6 flex items-center justify-center rounded text-base text-ink4 opacity-0 group-hover/widget:opacity-100 transition-opacity cursor-grab active:cursor-grabbing select-none"
      aria-label="Drag to reorder"
    >
      ⠿
    </span>
  )
}

// ── DashboardClient ───────────────────────────────────────────────────────────

export default function DashboardClient({ stats, userName }: Props) {
  const [order, setOrder] = useState<WidgetId[]>(DEFAULT_ORDER)

  // Hydrate from localStorage on mount (SSR-safe)
  useEffect(() => {
    setOrder(loadOrder())
  }, [])

  function handleDragEnd(result: DropResult) {
    if (!result.destination) return
    if (result.source.index === result.destination.index) return
    const next = [...order]
    const [moved] = next.splice(result.source.index, 1)
    next.splice(result.destination.index, 0, moved!)
    setOrder(next)
    saveOrder(next)
  }

  function renderWidget(id: WidgetId): React.ReactNode {
    switch (id) {
      case 'stat-cards':
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {stats.map(({ label, value, icon, color, href }) => {
              const cardClass = `bg-white rounded-xl border border-border-brand p-5${href ? ' hover:shadow-md hover:border-teal-300 transition-all cursor-pointer' : ''}`
              const inner = (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-medium text-ink3">{label}</p>
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm ${COLOR[color]}`}
                    >
                      {icon}
                    </div>
                  </div>
                  <p className="text-2xl font-bold text-ink">{value}</p>
                </>
              )
              return href ? (
                <Link key={label} href={href} className={`block ${cardClass}`}>
                  {inner}
                </Link>
              ) : (
                <div key={label} className={cardClass}>
                  {inner}
                </div>
              )
            })}
          </div>
        )
      case 'pipeline-funnel':
        return <PipelineFunnel />
      case 'lead-source':
        return <LeadSourceReport />
      case 'google-profile':
        return <GbpInsightsWidget />
      case 'activity-actions':
        return (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="col-span-1 md:col-span-2 bg-white rounded-xl border border-border-brand p-6">
              <h2 className="text-sm font-semibold text-ink mb-4">Recent Activity</h2>
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="w-10 h-10 rounded-full bg-bg flex items-center justify-center mb-3">
                  <span className="text-gray-300 text-xl">◎</span>
                </div>
                <p className="text-sm font-medium text-ink4">No activity yet</p>
                <p className="text-xs text-gray-300 mt-1">
                  Activity will appear here as you add contacts
                </p>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-border-brand p-6">
              <h2 className="text-sm font-semibold text-ink mb-4">Quick Actions</h2>
              <div className="space-y-2">
                {ACTIONS.map(({ label, icon, href }) => (
                  <Link
                    key={label}
                    href={href}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-ink3 hover:bg-bg hover:text-ink transition-colors"
                  >
                    <span className="w-6 h-6 rounded-md bg-bg2 flex items-center justify-center text-xs text-ink3">
                      {icon}
                    </span>
                    {label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        )
      default:
        return null
    }
  }

  return (
    <div className="px-4 py-6 md:px-8 md:py-8">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-ink">Dashboard</h1>
        <p className="text-sm text-ink3 mt-0.5">Welcome back, {userName}.</p>
      </div>

      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="dashboard-widgets" type="widget">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-4">
              {order.map((id, idx) => (
                <Draggable key={id} draggableId={id} index={idx}>
                  {(dragProvided, dragSnapshot) => (
                    <div
                      ref={dragProvided.innerRef}
                      {...dragProvided.draggableProps}
                      className={`relative group/widget transition-opacity ${
                        dragSnapshot.isDragging ? 'opacity-75' : 'opacity-100'
                      }`}
                      style={{ ...dragProvided.draggableProps.style }}
                    >
                      <DragHandle dragHandleProps={dragProvided.dragHandleProps} />
                      {renderWidget(id)}
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    </div>
  )
}
