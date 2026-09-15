import { describe, it, expect } from '@jest/globals'
import type { Ticket } from '@nuatis/pos-web/tickets'
import { readyOnly, applyReadyEvent, callLabel } from './ready-orders'

const LOCATION = 'loc-1'

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 't1',
    ticket_number: 24,
    location_id: LOCATION,
    station: 'grill',
    status: 'ready',
    fired_at: '2026-09-15T18:00:00.000Z',
    items: [],
    ...overrides,
  }
}

describe('readyOnly', () => {
  it('keeps only what the counter still has to hand over', () => {
    const board = [
      ticket({ id: 'queued', status: 'queued' }),
      ticket({ id: 'cooking', status: 'in_progress' }),
      ticket({ id: 'ready', status: 'ready' }),
      ticket({ id: 'gone', status: 'bumped' }),
    ]
    expect(readyOnly(board).map((t) => t.id)).toEqual(['ready'])
  })

  it('puts the longest-waiting order first — that is the one going cold', () => {
    const board = [
      ticket({ id: 'new', fired_at: '2026-09-15T18:10:00.000Z' }),
      ticket({ id: 'old', fired_at: '2026-09-15T17:50:00.000Z' }),
    ]
    expect(readyOnly(board).map((t) => t.id)).toEqual(['old', 'new'])
  })
})

describe('applyReadyEvent', () => {
  it('adds an order the kitchen just marked ready', () => {
    const next = applyReadyEvent([], { type: 'ticket.updated', ticket: ticket() }, LOCATION)
    expect(next.map((t) => t.ticket_number)).toEqual([24])
  })

  it('ignores a ticket that was only just fired', () => {
    const next = applyReadyEvent(
      [],
      { type: 'ticket.fired', ticket: ticket({ status: 'queued' }) },
      LOCATION
    )
    expect(next).toHaveLength(0)
  })

  it('drops the order once it is bumped — it has gone out the door', () => {
    const board = [ticket()]
    const next = applyReadyEvent(board, { type: 'ticket.bumped', ticket: ticket() }, LOCATION)
    expect(next).toHaveLength(0)
  })

  it('removes an order a cook reopened, so it is not handed over twice', () => {
    const board = [ticket()]
    const next = applyReadyEvent(
      board,
      { type: 'ticket.updated', ticket: ticket({ status: 'in_progress' }) },
      LOCATION
    )
    expect(next).toHaveLength(0)
  })

  it("ignores another location's ticket", () => {
    const next = applyReadyEvent(
      [],
      { type: 'ticket.updated', ticket: ticket({ location_id: 'loc-2' }) },
      LOCATION
    )
    expect(next).toHaveLength(0)
  })

  it('does not duplicate an order that is marked ready twice', () => {
    let board = applyReadyEvent([], { type: 'ticket.updated', ticket: ticket() }, LOCATION)
    board = applyReadyEvent(board, { type: 'ticket.updated', ticket: ticket() }, LOCATION)
    expect(board).toHaveLength(1)
  })

  it('ignores a malformed payload rather than showing a blank order', () => {
    const board = [ticket()]
    expect(applyReadyEvent(board, { type: 'ticket.updated', ticket: null }, LOCATION)).toEqual(
      board
    )
  })
})

describe('callLabel', () => {
  it('reads as something a cashier can shout across a room', () => {
    expect(callLabel(ticket({ ticket_number: 24 }))).toBe('Order 24')
  })
})
