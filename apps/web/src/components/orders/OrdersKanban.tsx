'use client'

import { useCallback, type Dispatch, type SetStateAction } from 'react'
import Link from 'next/link'
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd'
import type { DropResult } from '@hello-pangea/dnd'
import { formatCurrency } from '@nuatis/shared'
import { ORDER_STATUSES, STATUS_LABELS, type Order, type OrderStatus } from './types'

interface Props {
  orders: Order[]
  setOrders: Dispatch<SetStateAction<Order[]>>
  showToast: (msg: string, type: 'error' | 'success') => void
}

// Columns are always shown in this fixed pipeline order — a board doesn't let
// staff drag an order past a cancelled/completed terminal state, so unlike
// Pipeline's stages this list is static, not tenant-configurable.
const COLUMNS: OrderStatus[] = ['pending', 'confirmed', 'in_progress', 'ready', 'completed']

export default function OrdersKanban({ orders, setOrders, showToast }: Props) {
  const handleDragEnd = useCallback(
    async (result: DropResult) => {
      const { source, destination, draggableId } = result
      if (!destination) return
      if (destination.droppableId === source.droppableId) return

      const nextStatus = destination.droppableId as OrderStatus
      const prevOrders = orders
      setOrders((prev) =>
        prev.map((o) => (o.id === draggableId ? { ...o, status: nextStatus } : o))
      )

      try {
        const res = await fetch(`/api/orders/${draggableId}/status`, {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: nextStatus }),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          throw new Error((d as { error?: string }).error ?? 'Failed to move order')
        }
      } catch (err) {
        setOrders(prevOrders)
        showToast(err instanceof Error ? err.message : 'Failed to move order', 'error')
      }
    },
    [orders, setOrders, showToast]
  )

  const grouped = new Map<OrderStatus, Order[]>()
  for (const status of ORDER_STATUSES) grouped.set(status, [])
  for (const order of orders) {
    if (grouped.has(order.status)) grouped.get(order.status)!.push(order)
  }
  const cancelled = grouped.get('cancelled') ?? []

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="overflow-x-auto flex-1" style={{ WebkitOverflowScrolling: 'touch' }}>
        <div className="flex gap-3 h-full pb-4" style={{ minWidth: `${COLUMNS.length * 240}px` }}>
          {COLUMNS.map((status) => {
            const cards = grouped.get(status) ?? []
            const totalValue = cards.reduce((sum, o) => sum + Number(o.total), 0)
            return (
              <Droppable key={status} droppableId={status}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className="shrink-0 w-60 flex flex-col rounded-lg border border-border-brand overflow-hidden"
                    style={{
                      minHeight: '400px',
                      backgroundColor: snapshot.isDraggingOver ? '#f2f0eb' : '#ffffff',
                    }}
                  >
                    <div className="px-3 py-2.5 border-b border-border-brand bg-[#f9f8f5]">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-ink truncate flex-1">
                          {STATUS_LABELS[status]}
                        </span>
                        <span className="font-mono text-[10px] text-ink3 bg-white border border-border-brand rounded px-1.5 py-0.5 shrink-0 tabular-nums">
                          {cards.length}
                        </span>
                      </div>
                      <p className="text-[11px] text-ink3 mt-0.5 tabular-nums">
                        {formatCurrency(totalValue)}
                      </p>
                    </div>

                    <div className="flex flex-col gap-2 p-2 flex-1">
                      {cards.length === 0 && !snapshot.isDraggingOver ? (
                        <div className="rounded border border-dashed border-border-brand px-3 py-5 text-center mt-1">
                          <p className="text-[11px] text-ink4">No orders</p>
                        </div>
                      ) : (
                        cards.map((order, index) => (
                          <Draggable key={order.id} draggableId={order.id} index={index}>
                            {(dragProvided, dragSnapshot) => (
                              <div
                                ref={dragProvided.innerRef}
                                {...dragProvided.draggableProps}
                                className="group bg-white rounded-md border border-border-brand p-3 transition-all duration-100 hover:shadow-sm"
                                style={{
                                  ...dragProvided.draggableProps.style,
                                  opacity: dragSnapshot.isDragging ? 0.7 : 1,
                                  boxShadow: dragSnapshot.isDragging
                                    ? '0 10px 25px -3px rgb(0 0 0 / 0.15)'
                                    : undefined,
                                  touchAction: 'none',
                                }}
                              >
                                <div className="flex items-start gap-1 mb-1.5">
                                  <span
                                    {...dragProvided.dragHandleProps}
                                    className="text-ink4 text-sm leading-none mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing shrink-0 select-none"
                                    aria-label="Drag to reorder"
                                  >
                                    ⠿
                                  </span>
                                  <Link
                                    href={`/orders/${order.id}`}
                                    className="text-[14px] font-semibold text-ink leading-snug hover:text-teal-700 truncate flex-1"
                                  >
                                    {order.order_number}
                                  </Link>
                                  {order.source === 'maya' && (
                                    <span className="font-mono text-[9px] px-1.5 py-0.5 rounded shrink-0 uppercase tracking-wide bg-teal-50 text-teal-600">
                                      MAYA
                                    </span>
                                  )}
                                  {order.error && (
                                    <span
                                      className="text-[11px] shrink-0"
                                      title={order.error}
                                      aria-label="Order has an error"
                                    >
                                      ⚠
                                    </span>
                                  )}
                                </div>
                                <p className="text-[12px] text-ink2 mb-1 truncate pl-5">
                                  {order.contacts?.full_name ?? order.customer_name ?? 'Walk-in'}
                                </p>
                                <p className="font-mono text-[11px] text-ink3 pl-5">
                                  {formatCurrency(Number(order.total))}
                                </p>
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

      {cancelled.length > 0 && (
        <p className="text-xs text-ink4 mt-3 shrink-0">
          {cancelled.length} cancelled order{cancelled.length !== 1 ? 's' : ''} hidden from the
          board — see the list view.
        </p>
      )}
    </DragDropContext>
  )
}
