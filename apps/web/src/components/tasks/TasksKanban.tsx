'use client'

import { useCallback, type Dispatch, type SetStateAction } from 'react'
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd'
import type { DropResult } from '@hello-pangea/dnd'

export type TaskStatus = 'open' | 'in_progress' | 'done'

export interface KanbanTask {
  id: string
  title: string
  due_date: string | null
  priority: string
  status: TaskStatus
  contacts?: { full_name?: string } | null
}

interface Props<T extends KanbanTask> {
  tasks: T[]
  setTasks: Dispatch<SetStateAction<T[]>>
  showToast: (msg: string, type: 'error' | 'success') => void
}

const COLUMNS: TaskStatus[] = ['open', 'in_progress', 'done']
const STATUS_LABELS: Record<TaskStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  done: 'Done',
}

const PRIORITY_BADGE: Record<string, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-bg2 text-ink3',
}

// Matches TasksDashboard.tsx's PRIORITY_BORDER exactly — the list view already
// color-codes each row by priority; the board view was missing the same tie.
const PRIORITY_BORDER: Record<string, string> = {
  high: 'border-l-red-500',
  medium: 'border-l-amber-400',
  low: 'border-l-gray-300',
}

function formatDue(dueDate: string): string {
  return new Date(dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function TasksKanban<T extends KanbanTask>({
  tasks,
  setTasks,
  showToast,
}: Props<T>) {
  const handleDragEnd = useCallback(
    async (result: DropResult) => {
      const { source, destination, draggableId } = result
      if (!destination) return
      if (destination.droppableId === source.droppableId) return

      const nextStatus = destination.droppableId as TaskStatus
      const prevTasks = tasks
      setTasks((prev) => prev.map((t) => (t.id === draggableId ? { ...t, status: nextStatus } : t)))

      try {
        const res = await fetch(`/api/tasks/${draggableId}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: nextStatus }),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error((d as { error?: string }).error ?? 'Failed to move task')
        }
      } catch (err) {
        setTasks(prevTasks)
        showToast(err instanceof Error ? err.message : 'Failed to move task', 'error')
      }
    },
    [tasks, setTasks, showToast]
  )

  const grouped = new Map<TaskStatus, KanbanTask[]>()
  for (const status of COLUMNS) grouped.set(status, [])
  for (const task of tasks) {
    if (grouped.has(task.status)) grouped.get(task.status)!.push(task)
  }

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="flex gap-3 pb-4" style={{ minWidth: `${COLUMNS.length * 260}px` }}>
          {COLUMNS.map((status) => {
            const cards = grouped.get(status) ?? []
            return (
              <Droppable key={status} droppableId={status}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className="shrink-0 w-64 flex flex-col rounded-lg border border-border-brand overflow-hidden"
                    style={{
                      minHeight: '400px',
                      backgroundColor: snapshot.isDraggingOver ? '#f2f0eb' : '#ffffff',
                    }}
                  >
                    <div className="px-3 py-2.5 border-b border-border-brand bg-[#f9f8f5] flex items-center gap-2">
                      <span className="text-[13px] font-semibold text-ink truncate flex-1">
                        {STATUS_LABELS[status]}
                      </span>
                      <span className="font-mono text-[10px] text-ink3 bg-white border border-border-brand rounded px-1.5 py-0.5 shrink-0 tabular-nums">
                        {cards.length}
                      </span>
                    </div>

                    <div className="flex flex-col gap-2 p-2 flex-1">
                      {cards.length === 0 && !snapshot.isDraggingOver ? (
                        <div className="rounded border border-dashed border-border-brand px-3 py-5 text-center mt-1">
                          <p className="text-[11px] text-ink4">No tasks</p>
                        </div>
                      ) : (
                        cards.map((task, index) => (
                          <Draggable key={task.id} draggableId={task.id} index={index}>
                            {(dragProvided, dragSnapshot) => (
                              <div
                                ref={dragProvided.innerRef}
                                {...dragProvided.draggableProps}
                                {...dragProvided.dragHandleProps}
                                className={`bg-white rounded-md border border-l-2 border-border-brand p-3 transition-all duration-100 hover:shadow-sm ${PRIORITY_BORDER[task.priority] ?? ''}`}
                                style={{
                                  ...dragProvided.draggableProps.style,
                                  opacity: dragSnapshot.isDragging ? 0.7 : 1,
                                  boxShadow: dragSnapshot.isDragging
                                    ? '0 10px 25px -3px rgb(0 0 0 / 0.15)'
                                    : undefined,
                                  touchAction: 'none',
                                  cursor: 'grab',
                                }}
                              >
                                <p className="text-[13px] font-medium text-ink leading-snug mb-1.5">
                                  {task.title}
                                </p>
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {task.contacts?.full_name && (
                                    <span className="text-[11px] text-ink3 truncate">
                                      {task.contacts.full_name}
                                    </span>
                                  )}
                                  {task.due_date && (
                                    <span className="text-[10px] text-ink4">
                                      {formatDue(task.due_date)}
                                    </span>
                                  )}
                                  <span
                                    className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${PRIORITY_BADGE[task.priority] ?? ''}`}
                                  >
                                    {task.priority}
                                  </span>
                                </div>
                              </div>
                            )}
                          </Draggable>
                        ))
                      )}
                      {provided.placeholder}
                    </div>
                  </div>
                )}
              </Droppable>
            )
          })}
        </div>
      </div>
    </DragDropContext>
  )
}
