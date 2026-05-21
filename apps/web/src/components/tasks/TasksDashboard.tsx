'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ColumnsButton } from '@/components/ColumnsButton'
import { useColumnVisibility } from '@/hooks/useColumnVisibility'

interface Task {
  id: string
  title: string
  due_date: string | null
  priority: string
  completed_at: string | null
  contact_id: string | null
  assigned_to_user_id: string | null
  contacts: { full_name: string } | null
  assigned: { full_name: string } | null
}

type FilterTab = 'all' | 'mine' | 'unassigned'

const PRIORITY_BORDER: Record<string, string> = {
  high: 'border-l-red-500',
  medium: 'border-l-amber-400',
  low: 'border-l-gray-300',
}

const PRIORITY_BADGE: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-bg2 text-ink3',
}

function startOfDay(d: Date): Date {
  const copy = new Date(d)
  copy.setHours(0, 0, 0, 0)
  return copy
}

function categorize(tasks: Task[]) {
  const now = new Date()
  const today = startOfDay(now)
  const todayEnd = new Date(today)
  todayEnd.setDate(todayEnd.getDate() + 1)
  const weekEnd = new Date(today)
  weekEnd.setDate(weekEnd.getDate() + 7)

  const overdue: Task[] = []
  const todayTasks: Task[] = []
  const thisWeek: Task[] = []
  const upcoming: Task[] = []
  const noDueDate: Task[] = []

  for (const task of tasks) {
    if (!task.due_date) {
      noDueDate.push(task)
    } else {
      const due = new Date(task.due_date)
      if (due < today) {
        overdue.push(task)
      } else if (due < todayEnd) {
        todayTasks.push(task)
      } else if (due < weekEnd) {
        thisWeek.push(task)
      } else {
        upcoming.push(task)
      }
    }
  }

  return { overdue, todayTasks, thisWeek, upcoming, noDueDate }
}

function formatDue(dueDate: string): string {
  const d = new Date(dueDate)
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  return `${date} at ${time}`
}

const TASKS_COLUMNS = [
  { key: 'contact', label: 'Contact' },
  { key: 'due_date', label: 'Due Date' },
  { key: 'priority', label: 'Priority' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'status', label: 'Status' },
]
const TASKS_DEFAULTS = Object.fromEntries(TASKS_COLUMNS.map((c) => [c.key, true]))

export default function TasksDashboard() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterTab>('all')

  // Add task modal
  const [showAdd, setShowAdd] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDue, setNewDue] = useState('')
  const [newTime, setNewTime] = useState('12:00')
  const [newPriority, setNewPriority] = useState('medium')
  const [saving, setSaving] = useState(false)
  // TODO(G65): When a table/list view is added to tasks, use colVisible to gate columns
  const { visible: colVisible, toggle: toggleCol } = useColumnVisibility(
    'nuatis_tasks_columns',
    TASKS_DEFAULTS
  )

  const fetchTasks = useCallback(async () => {
    const params = new URLSearchParams({ completed: 'false' })
    if (filter === 'mine') params.set('assigned_to', 'me')

    const res = await fetch(`/api/tasks?${params}`)
    if (!res.ok) return
    const data = (await res.json()) as { tasks: Task[] }

    let filtered = data.tasks
    if (filter === 'unassigned') {
      filtered = filtered.filter((t) => !t.assigned_to_user_id)
    }

    setTasks(filtered)
  }, [filter])

  useEffect(() => {
    setLoading(true)
    void fetchTasks().finally(() => setLoading(false))
  }, [fetchTasks])

  const completeTask = async (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
    await fetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ completed_at: new Date().toISOString() }),
    })
  }

  const addTask = async () => {
    if (!newTitle.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: newTitle.trim(),
          due_date: newDue ? new Date(`${newDue}T${newTime}`).toISOString() : undefined,
          priority: newPriority,
        }),
      })
      if (res.ok) {
        setNewTitle('')
        setNewDue('')
        setNewTime('12:00')
        setNewPriority('medium')
        setShowAdd(false)
        void fetchTasks()
      }
    } finally {
      setSaving(false)
    }
  }

  const { overdue, todayTasks, thisWeek, upcoming, noDueDate } = categorize(tasks)

  const renderSection = (
    title: string,
    icon: string,
    sectionTasks: Task[],
    countColor = 'bg-bg2 text-ink3'
  ) => (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-2">
        <span>{icon}</span>
        <h3 className="text-sm font-semibold text-ink2">{title}</h3>
        {sectionTasks.length > 0 && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${countColor}`}>
            {sectionTasks.length}
          </span>
        )}
      </div>
      {sectionTasks.length === 0 ? (
        <p className="text-xs text-ink4 pl-7">No tasks</p>
      ) : (
        <div className="space-y-1">
          {sectionTasks.map((task) => (
            <div
              key={task.id}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border-l-2 bg-white ${PRIORITY_BORDER[task.priority] ?? ''}`}
            >
              <input
                type="checkbox"
                checked={false}
                onChange={() => void completeTask(task.id)}
                className="rounded border-border-brand text-teal-600 focus:ring-teal-500 w-4 h-4 cursor-pointer"
              />
              <span className="text-sm text-ink2 flex-1">{task.title}</span>
              {task.contacts?.full_name && (
                <Link
                  href={`/contacts/${task.contact_id}`}
                  className="text-xs text-teal-600 hover:text-teal-700 font-medium"
                >
                  {task.contacts.full_name}
                </Link>
              )}
              {task.due_date && (
                <span className="text-[10px] text-ink4">{formatDue(task.due_date)}</span>
              )}
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${PRIORITY_BADGE[task.priority] ?? ''}`}
              >
                {task.priority}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div className="px-8 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-ink">Tasks</h1>
          <p className="text-sm text-ink3 mt-0.5">{tasks.length} active</p>
        </div>
        <div className="flex items-center gap-2">
          <ColumnsButton columns={TASKS_COLUMNS} visible={colVisible} onChange={toggleCol} />
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
          >
            <span className="text-base leading-none">+</span>
            Add Task
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 mb-6">
        {(['all', 'mine', 'unassigned'] as FilterTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              filter === tab ? 'bg-teal-50 text-teal-700' : 'text-ink3 hover:bg-bg hover:text-ink2'
            }`}
          >
            {tab === 'all' ? 'All' : tab === 'mine' ? 'Mine' : 'Unassigned'}
          </button>
        ))}
      </div>

      {/* Add task modal */}
      {showAdd && (
        <div className="bg-white rounded-xl border border-border-brand p-4 mb-6">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Task title..."
            autoFocus
            className="w-full text-sm border-0 focus:ring-0 p-0 placeholder-gray-300 mb-3"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addTask()
              if (e.key === 'Escape') setShowAdd(false)
            }}
          />
          <div className="flex items-center gap-3">
            <input
              type="date"
              value={newDue}
              onChange={(e) => setNewDue(e.target.value)}
              className="text-xs border border-border-brand rounded px-2 py-1.5"
            />
            <input
              type="time"
              value={newTime}
              onChange={(e) => setNewTime(e.target.value)}
              className="text-xs border border-border-brand rounded px-2 py-1.5"
            />
            <select
              value={newPriority}
              onChange={(e) => setNewPriority(e.target.value)}
              className="text-xs border border-border-brand rounded px-2 py-1.5"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <div className="flex-1" />
            <button onClick={() => setShowAdd(false)} className="text-xs text-ink3 hover:text-ink2">
              Cancel
            </button>
            <button
              onClick={() => void addTask()}
              disabled={!newTitle.trim() || saving}
              className="px-4 py-1.5 text-xs font-medium text-white bg-teal-600 rounded-md hover:bg-teal-700 disabled:opacity-50"
            >
              {saving ? 'Adding...' : 'Add Task'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-sm text-ink4">Loading tasks...</div>
      ) : (
        <>
          {renderSection('Overdue', '\u{1F534}', overdue, 'bg-red-100 text-red-700')}
          {renderSection('Today', '\u{1F4C5}', todayTasks)}
          {renderSection('This Week', '\u{1F4C6}', thisWeek)}
          {renderSection('Upcoming', '\u{1F5D3}\uFE0F', upcoming)}
          {renderSection('No Due Date', '\u221E', noDueDate)}
        </>
      )}
    </div>
  )
}
