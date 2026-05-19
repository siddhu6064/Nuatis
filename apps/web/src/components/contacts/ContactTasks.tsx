'use client'

import { useState, useEffect, useCallback } from 'react'

interface Task {
  id: string
  title: string
  due_date: string | null
  priority: string
  completed_at: string | null
  assigned_to_user_id: string | null
}

interface Props {
  contactId: string
}

type SubTab = 'all' | 'due_today' | 'overdue' | 'upcoming'

const PRIORITY_COLORS: Record<string, string> = {
  high: 'border-l-red-500 bg-red-50/30',
  medium: 'border-l-amber-400 bg-amber-50/20',
  low: 'border-l-gray-300',
}

const PRIORITY_BADGE: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-bg2 text-ink3',
}

function todayStart(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function tomorrowStart(): Date {
  const d = todayStart()
  d.setDate(d.getDate() + 1)
  return d
}

function isDueToday(dueDate: string | null): boolean {
  if (!dueDate) return false
  const d = new Date(dueDate)
  return d >= todayStart() && d < tomorrowStart()
}

function isTaskOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false
  return new Date(dueDate) < todayStart()
}

function isUpcoming(dueDate: string | null): boolean {
  if (!dueDate) return false
  return new Date(dueDate) >= tomorrowStart()
}

function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false
  return new Date(dueDate) < new Date()
}

function formatDue(dueDate: string | null): string {
  if (!dueDate) return ''
  const d = new Date(dueDate)
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
  return `${date} at ${time}`
}

export default function ContactTasks({ contactId }: Props) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [completedTasks, setCompletedTasks] = useState<Task[]>([])
  const [showCompleted, setShowCompleted] = useState(false)
  const [loading, setLoading] = useState(true)
  const [subTab, setSubTab] = useState<SubTab>('all')

  // Inline add form
  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newDue, setNewDue] = useState('')
  const [newTime, setNewTime] = useState('12:00')
  const [newPriority, setNewPriority] = useState('medium')
  const [saving, setSaving] = useState(false)

  const fetchTasks = useCallback(async () => {
    const [activeRes, completedRes] = await Promise.all([
      fetch(`/api/tasks?contact_id=${contactId}&completed=false`),
      fetch(`/api/tasks?contact_id=${contactId}&completed=true`),
    ])
    if (activeRes.ok) {
      const data = (await activeRes.json()) as { tasks: Task[] }
      setTasks(data.tasks)
    }
    if (completedRes.ok) {
      const data = (await completedRes.json()) as { tasks: Task[] }
      setCompletedTasks(data.tasks)
    }
  }, [contactId])

  useEffect(() => {
    setLoading(true)
    void fetchTasks().finally(() => setLoading(false))
  }, [fetchTasks])

  const completeTask = async (taskId: string) => {
    // Optimistic update
    setTasks((prev) => prev.filter((t) => t.id !== taskId))
    const task = tasks.find((t) => t.id === taskId)
    if (task) {
      setCompletedTasks((prev) => [{ ...task, completed_at: new Date().toISOString() }, ...prev])
    }

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
          contact_id: contactId,
          due_date: newDue ? new Date(`${newDue}T${newTime}`).toISOString() : undefined,
          priority: newPriority,
        }),
      })
      if (res.ok) {
        setNewTitle('')
        setNewDue('')
        setNewTime('12:00')
        setNewPriority('medium')
        setAdding(false)
        void fetchTasks()
      }
    } finally {
      setSaving(false)
    }
  }

  const overdueCount = tasks.filter((t) => isTaskOverdue(t.due_date)).length
  const dueTodayCount = tasks.filter((t) => isDueToday(t.due_date)).length

  const filteredTasks = (() => {
    switch (subTab) {
      case 'due_today':
        return tasks.filter((t) => isDueToday(t.due_date))
      case 'overdue':
        return tasks.filter((t) => isTaskOverdue(t.due_date))
      case 'upcoming':
        return tasks.filter((t) => isUpcoming(t.due_date))
      default:
        return tasks
    }
  })()

  if (loading) {
    return <div className="py-4 text-center text-sm text-ink4">Loading tasks...</div>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-ink2">Tasks</h3>
        <button
          onClick={() => setAdding(true)}
          className="text-xs text-teal-600 hover:text-teal-700 font-medium"
        >
          + Add task
        </button>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-0 border-b border-border-brand mb-3 -mx-0">
        {(
          [
            { id: 'all', label: 'All' },
            {
              id: 'due_today',
              label: 'Due Today',
              count: dueTodayCount,
              badgeClass: 'bg-amber-100 text-amber-700',
            },
            {
              id: 'overdue',
              label: 'Overdue',
              count: overdueCount,
              badgeClass: 'bg-red-100 text-red-700',
            },
            { id: 'upcoming', label: 'Upcoming' },
          ] as Array<{ id: SubTab; label: string; count?: number; badgeClass?: string }>
        ).map(({ id, label, count, badgeClass }) => (
          <button
            key={id}
            onClick={() => setSubTab(id)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
              subTab === id
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-ink3 hover:text-ink2'
            }`}
          >
            {label}
            {count !== undefined && count > 0 && (
              <span
                className={`inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[10px] font-semibold leading-none ${badgeClass ?? ''}`}
              >
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {adding && (
        <div className="border border-border-brand rounded-lg p-3 mb-3">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Task title..."
            autoFocus
            className="w-full text-sm border-0 focus:ring-0 p-0 placeholder-gray-300"
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addTask()
              if (e.key === 'Escape') setAdding(false)
            }}
          />
          <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border-brand">
            <input
              type="date"
              value={newDue}
              onChange={(e) => setNewDue(e.target.value)}
              className="text-xs border border-border-brand rounded px-2 py-1"
            />
            <input
              type="time"
              value={newTime}
              onChange={(e) => setNewTime(e.target.value)}
              className="text-xs border border-border-brand rounded px-2 py-1"
            />
            <select
              value={newPriority}
              onChange={(e) => setNewPriority(e.target.value)}
              className="text-xs border border-border-brand rounded px-2 py-1"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <div className="flex-1" />
            <button onClick={() => setAdding(false)} className="text-xs text-ink3 hover:text-ink2">
              Cancel
            </button>
            <button
              onClick={() => void addTask()}
              disabled={!newTitle.trim() || saving}
              className="px-3 py-1 text-xs font-medium text-white bg-teal-600 rounded hover:bg-teal-700 disabled:opacity-50"
            >
              {saving ? 'Adding...' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {filteredTasks.length === 0 && !adding && (
        <p className="text-xs text-ink4 py-2">
          {subTab === 'all'
            ? 'No active tasks'
            : subTab === 'due_today'
              ? 'No tasks due today'
              : subTab === 'overdue'
                ? 'No overdue tasks'
                : 'No upcoming tasks'}
        </p>
      )}

      <div className="space-y-1">
        {filteredTasks.map((task) => (
          <div
            key={task.id}
            className={`flex items-center gap-2 px-3 py-2 rounded-lg border-l-2 ${
              subTab === 'overdue'
                ? 'border-l-rose-500 bg-rose-50/30'
                : (PRIORITY_COLORS[task.priority] ?? '')
            }`}
          >
            <input
              type="checkbox"
              checked={false}
              onChange={() => void completeTask(task.id)}
              className="rounded border-border-brand text-teal-600 focus:ring-teal-500 w-3.5 h-3.5 cursor-pointer"
            />
            <span className="text-sm text-ink2 flex-1">{task.title}</span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${PRIORITY_BADGE[task.priority] ?? ''}`}
            >
              {task.priority}
            </span>
            {task.due_date && (
              <span
                className={`text-[10px] ${isOverdue(task.due_date) ? 'text-red-600 font-medium' : 'text-ink4'}`}
              >
                {formatDue(task.due_date)}
              </span>
            )}
          </div>
        ))}
      </div>

      {completedTasks.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowCompleted(!showCompleted)}
            className="text-xs text-ink4 hover:text-ink3"
          >
            {showCompleted ? 'Hide' : 'Show'} completed ({completedTasks.length})
          </button>
          {showCompleted && (
            <div className="mt-1 space-y-1 opacity-60">
              {completedTasks.map((task) => (
                <div key={task.id} className="flex items-center gap-2 px-3 py-1.5">
                  <input
                    type="checkbox"
                    checked
                    readOnly
                    className="rounded border-border-brand text-ink4 w-3.5 h-3.5"
                  />
                  <span className="text-sm text-ink4 line-through">{task.title}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
