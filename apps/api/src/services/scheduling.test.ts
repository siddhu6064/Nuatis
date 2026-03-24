import { jest } from '@jest/globals'

const mockEventsInsert = jest.fn()
const mockEventsPatch = jest.fn()
const mockEventsDelete = jest.fn()
const mockFreebusyQuery = jest.fn()

jest.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: jest.fn().mockImplementation(() => ({
        setCredentials: jest.fn(),
        generateAuthUrl: jest.fn(),
        getToken: jest.fn(),
      })),
    },
    calendar: jest.fn().mockReturnValue({
      events: { insert: mockEventsInsert, patch: mockEventsPatch, delete: mockEventsDelete },
      freebusy: { query: mockFreebusyQuery },
    }),
  },
}))

const { getAvailableSlots, createEvent, updateEvent, deleteEvent } = await import('./scheduling.js')

const REFRESH_TOKEN = 'fake-refresh-token'
const CALENDAR_ID = 'primary'

describe('scheduling.service', () => {
  beforeEach(() => jest.clearAllMocks())

  describe('getAvailableSlots', () => {
    it('returns 8 slots for a fully free day (9am–5pm UTC)', async () => {
      mockFreebusyQuery.mockResolvedValue({
        data: { calendars: { primary: { busy: [] } } },
      })

      const slots = await getAvailableSlots(
        REFRESH_TOKEN,
        CALENDAR_ID,
        '2026-04-07T09:00:00Z',
        '2026-04-07T17:00:00Z'
      )

      expect(slots.length).toBe(8)
      expect(slots[0]?.start).toBe('2026-04-07T09:00:00.000Z')
      expect(slots[7]?.end).toBe('2026-04-07T17:00:00.000Z')
    })

    it('excludes busy slots', async () => {
      mockFreebusyQuery.mockResolvedValue({
        data: {
          calendars: {
            primary: {
              busy: [{ start: '2026-04-07T09:00:00Z', end: '2026-04-07T11:00:00Z' }],
            },
          },
        },
      })

      const slots = await getAvailableSlots(
        REFRESH_TOKEN,
        CALENDAR_ID,
        '2026-04-07T09:00:00Z',
        '2026-04-07T17:00:00Z'
      )

      // 8 total minus 2 busy (9–10, 10–11) = 6
      expect(slots.length).toBe(6)
      // First available slot should be 11am
      expect(slots[0]?.start).toBe('2026-04-07T11:00:00.000Z')
    })

    it('returns empty array when fully booked', async () => {
      mockFreebusyQuery.mockResolvedValue({
        data: {
          calendars: {
            primary: {
              busy: [{ start: '2026-04-07T00:00:00Z', end: '2026-04-08T00:00:00Z' }],
            },
          },
        },
      })

      const slots = await getAvailableSlots(
        REFRESH_TOKEN,
        CALENDAR_ID,
        '2026-04-07T09:00:00Z',
        '2026-04-07T17:00:00Z'
      )

      expect(slots.length).toBe(0)
    })
  })

  describe('createEvent', () => {
    it('creates event and returns event ID', async () => {
      mockEventsInsert.mockResolvedValue({ data: { id: 'google-event-123' } })

      const id = await createEvent({
        refreshToken: REFRESH_TOKEN,
        calendarId: CALENDAR_ID,
        title: 'Dental cleaning',
        description: 'Annual cleaning',
        start: '2026-04-07T09:00:00Z',
        end: '2026-04-07T10:00:00Z',
        attendeeEmail: 'jane@example.com',
      })

      expect(id).toBe('google-event-123')
      expect(mockEventsInsert).toHaveBeenCalledTimes(1)
    })

    it('returns empty string if Google returns no ID', async () => {
      mockEventsInsert.mockResolvedValue({ data: {} })
      const id = await createEvent({
        refreshToken: REFRESH_TOKEN,
        calendarId: CALENDAR_ID,
        title: 'Test',
        description: '',
        start: '2026-04-07T09:00:00Z',
        end: '2026-04-07T10:00:00Z',
      })
      expect(id).toBe('')
    })
  })

  describe('updateEvent', () => {
    it('calls patch with correct event ID', async () => {
      mockEventsPatch.mockResolvedValue({ data: {} })
      await updateEvent(REFRESH_TOKEN, CALENDAR_ID, 'google-event-123', { title: 'Updated' })
      expect(mockEventsPatch).toHaveBeenCalledTimes(1)
      const call = mockEventsPatch.mock.calls[0]?.[0] as Record<string, unknown>
      expect(call?.['eventId']).toBe('google-event-123')
    })
  })

  describe('deleteEvent', () => {
    it('calls delete with correct event ID', async () => {
      mockEventsDelete.mockResolvedValue({ data: {} })
      await deleteEvent(REFRESH_TOKEN, CALENDAR_ID, 'google-event-123')
      expect(mockEventsDelete).toHaveBeenCalledTimes(1)
      const call = mockEventsDelete.mock.calls[0]?.[0] as Record<string, unknown>
      expect(call?.['eventId']).toBe('google-event-123')
    })
  })
})
