# Online Booking Page + Intake Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public online booking page and customizable intake forms to Nuatis CRM — customers select a service, pick a time slot from Google Calendar availability, fill contact + intake info, and get an appointment booked with SMS confirmation.

**Architecture:** Three new DB tables (intake_forms, intake_submissions) plus columns on tenants for booking config. Public API routes (no auth) serve the customer-facing booking page; authenticated routes manage settings and intake forms. The booking page is a standalone Next.js page outside the dashboard layout at `/book/[slug]`. Google Calendar availability is checked via existing `getCalendarClient` + FreeBusy API; appointments are created with existing patterns.

**Tech Stack:** Express routes (apps/api), Supabase PostgreSQL, Google Calendar API (existing googleapis dependency), Next.js 14 App Router (apps/web), Tailwind v3, web-push (existing).

**Key Codebase Facts:**

- Latest migration: `0032_bcc_logging_address.sql` → new migrations start at `0033`
- Import pattern: all `.ts` files in apps/api use `.js` extensions
- Auth: `requireAuth` middleware → cast `req as AuthenticatedRequest` → `.tenantId`, `.userId`
- DB: `getSupabase()` returns service-role client, defined locally per file
- Google Calendar: credentials on `locations` table (`google_refresh_token`, `google_calendar_id`), use `getCalendarClient(refreshToken)` from `../services/google.js`
- Scheduling helpers: `getAvailableSlots()`, `createEvent()` in `../services/scheduling.js`
- Business hours: `getHoursForDate(date, vertical)` and `dateAtHour(dateStr, hour, minute, tz)` are private to tool-handlers.ts — we'll need to extract/duplicate the slot computation logic
- Appointments: INSERT into `appointments` table with contact_id, title, start_time, end_time, status, google_event_id
- Contacts: INSERT with full_name, phone, email, source, tenant_id
- SMS: `sendSms(from, to, text, { tenantId, contactId })` — needs the tenant's Telnyx number from locations table
- Push: `sendPushNotification(tenantId, { title, body, url? })`
- Activity: `logActivity({ tenantId, contactId, type, body, metadata, actorType, actorId })` — type is TEXT, no CHECK constraint
- Sidebar: NAV array in `apps/web/src/app/(dashboard)/Sidebar.tsx`
- Routes: mounted in `apps/api/src/index.ts` via `app.use()`
- Public pages: live outside `(dashboard)/` route group (e.g., `apps/web/src/app/quotes/view/[token]/page.tsx`)
- DEFAULT_TZ: `'America/Chicago'`

---

## File Structure

### New Files — API

| File                                                 | Responsibility                                          |
| ---------------------------------------------------- | ------------------------------------------------------- |
| `supabase/migrations/0033_booking_page_settings.sql` | Booking config columns on tenants                       |
| `supabase/migrations/0034_intake_forms.sql`          | intake_forms table                                      |
| `supabase/migrations/0035_intake_submissions.sql`    | intake_submissions table                                |
| `apps/api/src/lib/booking-availability.ts`           | Slot computation (extracted from tool-handlers pattern) |
| `apps/api/src/routes/booking-public.ts`              | Public booking API (no auth)                            |
| `apps/api/src/routes/booking-settings.ts`            | Booking settings CRUD (auth)                            |
| `apps/api/src/routes/intake-forms.ts`                | Intake forms CRUD + submissions (auth)                  |
| `apps/api/src/scripts/seed-intake-forms.ts`          | Default intake form seeder                              |

### New Files — Web

| File                                                          | Responsibility                                        |
| ------------------------------------------------------------- | ----------------------------------------------------- |
| `apps/web/src/app/book/[slug]/page.tsx`                       | Public booking page (standalone, no dashboard layout) |
| `apps/web/src/app/(dashboard)/settings/booking/page.tsx`      | Booking settings page                                 |
| `apps/web/src/app/(dashboard)/settings/intake-forms/page.tsx` | Intake form list + builder                            |

### Modified Files

| File                                       | Change                  |
| ------------------------------------------ | ----------------------- |
| `apps/api/src/index.ts`                    | Mount 3 new route files |
| `apps/web/src/app/(dashboard)/Sidebar.tsx` | Add 2 nav items         |

---

## Task 1: Database Migrations

**Files:**

- Create: `supabase/migrations/0033_booking_page_settings.sql`
- Create: `supabase/migrations/0034_intake_forms.sql`
- Create: `supabase/migrations/0035_intake_submissions.sql`

- [ ] **Step 1: Create booking page settings migration**

Create `supabase/migrations/0033_booking_page_settings.sql`:

```sql
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS booking_page_enabled BOOLEAN DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS booking_page_slug TEXT UNIQUE;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS booking_services UUID[] DEFAULT '{}';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS booking_buffer_minutes INTEGER DEFAULT 15;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS booking_advance_days INTEGER DEFAULT 30;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS booking_confirmation_message TEXT DEFAULT 'Your appointment has been booked! We look forward to seeing you.';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS booking_google_review_url TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS booking_accent_color TEXT DEFAULT '#2563eb';

CREATE INDEX IF NOT EXISTS idx_tenants_booking_slug ON tenants(booking_page_slug) WHERE booking_page_slug IS NOT NULL;
```

- [ ] **Step 2: Create intake_forms migration**

Create `supabase/migrations/0034_intake_forms.sql`:

```sql
CREATE TABLE intake_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  description TEXT,
  fields JSONB NOT NULL DEFAULT '[]',
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  linked_service_ids UUID[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE intake_forms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON intake_forms
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE authjs_user_id = auth.uid()));
CREATE INDEX idx_intake_forms_tenant ON intake_forms(tenant_id);
```

- [ ] **Step 3: Create intake_submissions migration**

Create `supabase/migrations/0035_intake_submissions.sql`:

```sql
CREATE TABLE intake_submissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  form_id UUID NOT NULL REFERENCES intake_forms(id),
  contact_id UUID REFERENCES contacts(id),
  appointment_id UUID REFERENCES appointments(id),
  data JSONB NOT NULL DEFAULT '{}',
  submitted_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE intake_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON intake_submissions
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE authjs_user_id = auth.uid()));
CREATE INDEX idx_intake_submissions_tenant ON intake_submissions(tenant_id);
CREATE INDEX idx_intake_submissions_contact ON intake_submissions(contact_id);
CREATE INDEX idx_intake_submissions_form ON intake_submissions(form_id);
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0033_booking_page_settings.sql supabase/migrations/0034_intake_forms.sql supabase/migrations/0035_intake_submissions.sql
git commit -m "feat(booking): add database migrations for booking settings, intake forms, and submissions"
```

---

## Task 2: Booking Availability Helper

**Files:**

- Create: `apps/api/src/lib/booking-availability.ts`

This extracts the slot computation logic from tool-handlers.ts into a reusable module for the public booking API.

- [ ] **Step 1: Create booking-availability.ts**

Create `apps/api/src/lib/booking-availability.ts`:

```typescript
import { createClient } from '@supabase/supabase-js'
import { getCalendarClient } from '../services/google.js'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

const DEFAULT_TZ = 'America/Chicago'

// Default business hours (same as tool-handlers)
const DEFAULT_HOURS = {
  mon: '9am-5pm',
  tue: '9am-5pm',
  wed: '9am-5pm',
  thu: '9am-5pm',
  fri: '9am-5pm',
  sat: 'closed',
  sun: 'closed',
}

function parseHoursRange(range: string): { open: number; close: number } | null {
  if (!range || range.toLowerCase() === 'closed') return null
  const m = range.match(/(\d{1,2})(am|pm)\s*-\s*(\d{1,2})(am|pm)/i)
  if (!m) return null
  let open = parseInt(m[1]!)
  if (m[2]!.toLowerCase() === 'pm' && open !== 12) open += 12
  if (m[2]!.toLowerCase() === 'am' && open === 12) open = 0
  let close = parseInt(m[3]!)
  if (m[4]!.toLowerCase() === 'pm' && close !== 12) close += 12
  if (m[4]!.toLowerCase() === 'am' && close === 12) close = 0
  return { open, close }
}

function getHoursForDate(date: Date, _vertical?: string): { open: number; close: number } | null {
  const hours = DEFAULT_HOURS
  const day = date.getDay() // 0=Sun, 6=Sat
  if (day === 0) return parseHoursRange(hours.sun)
  if (day === 6) return parseHoursRange(hours.sat)
  const weekdays = [hours.mon, hours.tue, hours.wed, hours.thu, hours.fri]
  return parseHoursRange(weekdays[day - 1]!)
}

function dateAtHour(dateStr: string, hour: number, minute: number, tz: string): string {
  const d = new Date(
    `${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`
  )
  // Convert wall-clock time to UTC using the target timezone
  const utcStr = d.toLocaleString('en-US', { timeZone: 'UTC' })
  const tzStr = d.toLocaleString('en-US', { timeZone: tz })
  const diff = new Date(utcStr).getTime() - new Date(tzStr).getTime()
  return new Date(d.getTime() + diff).toISOString()
}

function formatHHMM(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00'
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00'
  return `${h}:${m}`
}

export interface TimeSlot {
  start: string // HH:MM
  end: string // HH:MM
}

export interface CalendarCredentials {
  refreshToken: string
  calendarId: string
  timezone: string
}

/**
 * Get calendar credentials for a tenant from their primary location.
 */
export async function getTenantCalendarCredentials(
  tenantId: string
): Promise<CalendarCredentials | null> {
  const supabase = getSupabase()
  const { data: location } = await supabase
    .from('locations')
    .select('google_refresh_token, google_calendar_id')
    .eq('tenant_id', tenantId)
    .eq('is_primary', true)
    .maybeSingle()

  if (!location?.google_refresh_token) return null

  // Get tenant timezone
  const { data: tenant } = await supabase
    .from('tenants')
    .select('timezone')
    .eq('id', tenantId)
    .single()

  return {
    refreshToken: location.google_refresh_token,
    calendarId: location.google_calendar_id || 'primary',
    timezone: tenant?.timezone || DEFAULT_TZ,
  }
}

/**
 * Get available time slots for a date, applying buffer minutes between appointments.
 */
export async function getAvailableSlotsForDate(
  creds: CalendarCredentials,
  date: string, // YYYY-MM-DD
  durationMinutes: number,
  bufferMinutes: number
): Promise<{ slots: TimeSlot[]; closed: boolean }> {
  const requestedDate = new Date(`${date}T12:00:00Z`)
  const hoursWindow = getHoursForDate(requestedDate)

  if (!hoursWindow) {
    return { slots: [], closed: true }
  }

  const { refreshToken, calendarId, timezone } = creds
  const timeMin = dateAtHour(date, hoursWindow.open, 0, timezone)
  const timeMax = dateAtHour(date, hoursWindow.close, 0, timezone)

  const calendar = getCalendarClient(refreshToken)
  const freeBusy = await calendar.freebusy.query({
    requestBody: {
      timeMin,
      timeMax,
      items: [{ id: calendarId }],
    },
  })

  const busy = freeBusy.data.calendars?.[calendarId]?.busy ?? []
  const busyPeriods = busy.map((b) => ({
    start: new Date(b.start ?? ''),
    end: new Date(b.end ?? ''),
  }))

  // Generate slots with buffer
  const slots: TimeSlot[] = []
  const windowStart = new Date(timeMin)
  const windowEnd = new Date(timeMax)
  const slotMs = durationMinutes * 60_000
  const stepMs = (durationMinutes + bufferMinutes) * 60_000

  let cursor = windowStart.getTime()
  while (cursor + slotMs <= windowEnd.getTime()) {
    const sStart = new Date(cursor)
    const sEnd = new Date(cursor + slotMs)

    // Check for conflict with busy periods (including buffer)
    const sEndWithBuffer = new Date(cursor + stepMs)
    const conflict = busyPeriods.some((b) => sStart < b.end && sEndWithBuffer > b.start)

    if (!conflict) {
      slots.push({
        start: formatHHMM(sStart, timezone),
        end: formatHHMM(sEnd, timezone),
      })
    }

    cursor += stepMs
  }

  return { slots, closed: false }
}

/**
 * Check if a specific slot is still available (for double-booking prevention).
 */
export async function isSlotAvailable(
  creds: CalendarCredentials,
  date: string,
  startTime: string, // HH:MM
  durationMinutes: number
): Promise<boolean> {
  const { refreshToken, calendarId, timezone } = creds
  const [hStr, mStr] = startTime.split(':')
  const startIso = dateAtHour(date, parseInt(hStr!), parseInt(mStr ?? '0'), timezone)
  const endIso = new Date(new Date(startIso).getTime() + durationMinutes * 60_000).toISOString()

  const calendar = getCalendarClient(refreshToken)
  const freeBusy = await calendar.freebusy.query({
    requestBody: {
      timeMin: startIso,
      timeMax: endIso,
      items: [{ id: calendarId }],
    },
  })

  const busy = freeBusy.data.calendars?.[calendarId]?.busy ?? []
  return busy.length === 0
}

/**
 * Create a Google Calendar event and return the event ID + computed ISO times.
 */
export async function createCalendarEvent(
  creds: CalendarCredentials,
  date: string,
  startTime: string, // HH:MM
  durationMinutes: number,
  title: string,
  description: string
): Promise<{ googleEventId: string; startIso: string; endIso: string }> {
  const { refreshToken, calendarId, timezone } = creds
  const [hStr, mStr] = startTime.split(':')
  const startIso = dateAtHour(date, parseInt(hStr!), parseInt(mStr ?? '0'), timezone)
  const endIso = new Date(new Date(startIso).getTime() + durationMinutes * 60_000).toISOString()

  const calendar = getCalendarClient(refreshToken)
  const event = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: title,
      description,
      start: { dateTime: startIso, timeZone: timezone },
      end: { dateTime: endIso, timeZone: timezone },
    },
  })

  return {
    googleEventId: event.data.id ?? '',
    startIso,
    endIso,
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/lib/booking-availability.ts
git commit -m "feat(booking): add booking availability helper with slot computation"
```

---

## Task 3: Public Booking API Routes

**Files:**

- Create: `apps/api/src/routes/booking-public.ts`

- [ ] **Step 1: Create booking-public.ts**

Create `apps/api/src/routes/booking-public.ts`:

```typescript
import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import {
  getTenantCalendarCredentials,
  getAvailableSlotsForDate,
  isSlotAvailable,
  createCalendarEvent,
} from '../lib/booking-availability.js'
import { logActivity } from '../lib/activity.js'
import { sendSms } from '../lib/sms.js'
import { sendPushNotification } from '../lib/push-client.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// GET /api/book/:slug — get booking page data (PUBLIC)
router.get('/:slug', async (req: Request, res: Response) => {
  try {
    const supabase = getSupabase()
    const { data: tenant } = await supabase
      .from('tenants')
      .select(
        'id, name, phone, booking_page_enabled, booking_page_slug, booking_services, booking_buffer_minutes, booking_advance_days, booking_confirmation_message, booking_google_review_url, booking_accent_color'
      )
      .eq('booking_page_slug', req.params['slug'])
      .single()

    if (!tenant || !tenant.booking_page_enabled) {
      return res.status(404).json({ error: 'Booking page not found' })
    }

    // Fetch enabled services
    const serviceIds: string[] = tenant.booking_services || []
    let services: unknown[] = []
    if (serviceIds.length > 0) {
      const { data } = await supabase
        .from('services')
        .select('id, name, description, duration_minutes, unit_price')
        .in('id', serviceIds)
        .eq('tenant_id', tenant.id)
        .eq('is_active', true)
      services = data || []
    }

    // Fetch linked intake forms for these services
    const { data: intakeForms } = await supabase
      .from('intake_forms')
      .select('id, name, fields, linked_service_ids')
      .eq('tenant_id', tenant.id)
      .eq('is_active', true)

    // Build service-to-form map
    const serviceFormsMap: Record<string, { id: string; name: string; fields: unknown[] }> = {}
    for (const form of intakeForms || []) {
      const linkedIds: string[] = form.linked_service_ids || []
      for (const sid of linkedIds) {
        if (serviceIds.includes(sid)) {
          serviceFormsMap[sid] = { id: form.id, name: form.name, fields: form.fields }
        }
      }
    }

    // Get tenant phone from primary location (for SMS from number)
    const { data: location } = await supabase
      .from('locations')
      .select('telnyx_number')
      .eq('tenant_id', tenant.id)
      .eq('is_primary', true)
      .maybeSingle()

    return res.json({
      tenantId: tenant.id,
      businessName: tenant.name,
      businessPhone: tenant.phone || location?.telnyx_number || null,
      accentColor: tenant.booking_accent_color,
      confirmationMessage: tenant.booking_confirmation_message,
      googleReviewUrl: tenant.booking_google_review_url,
      bufferMinutes: tenant.booking_buffer_minutes,
      advanceDays: tenant.booking_advance_days,
      services: (
        services as Array<{
          id: string
          name: string
          description: string | null
          duration_minutes: number | null
          unit_price: number
        }>
      ).map((s) => ({
        ...s,
        intakeForm: serviceFormsMap[s.id] || null,
      })),
    })
  } catch (err) {
    console.error('Get booking page error:', err)
    return res.status(500).json({ error: 'Failed to load booking page' })
  }
})

// GET /api/book/:slug/availability?serviceId=xxx&date=YYYY-MM-DD (PUBLIC)
router.get('/:slug/availability', async (req: Request, res: Response) => {
  try {
    const supabase = getSupabase()
    const serviceId = req.query['serviceId'] as string
    const date = req.query['date'] as string

    if (!serviceId || !date) {
      return res.status(400).json({ error: 'serviceId and date are required' })
    }

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' })
    }

    const { data: tenant } = await supabase
      .from('tenants')
      .select('id, booking_page_enabled, booking_buffer_minutes, booking_advance_days')
      .eq('booking_page_slug', req.params['slug'])
      .single()

    if (!tenant || !tenant.booking_page_enabled) {
      return res.status(404).json({ error: 'Booking page not found' })
    }

    // Validate date is within advance days
    const requestDate = new Date(date)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const maxDate = new Date(today)
    maxDate.setDate(maxDate.getDate() + (tenant.booking_advance_days || 30))

    if (requestDate < today) {
      return res.status(400).json({ error: 'Cannot book in the past' })
    }
    if (requestDate > maxDate) {
      return res
        .status(400)
        .json({ error: `Cannot book more than ${tenant.booking_advance_days} days in advance` })
    }

    // Get service duration
    const { data: service } = await supabase
      .from('services')
      .select('duration_minutes')
      .eq('id', serviceId)
      .eq('tenant_id', tenant.id)
      .single()

    if (!service) return res.status(404).json({ error: 'Service not found' })

    const durationMinutes = service.duration_minutes || 60
    const bufferMinutes = tenant.booking_buffer_minutes || 15

    // Get calendar credentials
    const creds = await getTenantCalendarCredentials(tenant.id)
    if (!creds) {
      return res.status(503).json({ error: 'Calendar not connected for this business' })
    }

    const { slots, closed } = await getAvailableSlotsForDate(
      creds,
      date,
      durationMinutes,
      bufferMinutes
    )

    if (closed) {
      return res.json({ date, slots: [], message: 'Business is closed on this date' })
    }

    return res.json({ date, slots })
  } catch (err) {
    console.error('Get availability error:', err)
    return res.status(500).json({ error: 'Failed to check availability' })
  }
})

// POST /api/book/:slug/confirm — book appointment (PUBLIC)
router.post('/:slug/confirm', async (req: Request, res: Response) => {
  try {
    const supabase = getSupabase()
    const {
      serviceId,
      date,
      startTime,
      firstName,
      lastName,
      email,
      phone,
      intakeFormId,
      intakeData,
      notes,
    } = req.body

    if (!serviceId || !date || !startTime || !firstName || !lastName || !email || !phone) {
      return res.status(400).json({ error: 'Missing required fields' })
    }

    // Look up tenant
    const { data: tenant } = await supabase
      .from('tenants')
      .select('id, name, booking_page_enabled, booking_confirmation_message')
      .eq('booking_page_slug', req.params['slug'])
      .single()

    if (!tenant || !tenant.booking_page_enabled) {
      return res.status(404).json({ error: 'Booking page not found' })
    }

    // Get service
    const { data: service } = await supabase
      .from('services')
      .select('id, name, duration_minutes')
      .eq('id', serviceId)
      .eq('tenant_id', tenant.id)
      .single()

    if (!service) return res.status(404).json({ error: 'Service not found' })

    const durationMinutes = service.duration_minutes || 60

    // Check calendar credentials
    const creds = await getTenantCalendarCredentials(tenant.id)

    // Re-validate slot availability (prevent double-booking)
    if (creds) {
      const available = await isSlotAvailable(creds, date, startTime, durationMinutes)
      if (!available) {
        return res
          .status(409)
          .json({ error: 'This time slot is no longer available. Please select another time.' })
      }
    }

    // Find or create contact
    const fullName = `${firstName} ${lastName}`.trim()
    let contactId: string | null = null

    // Try phone match first, then email
    const { data: existingByPhone } = await supabase
      .from('contacts')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('phone', phone)
      .limit(1)
      .maybeSingle()

    if (existingByPhone) {
      contactId = existingByPhone.id
      // Update name if provided
      await supabase
        .from('contacts')
        .update({ full_name: fullName, email, updated_at: new Date().toISOString() })
        .eq('id', contactId)
    } else {
      const { data: existingByEmail } = await supabase
        .from('contacts')
        .select('id')
        .eq('tenant_id', tenant.id)
        .eq('email', email)
        .limit(1)
        .maybeSingle()

      if (existingByEmail) {
        contactId = existingByEmail.id
        await supabase
          .from('contacts')
          .update({ full_name: fullName, phone, updated_at: new Date().toISOString() })
          .eq('id', contactId)
      } else {
        // Create new contact
        const { data: newContact } = await supabase
          .from('contacts')
          .insert({
            tenant_id: tenant.id,
            full_name: fullName,
            email,
            phone,
            source: 'booking_page',
          })
          .select('id')
          .single()

        contactId = newContact?.id || null
      }
    }

    // Get primary location for appointment
    const { data: location } = await supabase
      .from('locations')
      .select('id, telnyx_number')
      .eq('tenant_id', tenant.id)
      .eq('is_primary', true)
      .maybeSingle()

    // Create Google Calendar event if connected
    let googleEventId: string | null = null
    let startIso: string = ''
    let endIso: string = ''

    if (creds) {
      const title = `${service.name} - ${fullName}`
      const description = `Booked via online booking page.\nPhone: ${phone}\nEmail: ${email}${notes ? `\nNotes: ${notes}` : ''}`
      const calResult = await createCalendarEvent(
        creds,
        date,
        startTime,
        durationMinutes,
        title,
        description
      )
      googleEventId = calResult.googleEventId
      startIso = calResult.startIso
      endIso = calResult.endIso
    } else {
      // No calendar — compute times manually
      const tz = 'America/Chicago'
      const [h, m] = startTime.split(':')
      const dt = new Date(`${date}T${h!.padStart(2, '0')}:${(m ?? '0').padStart(2, '0')}:00`)
      startIso = dt.toISOString()
      endIso = new Date(dt.getTime() + durationMinutes * 60_000).toISOString()
    }

    // Create appointment
    const { data: appointment } = await supabase
      .from('appointments')
      .insert({
        tenant_id: tenant.id,
        contact_id: contactId,
        location_id: location?.id || null,
        title: `${service.name} - ${fullName}`,
        description: notes || null,
        start_time: startIso,
        end_time: endIso,
        status: 'confirmed',
        google_event_id: googleEventId,
        notes: `Booked via online booking page${notes ? `. Customer notes: ${notes}` : ''}`,
      })
      .select('id')
      .single()

    const appointmentId = appointment?.id || null

    // Save intake form submission if provided
    if (intakeFormId && intakeData) {
      await supabase.from('intake_submissions').insert({
        tenant_id: tenant.id,
        form_id: intakeFormId,
        contact_id: contactId,
        appointment_id: appointmentId,
        data: intakeData,
      })

      // Log intake submission activity
      if (contactId) {
        await logActivity({
          tenantId: tenant.id,
          contactId,
          type: 'system',
          body: 'Intake form submitted via online booking',
          metadata: { form_id: intakeFormId, appointment_id: appointmentId },
          actorType: 'contact',
        })
      }
    }

    // Log booking activity
    if (contactId) {
      await logActivity({
        tenantId: tenant.id,
        contactId,
        type: 'appointment',
        body: `Booked via online booking page: ${service.name} on ${date} at ${startTime}`,
        metadata: { appointment_id: appointmentId, service_id: serviceId, source: 'booking_page' },
        actorType: 'contact',
      })
    }

    // Send SMS confirmation
    if (phone && location?.telnyx_number) {
      try {
        await sendSms(
          location.telnyx_number,
          phone,
          `Your appointment for ${service.name} on ${date} at ${startTime} has been confirmed. - ${tenant.name}`,
          {
            tenantId: tenant.id,
            contactId: contactId || undefined,
          }
        )
      } catch (smsErr) {
        console.error('SMS confirmation failed:', smsErr)
        // Non-blocking — booking still succeeds
      }
    }

    // Send push notification to tenant owner
    try {
      await sendPushNotification(tenant.id, {
        title: 'New Online Booking',
        body: `${service.name} with ${fullName} on ${date} at ${startTime}`,
        url: appointmentId ? `/appointments` : undefined,
      })
    } catch (pushErr) {
      console.error('Push notification failed:', pushErr)
    }

    return res.json({
      success: true,
      appointmentId,
      confirmationMessage: tenant.booking_confirmation_message,
    })
  } catch (err) {
    console.error('Confirm booking error:', err)
    return res.status(500).json({ error: 'Failed to complete booking' })
  }
})

export default router
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/routes/booking-public.ts
git commit -m "feat(booking): add public booking API with availability, confirmation, and SMS"
```

---

## Task 4: Booking Settings API Routes

**Files:**

- Create: `apps/api/src/routes/booking-settings.ts`

- [ ] **Step 1: Create booking-settings.ts**

Create `apps/api/src/routes/booking-settings.ts`:

```typescript
import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// GET /api/settings/booking — get booking settings
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    const { data: tenant } = await supabase
      .from('tenants')
      .select(
        'booking_page_enabled, booking_page_slug, booking_services, booking_buffer_minutes, booking_advance_days, booking_confirmation_message, booking_google_review_url, booking_accent_color'
      )
      .eq('id', authed.tenantId)
      .single()

    if (!tenant) return res.status(404).json({ error: 'Tenant not found' })

    // Also return all services for the picker
    const { data: services } = await supabase
      .from('services')
      .select('id, name, description, duration_minutes, unit_price, is_active')
      .eq('tenant_id', authed.tenantId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })

    return res.json({
      enabled: tenant.booking_page_enabled,
      slug: tenant.booking_page_slug,
      serviceIds: tenant.booking_services || [],
      bufferMinutes: tenant.booking_buffer_minutes,
      advanceDays: tenant.booking_advance_days,
      confirmationMessage: tenant.booking_confirmation_message,
      googleReviewUrl: tenant.booking_google_review_url,
      accentColor: tenant.booking_accent_color,
      services: services || [],
    })
  } catch (err) {
    console.error('Get booking settings error:', err)
    return res.status(500).json({ error: 'Failed to load booking settings' })
  }
})

// PUT /api/settings/booking — update booking settings
router.put('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const {
      enabled,
      slug,
      serviceIds,
      bufferMinutes,
      advanceDays,
      confirmationMessage,
      googleReviewUrl,
      accentColor,
    } = req.body

    // Validate slug if provided
    if (slug !== undefined && slug !== null) {
      const slugStr = String(slug).toLowerCase().trim()
      if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slugStr)) {
        return res
          .status(400)
          .json({ error: 'Slug must be 3-50 characters, lowercase alphanumeric and hyphens only' })
      }

      // Check uniqueness
      const { data: existing } = await supabase
        .from('tenants')
        .select('id')
        .eq('booking_page_slug', slugStr)
        .neq('id', authed.tenantId)
        .maybeSingle()

      if (existing) {
        return res.status(409).json({ error: 'This booking URL is already taken' })
      }
    }

    // Validate buffer and advance days
    const bufferMin =
      bufferMinutes !== undefined ? Math.max(5, Math.min(60, Number(bufferMinutes))) : undefined
    const advDays =
      advanceDays !== undefined ? Math.max(1, Math.min(90, Number(advanceDays))) : undefined

    const updates: Record<string, unknown> = {}
    if (enabled !== undefined) updates['booking_page_enabled'] = Boolean(enabled)
    if (slug !== undefined) updates['booking_page_slug'] = String(slug).toLowerCase().trim() || null
    if (serviceIds !== undefined) updates['booking_services'] = serviceIds
    if (bufferMin !== undefined) updates['booking_buffer_minutes'] = bufferMin
    if (advDays !== undefined) updates['booking_advance_days'] = advDays
    if (confirmationMessage !== undefined)
      updates['booking_confirmation_message'] = confirmationMessage
    if (googleReviewUrl !== undefined)
      updates['booking_google_review_url'] = googleReviewUrl || null
    if (accentColor !== undefined) updates['booking_accent_color'] = accentColor

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' })
    }

    const { error } = await supabase.from('tenants').update(updates).eq('id', authed.tenantId)

    if (error) return res.status(500).json({ error: error.message })
    return res.json({ success: true })
  } catch (err) {
    console.error('Update booking settings error:', err)
    return res.status(500).json({ error: 'Failed to update booking settings' })
  }
})

// GET /api/settings/booking/preview-url — get full booking URL
router.get('/preview-url', requireAuth, async (req: Request, res: Response) => {
  try {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const { data: tenant } = await supabase
      .from('tenants')
      .select('booking_page_slug')
      .eq('id', authed.tenantId)
      .single()

    if (!tenant?.booking_page_slug) {
      return res.status(404).json({ error: 'Booking page slug not configured' })
    }

    const webUrl = process.env['WEB_URL'] || 'http://localhost:3000'
    return res.json({ url: `${webUrl}/book/${tenant.booking_page_slug}` })
  } catch (err) {
    console.error('Get preview URL error:', err)
    return res.status(500).json({ error: 'Failed to get preview URL' })
  }
})

export default router
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/routes/booking-settings.ts
git commit -m "feat(booking): add booking settings API with slug validation"
```

---

## Task 5: Intake Forms API Routes

**Files:**

- Create: `apps/api/src/routes/intake-forms.ts`

- [ ] **Step 1: Create intake-forms.ts**

Create `apps/api/src/routes/intake-forms.ts`:

```typescript
import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

const VALID_FIELD_TYPES = [
  'text',
  'email',
  'phone',
  'textarea',
  'select',
  'checkbox',
  'date',
  'number',
]

interface FieldDef {
  id: string
  type: string
  label: string
  required?: boolean
  placeholder?: string
  options?: string[]
}

function validateFields(fields: unknown): { valid: boolean; error?: string } {
  if (!Array.isArray(fields)) return { valid: false, error: 'fields must be an array' }
  for (const f of fields) {
    const field = f as FieldDef
    if (!field.id || !field.type || !field.label) {
      return { valid: false, error: 'Each field must have id, type, and label' }
    }
    if (!VALID_FIELD_TYPES.includes(field.type)) {
      return {
        valid: false,
        error: `Invalid field type: ${field.type}. Valid types: ${VALID_FIELD_TYPES.join(', ')}`,
      }
    }
    if (field.type === 'select' && (!Array.isArray(field.options) || field.options.length === 0)) {
      return { valid: false, error: `Select field "${field.label}" must have at least one option` }
    }
  }
  return { valid: true }
}

// GET /api/intake-forms — list forms
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    const { data: forms, error } = await supabase
      .from('intake_forms')
      .select(
        'id, name, description, fields, is_default, is_active, linked_service_ids, created_at, updated_at'
      )
      .eq('tenant_id', authed.tenantId)
      .order('created_at', { ascending: false })

    if (error) return res.status(500).json({ error: error.message })

    // Get submission counts per form
    const formIds = (forms || []).map((f) => f.id)
    let submissionCounts: Record<string, number> = {}
    if (formIds.length > 0) {
      const { data: counts } = await supabase
        .from('intake_submissions')
        .select('form_id')
        .eq('tenant_id', authed.tenantId)
        .in('form_id', formIds)

      submissionCounts = (counts || []).reduce(
        (acc: Record<string, number>, row: { form_id: string }) => {
          acc[row.form_id] = (acc[row.form_id] || 0) + 1
          return acc
        },
        {}
      )
    }

    const result = (forms || []).map((f) => ({
      ...f,
      fieldCount: Array.isArray(f.fields) ? f.fields.length : 0,
      submissionCount: submissionCounts[f.id] || 0,
    }))

    return res.json(result)
  } catch (err) {
    console.error('List intake forms error:', err)
    return res.status(500).json({ error: 'Failed to list forms' })
  }
})

// GET /api/intake-forms/:id — single form with submission count
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    const { data: form } = await supabase
      .from('intake_forms')
      .select(
        'id, name, description, fields, is_default, is_active, linked_service_ids, created_at, updated_at'
      )
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!form) return res.status(404).json({ error: 'Form not found' })

    const { count } = await supabase
      .from('intake_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('form_id', form.id)
      .eq('tenant_id', authed.tenantId)

    return res.json({ ...form, submissionCount: count || 0 })
  } catch (err) {
    console.error('Get intake form error:', err)
    return res.status(500).json({ error: 'Failed to get form' })
  }
})

// POST /api/intake-forms — create form
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const authed = req as AuthenticatedRequest
    const { name, description, fields, linkedServiceIds } = req.body

    if (!name) return res.status(400).json({ error: 'name is required' })

    const validation = validateFields(fields || [])
    if (!validation.valid) return res.status(400).json({ error: validation.error })

    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('intake_forms')
      .insert({
        tenant_id: authed.tenantId,
        name,
        description: description || null,
        fields: fields || [],
        linked_service_ids: linkedServiceIds || [],
      })
      .select(
        'id, name, description, fields, is_default, is_active, linked_service_ids, created_at, updated_at'
      )
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(201).json(data)
  } catch (err) {
    console.error('Create intake form error:', err)
    return res.status(500).json({ error: 'Failed to create form' })
  }
})

// PUT /api/intake-forms/:id — update form
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const { name, description, fields, linkedServiceIds, isActive } = req.body

    const { data: existing } = await supabase
      .from('intake_forms')
      .select('id')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!existing) return res.status(404).json({ error: 'Form not found' })

    if (fields !== undefined) {
      const validation = validateFields(fields)
      if (!validation.valid) return res.status(400).json({ error: validation.error })
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name !== undefined) updates['name'] = name
    if (description !== undefined) updates['description'] = description || null
    if (fields !== undefined) updates['fields'] = fields
    if (linkedServiceIds !== undefined) updates['linked_service_ids'] = linkedServiceIds
    if (isActive !== undefined) updates['is_active'] = Boolean(isActive)

    const { data, error } = await supabase
      .from('intake_forms')
      .update(updates)
      .eq('id', req.params['id'])
      .select(
        'id, name, description, fields, is_default, is_active, linked_service_ids, created_at, updated_at'
      )
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.json(data)
  } catch (err) {
    console.error('Update intake form error:', err)
    return res.status(500).json({ error: 'Failed to update form' })
  }
})

// DELETE /api/intake-forms/:id
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    // Check for existing submissions
    const { count } = await supabase
      .from('intake_submissions')
      .select('id', { count: 'exact', head: true })
      .eq('form_id', req.params['id'])
      .eq('tenant_id', authed.tenantId)

    if ((count || 0) > 0) {
      return res
        .status(400)
        .json({ error: 'Cannot delete form with existing submissions. Deactivate it instead.' })
    }

    const { error } = await supabase
      .from('intake_forms')
      .delete()
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)

    if (error) return res.status(500).json({ error: error.message })
    return res.json({ success: true })
  } catch (err) {
    console.error('Delete intake form error:', err)
    return res.status(500).json({ error: 'Failed to delete form' })
  }
})

// GET /api/intake-forms/:id/submissions — list submissions
router.get('/:id/submissions', requireAuth, async (req: Request, res: Response) => {
  try {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    const { data, error } = await supabase
      .from('intake_submissions')
      .select('id, data, submitted_at, contact_id, appointment_id')
      .eq('form_id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .order('submitted_at', { ascending: false })

    if (error) return res.status(500).json({ error: error.message })

    // Join contact names
    const contactIds = [...new Set((data || []).map((s) => s.contact_id).filter(Boolean))]
    let contactMap: Record<string, string> = {}
    if (contactIds.length > 0) {
      const { data: contacts } = await supabase
        .from('contacts')
        .select('id, full_name')
        .in('id', contactIds)
      contactMap = (contacts || []).reduce(
        (acc: Record<string, string>, c: { id: string; full_name: string }) => {
          acc[c.id] = c.full_name
          return acc
        },
        {}
      )
    }

    const result = (data || []).map((s) => ({
      ...s,
      contactName: s.contact_id ? contactMap[s.contact_id] || 'Unknown' : null,
    }))

    return res.json(result)
  } catch (err) {
    console.error('List submissions error:', err)
    return res.status(500).json({ error: 'Failed to list submissions' })
  }
})

export default router
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/routes/intake-forms.ts
git commit -m "feat(booking): add intake forms CRUD and submissions API"
```

---

## Task 6: Intake Forms Seed Script

**Files:**

- Create: `apps/api/src/scripts/seed-intake-forms.ts`

- [ ] **Step 1: Create seed-intake-forms.ts**

Create `apps/api/src/scripts/seed-intake-forms.ts` with default forms for dental, salon, contractor, restaurant, law_firm, real_estate, sales_crm. Each form has the appropriate fields for its vertical. Skip insert if form with same name exists. Usage: `npx tsx apps/api/src/scripts/seed-intake-forms.ts <tenant_id> [vertical]`.

The script should define a `FORMS` record keyed by vertical name, each containing `{ name, description, fields[] }` where fields follow the JSONB schema (id, type, label, required, placeholder?, options?).

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/scripts/seed-intake-forms.ts
git commit -m "feat(booking): add intake form seed script for all verticals"
```

---

## Task 7: Wire API Routes

**Files:**

- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Add imports and route mounts**

In `apps/api/src/index.ts`, add imports:

```typescript
import bookingPublicRouter from './routes/booking-public.js'
import bookingSettingsRouter from './routes/booking-settings.js'
import intakeFormsRouter from './routes/intake-forms.js'
```

Add route mounts after existing `app.use` lines:

```typescript
app.use('/api/book', bookingPublicRouter) // PUBLIC — no auth
app.use('/api/settings/booking', bookingSettingsRouter) // Authenticated
app.use('/api/intake-forms', intakeFormsRouter) // Authenticated
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(booking): wire booking and intake form routes into Express app"
```

---

## Task 8: Public Booking Page (Frontend)

**Files:**

- Create: `apps/web/src/app/book/[slug]/page.tsx`

This is the largest frontend task. The page lives OUTSIDE the `(dashboard)` route group — no sidebar, no auth required.

- [ ] **Step 1: Create the multi-step booking page**

Create `apps/web/src/app/book/[slug]/page.tsx` — a `'use client'` page with 4 steps:

1. **Service Selection** — cards with name, description, duration, price
2. **Date & Time** — custom calendar grid (no external library) + time slot buttons from availability API
3. **Contact Info + Intake Form** — required fields (first/last name, email, phone) + dynamic intake form fields
4. **Confirmation** — success message, booking summary, optional Google review link

Key implementation details:

- API URL: `process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001'`
- Use tenant's `accentColor` for primary buttons via inline style
- Mobile-first: full-width on small screens, centered max-w-2xl on desktop
- Custom calendar: simple grid of day buttons for the current month + next month navigation
- Disable past dates and dates beyond `advanceDays`
- Time slots: grid of clickable buttons showing HH:MM AM/PM format
- Intake form: dynamically render fields based on the `fields` JSONB array from the linked form
- Client-side validation of required fields before submit
- Loading states on all fetch operations
- Error handling with user-friendly messages

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/book/[slug]/page.tsx
git commit -m "feat(booking): add public booking page with multi-step flow"
```

---

## Task 9: Booking Settings Page (Frontend)

**Files:**

- Create: `apps/web/src/app/(dashboard)/settings/booking/page.tsx`

- [ ] **Step 1: Create booking settings page**

Create `apps/web/src/app/(dashboard)/settings/booking/page.tsx` — a `'use client'` page with:

- Enable/disable toggle for booking page
- Slug input with live URL preview and validation
- Service checkboxes (multi-select from tenant's services)
- Buffer minutes (number input, 5-60 range)
- Advance booking days (number input, 1-90 range)
- Confirmation message textarea
- Google Review URL input
- Accent color input (text for hex code)
- Preview button (opens booking page in new tab)
- Save button → PUT /api/settings/booking

Auth pattern: `useSession()` → `session?.accessToken`
API: `process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001'`
Styling: same Tailwind patterns as other settings pages (`px-8 py-8 max-w-2xl space-y-6`)

- [ ] **Step 2: Commit**

```bash
git add "apps/web/src/app/(dashboard)/settings/booking/page.tsx"
git commit -m "feat(booking): add booking settings page with slug config and service picker"
```

---

## Task 10: Intake Forms Builder Page (Frontend)

**Files:**

- Create: `apps/web/src/app/(dashboard)/settings/intake-forms/page.tsx`

- [ ] **Step 1: Create intake forms page with builder**

Create `apps/web/src/app/(dashboard)/settings/intake-forms/page.tsx` — a `'use client'` page with:

**List View:**

- Cards: form name, description, field count, submission count, linked services, active/inactive badge
- Create Form button

**Form Builder (modal or inline):**

- Name + description inputs
- "Add Field" button → dropdown of field types
- Each field as a card with: label input, type badge, required toggle, placeholder input, options editor (for select), move up/down arrows, delete button
- Link to Services section: checkboxes of tenant's services
- Save/Cancel

**Submissions Viewer (expandable or sub-view):**

- Table: submitted_at, contact name, field values
- CSV export button (client-side)

Auth, API, styling: same patterns as other settings pages.
Field reorder: use Move Up/Move Down arrow buttons — NO drag-and-drop.

- [ ] **Step 2: Commit**

```bash
git add "apps/web/src/app/(dashboard)/settings/intake-forms/page.tsx"
git commit -m "feat(booking): add intake forms builder with field editor and submissions viewer"
```

---

## Task 11: Sidebar Nav Updates

**Files:**

- Modify: `apps/web/src/app/(dashboard)/Sidebar.tsx`

- [ ] **Step 1: Add nav items**

In `apps/web/src/app/(dashboard)/Sidebar.tsx`, add two entries to the NAV array before the final `'/settings'` entry:

```typescript
{ href: '/settings/booking', label: 'Online Booking', icon: '📅', suiteOnly: true },
{ href: '/settings/intake-forms', label: 'Intake Forms', icon: '📋', suiteOnly: true },
```

- [ ] **Step 2: Commit**

```bash
git add "apps/web/src/app/(dashboard)/Sidebar.tsx"
git commit -m "feat(booking): add Online Booking and Intake Forms to sidebar nav"
```

---

## Task 12: Run Tests & Verify

- [ ] **Step 1: Run test suite**

```bash
cd /Users/sidyennamaneni/Documents/Nuatis/nuatis && npm test
```

Expected: 52/52 passing.

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd apps/api && npx tsc --noEmit
```

Fix any type errors.

- [ ] **Step 3: Report results**

```bash
git log --oneline -5
```

---

## Summary of All Route Registrations

| Route                                   | Auth        | File                |
| --------------------------------------- | ----------- | ------------------- |
| `GET /api/book/:slug`                   | **PUBLIC**  | booking-public.ts   |
| `GET /api/book/:slug/availability`      | **PUBLIC**  | booking-public.ts   |
| `POST /api/book/:slug/confirm`          | **PUBLIC**  | booking-public.ts   |
| `GET /api/settings/booking`             | requireAuth | booking-settings.ts |
| `PUT /api/settings/booking`             | requireAuth | booking-settings.ts |
| `GET /api/settings/booking/preview-url` | requireAuth | booking-settings.ts |
| `GET /api/intake-forms`                 | requireAuth | intake-forms.ts     |
| `GET /api/intake-forms/:id`             | requireAuth | intake-forms.ts     |
| `POST /api/intake-forms`                | requireAuth | intake-forms.ts     |
| `PUT /api/intake-forms/:id`             | requireAuth | intake-forms.ts     |
| `DELETE /api/intake-forms/:id`          | requireAuth | intake-forms.ts     |
| `GET /api/intake-forms/:id/submissions` | requireAuth | intake-forms.ts     |
