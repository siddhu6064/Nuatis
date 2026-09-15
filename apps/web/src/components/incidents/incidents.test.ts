import { toDollars, isOverdue, type Incident } from './types'

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    id: 'i1',
    reference: 'INC-1001',
    type_key: 'wrong_item',
    severity: 'medium',
    status: 'open',
    title: 'Wrong side',
    description: null,
    cost_cents: 450,
    assigned_to_user_id: null,
    sla_due_at: '2026-09-15T12:00:00.000Z',
    resolved_at: null,
    root_cause: null,
    resolution_notes: null,
    created_at: '2026-09-15T10:00:00.000Z',
    ...overrides,
  }
}

const AFTER_DUE = Date.parse('2026-09-15T13:00:00.000Z')
const BEFORE_DUE = Date.parse('2026-09-15T11:00:00.000Z')

describe('toDollars', () => {
  it('formats integer cents without float arithmetic', () => {
    expect(toDollars(0)).toBe('0.00')
    expect(toDollars(5)).toBe('0.05')
    expect(toDollars(450)).toBe('4.50')
    expect(toDollars(5994)).toBe('59.94')
  })
})

describe('isOverdue', () => {
  it('is overdue once the SLA has passed and it is still live', () => {
    expect(isOverdue(incident(), AFTER_DUE)).toBe(true)
  })

  it('is not overdue before the SLA', () => {
    expect(isOverdue(incident(), BEFORE_DUE)).toBe(false)
  })

  it('is never overdue once resolved — the clock stopped', () => {
    expect(isOverdue(incident({ status: 'resolved' }), AFTER_DUE)).toBe(false)
    expect(isOverdue(incident({ status: 'cancelled' }), AFTER_DUE)).toBe(false)
  })

  it('is not overdue when there is no SLA at all', () => {
    expect(isOverdue(incident({ sla_due_at: null }), AFTER_DUE)).toBe(false)
  })

  it('treats an unparseable SLA as not overdue rather than screaming', () => {
    expect(isOverdue(incident({ sla_due_at: 'not a date' }), AFTER_DUE)).toBe(false)
  })
})
