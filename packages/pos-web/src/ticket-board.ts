export interface TicketItem {
  /** Optional only as a guard — the API broadcasts stored rows, which have ids. */
  id?: string
  name: string
  quantity: number | string
  modifiers: { option_name?: string }[]
  notes: string | null
  sort_order: number
}

export interface Ticket {
  id: string
  ticket_number: number
  location_id: string
  station: string | null
  status: 'queued' | 'in_progress' | 'ready' | 'bumped'
  fired_at: string
  items: TicketItem[]
}

/** How late a ticket is, as three bands rather than a raw number of seconds. */
export type AgeTone = 'fresh' | 'warm' | 'late'

const WARM_AFTER_MS = 5 * 60 * 1000
const LATE_AFTER_MS = 10 * 60 * 1000

/**
 * A cook glances at this from across the line, so the useful signal is a
 * colour, not a stopwatch. Five and ten minutes match the thresholds most
 * kitchens already run their expo screens on.
 */
export function ageTone(firedAt: string, now: number = Date.now()): AgeTone {
  const elapsed = now - new Date(firedAt).getTime()
  if (!Number.isFinite(elapsed)) return 'fresh'
  if (elapsed >= LATE_AFTER_MS) return 'late'
  if (elapsed >= WARM_AFTER_MS) return 'warm'
  return 'fresh'
}

/** "4:07" since the ticket was fired. Clamped at zero for a clock skew. */
export function elapsedLabel(firedAt: string, now: number = Date.now()): string {
  const ms = Math.max(0, now - new Date(firedAt).getTime())
  if (!Number.isFinite(ms)) return '0:00'
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** Oldest first: the ticket that has been waiting longest is the urgent one. */
export function sortTickets(tickets: Ticket[]): Ticket[] {
  return [...tickets].sort((a, b) => {
    const diff = new Date(a.fired_at).getTime() - new Date(b.fired_at).getTime()
    // Same millisecond happens constantly — one order fires several station
    // tickets at once. Fall back to the ticket number so the order on screen
    // is stable instead of re-shuffling on every render.
    return diff !== 0 ? diff : a.ticket_number - b.ticket_number
  })
}

/**
 * Fold a socket event into the board.
 *
 * A bumped ticket leaves the board — that is what bumping means. Anything else
 * is upserted rather than appended: the same ticket arrives again on any status
 * change, and a screen that appends would show the same order twice and have a
 * cook cook it twice.
 *
 * A ticket for a different location is dropped. The server already filters by
 * location, so this should never fire — but a duplicated ticket is a wasted
 * plate of food, and the cost of the extra check is one comparison.
 */
export function applyEvent(
  tickets: Ticket[],
  event: { type: string; ticket: unknown },
  locationId: string
): Ticket[] {
  const ticket = asTicket(event.ticket)
  if (!ticket) return tickets
  if (ticket.location_id !== locationId) return tickets

  if (event.type === 'ticket.bumped' || ticket.status === 'bumped') {
    return tickets.filter((t) => t.id !== ticket.id)
  }

  const index = tickets.findIndex((t) => t.id === ticket.id)
  if (index === -1) return sortTickets([...tickets, ticket])

  // Keep the items already on screen when the update does not carry any. The
  // PATCH /status broadcast sends the ticket row alone, and replacing a full
  // ticket with a bare row would blank the food out of the card.
  const existing = tickets[index] as Ticket
  const merged: Ticket = {
    ...ticket,
    items: ticket.items.length > 0 ? ticket.items : existing.items,
  }
  return tickets.map((t, i) => (i === index ? merged : t))
}

/** Stations present on the board, plus the unrouted bucket if anything is in it. */
export function stationsOf(tickets: Ticket[]): string[] {
  const stations = new Set<string>()
  for (const t of tickets) stations.add(t.station ?? '')
  return [...stations].sort()
}

/**
 * An unrouted ticket (no station) shows on every screen — that is what the
 * NULL station means in the schema, and dropping it would leave food that
 * nobody is told to cook.
 */
export function filterByStation(tickets: Ticket[], station: string | null): Ticket[] {
  if (station === null) return tickets
  return tickets.filter((t) => t.station === station || t.station === null)
}

function asTicket(value: unknown): Ticket | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const o = value as Record<string, unknown>
  if (typeof o['id'] !== 'string' || typeof o['location_id'] !== 'string') return null
  if (typeof o['fired_at'] !== 'string') return null

  return {
    id: o['id'],
    ticket_number: typeof o['ticket_number'] === 'number' ? o['ticket_number'] : 0,
    location_id: o['location_id'],
    station: typeof o['station'] === 'string' ? o['station'] : null,
    status: (typeof o['status'] === 'string' ? o['status'] : 'queued') as Ticket['status'],
    fired_at: o['fired_at'],
    items: Array.isArray(o['items']) ? (o['items'] as TicketItem[]) : [],
  }
}
