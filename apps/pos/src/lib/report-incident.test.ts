import { describe, it, expect, jest } from '@jest/globals'
import {
  needsManagerPin,
  toIncidentPayload,
  reportIncident,
  ReportIncidentError,
  type IncidentInput,
} from './report-incident'

function input(overrides: Partial<IncidentInput> = {}): IncidentInput {
  return {
    typeKey: 'wrong_item',
    title: 'Wrong side',
    costCents: 450,
    locationId: 'loc-1',
    orderId: null,
    kitchenTicketId: null,
    reportedByStaffId: 'staff-1',
    managerPin: null,
    ...overrides,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response
}

describe('needsManagerPin', () => {
  it('matches the server rule exactly', () => {
    // Mirrors requiresAuthorisation in apps/api/src/lib/incidents.ts. If these
    // two ever disagree, the register either prompts for a PIN the server does
    // not want or sends a comp the server will refuse.
    expect(needsManagerPin(0, 1000)).toBe(false)
    expect(needsManagerPin(999, 1000)).toBe(false)
    expect(needsManagerPin(1000, 1000)).toBe(true)
    expect(needsManagerPin(1350, 1000)).toBe(true)
  })

  it('never prompts on a zero-cost report, whatever the threshold', () => {
    expect(needsManagerPin(0, 0)).toBe(false)
  })
})

describe('toIncidentPayload', () => {
  it('sends cost in integer cents, never dollars', () => {
    const payload = toIncidentPayload(input({ costCents: 450 }))
    expect(payload['cost_cents']).toBe(450)
    expect(JSON.stringify(payload)).not.toContain('4.5')
  })

  it('omits the manager PIN entirely when none was entered', () => {
    const payload = toIncidentPayload(input({ costCents: 0, managerPin: null }))
    expect('manager_pin' in payload).toBe(false)
  })

  it('includes the PIN when one was entered', () => {
    const payload = toIncidentPayload(input({ costCents: 1350, managerPin: '4321' }))
    expect(payload['manager_pin']).toBe('4321')
  })

  it('sends the order link so the incident is attached to the sale', () => {
    const payload = toIncidentPayload(input({ orderId: 'ord-9' }))
    expect(payload['order_id']).toBe('ord-9')
  })

  it('does not send a location for a ticket-linked report — the server derives it', () => {
    // A ticket-linked incident inherits the ticket's location server-side.
    // Sending a location the client picked is how one gets filed to the wrong site.
    const payload = toIncidentPayload(input({ kitchenTicketId: 'tkt-1', locationId: 'loc-1' }))
    expect(payload['kitchen_ticket_id']).toBe('tkt-1')
    expect(payload['location_id']).toBeUndefined()
  })
})

describe('reportIncident', () => {
  it('returns the created incident', async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ incident: { id: 'inc-1', reference: 'INC-1042' } }, 201))

    const result = await reportIncident(input(), fetchImpl)

    expect(result.reference).toBe('INC-1042')
    expect(fetchImpl.mock.calls[0]![0]).toBe('/api/pos/incidents')
  })

  it("surfaces the server's refusal rather than retrying", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: 'A manager PIN is required for this amount' }, 403))

    await expect(reportIncident(input({ costCents: 1350 }), fetchImpl)).rejects.toThrow(
      'A manager PIN is required for this amount'
    )
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('flags a refusal as needing a PIN, so the dialog knows to ask', async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: 'A manager PIN is required' }, 403))

    await expect(reportIncident(input({ costCents: 1350 }), fetchImpl)).rejects.toMatchObject({
      needsPin: true,
    })
  })

  it('does not flag a validation error as needing a PIN', async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ error: 'This incident type needs an amount' }, 400))

    await expect(reportIncident(input(), fetchImpl)).rejects.toMatchObject({ needsPin: false })
  })

  it('refuses an empty title before touching the network', async () => {
    const fetchImpl = jest.fn<typeof fetch>()
    await expect(reportIncident(input({ title: '  ' }), fetchImpl)).rejects.toBeInstanceOf(
      ReportIncidentError
    )
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
