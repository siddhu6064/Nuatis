import { describe, it, expect } from '@jest/globals'
import {
  ageTone,
  elapsedLabel,
  sortTickets,
  applyEvent,
  stationsOf,
  filterByStation,
  type Ticket,
} from './ticket-board.js'

const LOCATION = 'loc-1'
const NOW = Date.parse('2026-09-11T18:00:00.000Z')

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 't1',
    ticket_number: 1,
    location_id: LOCATION,
    station: 'grill',
    status: 'queued',
    fired_at: '2026-09-11T18:00:00.000Z',
    items: [
      {
        id: 'i1',
        name: 'Burger',
        quantity: 1,
        modifiers: [{ option_name: 'Medium rare' }],
        notes: null,
        sort_order: 0,
      },
    ],
    ...overrides,
  }
}

function minutesAgo(n: number): string {
  return new Date(NOW - n * 60_000).toISOString()
}

describe('ageTone', () => {
  it('bands at five and ten minutes', () => {
    expect(ageTone(minutesAgo(1), NOW)).toBe('fresh')
    expect(ageTone(minutesAgo(5), NOW)).toBe('warm')
    expect(ageTone(minutesAgo(9), NOW)).toBe('warm')
    expect(ageTone(minutesAgo(10), NOW)).toBe('late')
    expect(ageTone(minutesAgo(45), NOW)).toBe('late')
  })

  it('treats an unparseable timestamp as fresh rather than screaming late', () => {
    expect(ageTone('not a date', NOW)).toBe('fresh')
  })
})

describe('elapsedLabel', () => {
  it('reads as minutes and seconds', () => {
    expect(elapsedLabel(new Date(NOW - 247_000).toISOString(), NOW)).toBe('4:07')
    expect(elapsedLabel(new Date(NOW - 5_000).toISOString(), NOW)).toBe('0:05')
  })

  it('clamps at zero, so clock skew never shows a negative age', () => {
    expect(elapsedLabel(new Date(NOW + 30_000).toISOString(), NOW)).toBe('0:00')
  })
})

describe('sortTickets', () => {
  it('puts the longest-waiting ticket first', () => {
    const sorted = sortTickets([
      ticket({ id: 'new', fired_at: minutesAgo(1) }),
      ticket({ id: 'old', fired_at: minutesAgo(20) }),
    ])
    expect(sorted.map((t) => t.id)).toEqual(['old', 'new'])
  })

  it('breaks a tie by ticket number, so one order does not reshuffle', () => {
    const at = minutesAgo(3)
    const sorted = sortTickets([
      ticket({ id: 'b', ticket_number: 7, fired_at: at }),
      ticket({ id: 'a', ticket_number: 6, fired_at: at }),
    ])
    expect(sorted.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('does not mutate its input', () => {
    const input = [
      ticket({ id: 'a', fired_at: minutesAgo(1) }),
      ticket({ id: 'b', fired_at: minutesAgo(9) }),
    ]
    sortTickets(input)
    expect(input.map((t) => t.id)).toEqual(['a', 'b'])
  })
})

describe('applyEvent', () => {
  it('adds a newly fired ticket', () => {
    const next = applyEvent([], { type: 'ticket.fired', ticket: ticket() }, LOCATION)
    expect(next.map((t) => t.id)).toEqual(['t1'])
  })

  it('upserts rather than appending, so a cook is never told to cook it twice', () => {
    const board = [ticket()]
    const next = applyEvent(
      board,
      { type: 'ticket.updated', ticket: ticket({ status: 'in_progress' }) },
      LOCATION
    )
    expect(next).toHaveLength(1)
    expect(next[0]!.status).toBe('in_progress')
  })

  it('keeps the items when a status-only update arrives without them', () => {
    const board = [ticket()]
    const bare = { ...ticket({ status: 'in_progress' }), items: [] }
    const next = applyEvent(board, { type: 'ticket.updated', ticket: bare }, LOCATION)
    expect(next[0]!.items).toHaveLength(1)
    expect(next[0]!.items[0]!.name).toBe('Burger')
  })

  it('removes a bumped ticket — that is what bumping means', () => {
    const board = [ticket(), ticket({ id: 't2', ticket_number: 2 })]
    const next = applyEvent(board, { type: 'ticket.bumped', ticket: ticket() }, LOCATION)
    expect(next.map((t) => t.id)).toEqual(['t2'])
  })

  it('removes a ticket whose status says bumped even if the event type does not', () => {
    const board = [ticket()]
    const next = applyEvent(
      board,
      { type: 'ticket.updated', ticket: ticket({ status: 'bumped' }) },
      LOCATION
    )
    expect(next).toHaveLength(0)
  })

  it("drops another location's ticket, even though the server already filters", () => {
    const next = applyEvent(
      [],
      { type: 'ticket.fired', ticket: ticket({ location_id: 'loc-2' }) },
      LOCATION
    )
    expect(next).toHaveLength(0)
  })

  it('ignores a malformed payload instead of putting a blank card on screen', () => {
    const board = [ticket()]
    expect(applyEvent(board, { type: 'ticket.fired', ticket: null }, LOCATION)).toBe(board)
    expect(applyEvent(board, { type: 'ticket.fired', ticket: { id: 5 } }, LOCATION)).toBe(board)
    expect(applyEvent(board, { type: 'ticket.fired', ticket: [] }, LOCATION)).toBe(board)
  })

  it('keeps the board oldest-first as tickets arrive', () => {
    let board: Ticket[] = []
    board = applyEvent(
      board,
      { type: 'ticket.fired', ticket: ticket({ id: 'new', fired_at: minutesAgo(1) }) },
      LOCATION
    )
    board = applyEvent(
      board,
      { type: 'ticket.fired', ticket: ticket({ id: 'old', fired_at: minutesAgo(12) }) },
      LOCATION
    )
    expect(board.map((t) => t.id)).toEqual(['old', 'new'])
  })
})

describe('station filtering', () => {
  it('lists the stations on the board', () => {
    const board = [ticket({ station: 'grill' }), ticket({ id: 't2', station: 'fry' })]
    expect(stationsOf(board)).toEqual(['fry', 'grill'])
  })

  it('shows an unrouted ticket on every station screen', () => {
    const board = [
      ticket({ id: 'g', station: 'grill' }),
      ticket({ id: 'f', station: 'fry' }),
      ticket({ id: 'u', station: null }),
    ]
    expect(filterByStation(board, 'grill').map((t) => t.id)).toEqual(['g', 'u'])
    expect(filterByStation(board, 'fry').map((t) => t.id)).toEqual(['f', 'u'])
  })

  it('shows everything when no station is chosen', () => {
    const board = [ticket({ station: 'grill' }), ticket({ id: 't2', station: 'fry' })]
    expect(filterByStation(board, null)).toHaveLength(2)
  })
})
