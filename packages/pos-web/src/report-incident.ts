export interface IncidentInput {
  typeKey: string
  title: string
  costCents: number
  locationId: string | null
  orderId: string | null
  kitchenTicketId: string | null
  reportedByStaffId: string | null
  managerPin: string | null
}

export interface ReportedIncident {
  id: string
  reference: string
}

export class ReportIncidentError extends Error {
  constructor(
    message: string,
    /** True when the server refused for want of a manager PIN. */
    readonly needsPin = false
  ) {
    super(message)
    this.name = 'ReportIncidentError'
  }
}

/**
 * Whether this amount needs a manager.
 *
 * Mirrors `requiresAuthorisation` in `apps/api/src/lib/incidents.ts`, and must
 * keep mirroring it: if the two disagree the register either prompts for a PIN
 * the server does not want, or sends a comp the server will refuse after the
 * cashier has already told the customer it went through.
 *
 * The server is authoritative regardless. This only decides whether to show the
 * PIN pad — a register is a device in a public room and its request body is not
 * trustworthy.
 */
export function needsManagerPin(costCents: number, thresholdCents: number): boolean {
  if (costCents <= 0) return false
  return costCents >= thresholdCents
}

/** The request body, in the shape `POST /api/pos/incidents` expects. */
export function toIncidentPayload(input: IncidentInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    type_key: input.typeKey,
    title: input.title.trim(),
    cost_cents: input.costCents,
  }

  if (input.orderId) payload['order_id'] = input.orderId
  if (input.reportedByStaffId) payload['reported_by_staff_id'] = input.reportedByStaffId

  if (input.kitchenTicketId) {
    // A ticket-linked incident inherits the ticket's location server-side.
    // Sending a location the client chose is how one gets filed against the
    // wrong site in a multi-location tenant.
    payload['kitchen_ticket_id'] = input.kitchenTicketId
  } else if (input.locationId) {
    payload['location_id'] = input.locationId
  }

  // Omitted rather than sent as null, so a PIN never appears in a request that
  // did not need one.
  if (input.managerPin) payload['manager_pin'] = input.managerPin

  return payload
}

/**
 * Report an incident from the register.
 *
 * A 403 is surfaced as `needsPin` so the dialog can open the PIN pad instead of
 * showing a dead end. Any other failure is reported as-is — the server's own
 * wording is more useful than a generic retry message, and retrying a refused
 * comp automatically would be the wrong instinct entirely.
 */
export async function reportIncident(
  input: IncidentInput,
  fetchImpl: typeof fetch = fetch
): Promise<ReportedIncident> {
  if (input.title.trim() === '') throw new ReportIncidentError('Give the issue a short title')

  const res = await fetchImpl('/api/pos/incidents', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(toIncidentPayload(input)),
  })

  if (!res.ok) {
    let message = 'That could not be reported.'
    try {
      const body = (await res.json()) as { error?: string }
      if (body.error) message = body.error
    } catch {
      // Keep the fallback.
    }
    throw new ReportIncidentError(message, res.status === 403)
  }

  const body = (await res.json()) as { incident?: ReportedIncident }
  if (!body.incident?.id) throw new ReportIncidentError('The report came back without an id.')
  return body.incident
}
