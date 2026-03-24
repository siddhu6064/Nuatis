import { getCalendarClient } from './google.js'

export interface TimeSlot {
  start: string
  end: string
}

export interface CreateEventParams {
  refreshToken: string
  calendarId: string
  title: string
  description: string
  start: string
  end: string
  attendeeEmail?: string
}

export async function getAvailableSlots(
  refreshToken: string,
  calendarId: string,
  dateStart: string,
  dateEnd: string
): Promise<TimeSlot[]> {
  const calendar = getCalendarClient(refreshToken)

  const freeBusy = await calendar.freebusy.query({
    requestBody: {
      timeMin: dateStart,
      timeMax: dateEnd,
      items: [{ id: calendarId }],
    },
  })

  const busy = freeBusy.data.calendars?.[calendarId]?.busy ?? []

  const slots: TimeSlot[] = []
  const rangeStart = new Date(dateStart)
  const rangeEnd = new Date(dateEnd)

  // Iterate day by day within range
  const cursor = new Date(rangeStart)
  cursor.setUTCHours(0, 0, 0, 0)

  while (cursor < rangeEnd) {
    // Business hours 9am–5pm UTC
    for (let hour = 9; hour < 17; hour++) {
      const slotStart = new Date(cursor)
      slotStart.setUTCHours(hour, 0, 0, 0)

      const slotEnd = new Date(cursor)
      slotEnd.setUTCHours(hour + 1, 0, 0, 0)

      // Skip slots outside the requested range
      if (slotStart < rangeStart || slotEnd > rangeEnd) continue

      const conflict = busy.some((b) => {
        const busyStart = new Date(b.start ?? '')
        const busyEnd = new Date(b.end ?? '')
        return slotStart < busyEnd && slotEnd > busyStart
      })

      if (!conflict) {
        slots.push({
          start: slotStart.toISOString(),
          end: slotEnd.toISOString(),
        })
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return slots
}

export async function createEvent(params: CreateEventParams): Promise<string> {
  const calendar = getCalendarClient(params.refreshToken)

  const event = await calendar.events.insert({
    calendarId: params.calendarId,
    requestBody: {
      summary: params.title,
      description: params.description,
      start: { dateTime: params.start, timeZone: 'UTC' },
      end: { dateTime: params.end, timeZone: 'UTC' },
      attendees: params.attendeeEmail ? [{ email: params.attendeeEmail }] : undefined,
    },
  })

  return event.data.id ?? ''
}

export async function updateEvent(
  refreshToken: string,
  calendarId: string,
  eventId: string,
  updates: Partial<{ title: string; description: string; start: string; end: string }>
): Promise<void> {
  const calendar = getCalendarClient(refreshToken)
  await calendar.events.patch({
    calendarId,
    eventId,
    requestBody: {
      ...(updates.title && { summary: updates.title }),
      ...(updates.description && { description: updates.description }),
      ...(updates.start && { start: { dateTime: updates.start, timeZone: 'UTC' } }),
      ...(updates.end && { end: { dateTime: updates.end, timeZone: 'UTC' } }),
    },
  })
}

export async function deleteEvent(
  refreshToken: string,
  calendarId: string,
  eventId: string
): Promise<void> {
  const calendar = getCalendarClient(refreshToken)
  await calendar.events.delete({ calendarId, eventId })
}
