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

// Get available slots — returns free 1-hour windows in a date range
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

  // Generate 1-hour slots during business hours (9am–5pm)
  const slots: TimeSlot[] = []
  const start = new Date(dateStart)
  const end = new Date(dateEnd)

  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    for (let hour = 9; hour < 17; hour++) {
      const slotStart = new Date(d)
      slotStart.setHours(hour, 0, 0, 0)
      const slotEnd = new Date(d)
      slotEnd.setHours(hour + 1, 0, 0, 0)

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
