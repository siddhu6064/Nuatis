import { applyEvent, sortTickets, type Ticket } from '@nuatis/pos-web/tickets'

/**
 * The tickets the front counter still has to hand over.
 *
 * A register cares about exactly one slice of the kitchen's state: what is
 * cooked and waiting. `queued` and `in_progress` are the kitchen's business,
 * and `bumped` means it already went out the door.
 */
export function readyOnly(tickets: Ticket[]): Ticket[] {
  return sortTickets(tickets.filter((t) => t.status === 'ready'))
}

/**
 * Fold a socket event into the strip.
 *
 * Reuses the board's `applyEvent` so the register and the kitchen display can
 * never disagree about what an event means — then narrows to ready, because a
 * ticket that goes back to `in_progress` (a cook reopening it) has to leave the
 * strip, not linger as something the cashier will hand over twice.
 */
export function applyReadyEvent(
  tickets: Ticket[],
  event: { type: string; ticket: unknown },
  locationId: string
): Ticket[] {
  return readyOnly(applyEvent(tickets, event, locationId))
}

/**
 * One line of counter-facing text per ticket.
 *
 * Deliberately the ticket number and nothing else by default: the cashier is
 * calling it across a room, and "Order 24" carries further than a dish list.
 */
export function callLabel(ticket: Ticket): string {
  return `Order ${ticket.ticket_number}`
}
