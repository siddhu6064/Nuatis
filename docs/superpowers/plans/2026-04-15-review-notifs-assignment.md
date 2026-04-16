# Review Automation + Notification Prefs + User Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add automated Google review requests after appointments, tenant-configurable notification preferences (event × channel matrix), and user assignment on contacts/deals with team performance visibility.

**Architecture:** Review automation uses a BullMQ delayed job triggered when appointments complete, sending SMS with a tracking-linked Google review URL. A central `notifyOwner()` dispatcher checks tenant notification_prefs JSONB before routing to push/SMS/email. User assignment adds assigned_to_user_id on contacts and deals with a new users list endpoint for dropdown population.

**Tech Stack:** Express routes, Supabase PostgreSQL, BullMQ workers, Next.js 14 App Router, Tailwind v3.

**Key Codebase Facts:**

- Latest migration: `0036_lifecycle_and_scoring.sql` → new migration is `0037`
- Workers: 14 current, factory pattern in workers/index.ts
- Appointment status update: PATCH /api/appointments/:id, statuses: scheduled/confirmed/completed/no_show/canceled/rescheduled
- sendPushNotification(tenantId, { title, body, url? }) — used in ~15 places across routes/workers
- sendSms(from, to, text, { tenantId, contactId }) — currently only sends to customers, not owners
- No GET /api/users endpoint exists yet — need to create one
- Contacts PUT accepts: full_name, phone, email, notes, tags, pipeline_stage, is_archived, referred_by/referral_source — no assigned_to_user_id yet
- Deals table: no assigned_to_user_id column yet
- Users table: id, tenant_id, email, full_name, role, avatar_url, is_active
- Google review URL already on tenants: `booking_google_review_url` (from Wks 69-70)
- Sidebar NAV: 27 entries, last entry is '/settings'

---

## File Structure

### New Files — API

| File                                                    | Responsibility                                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `supabase/migrations/0037_review_notifs_assignment.sql` | Review automation columns, notification_prefs, assignment columns, review_requests table |
| `apps/api/src/lib/notifications.ts`                     | Central notifyOwner() dispatcher                                                         |
| `apps/api/src/workers/review-request-worker.ts`         | Review request BullMQ worker                                                             |
| `apps/api/src/routes/review-settings.ts`                | Review automation settings + tracking                                                    |
| `apps/api/src/routes/notification-settings.ts`          | Notification prefs CRUD                                                                  |
| `apps/api/src/routes/users.ts`                          | Users list endpoint                                                                      |
| `apps/api/src/scripts/seed-saved-views.ts`              | Seed "Assigned to Me" saved view                                                         |

### New Files — Web

| File                                                           | Responsibility             |
| -------------------------------------------------------------- | -------------------------- |
| `apps/web/src/app/(dashboard)/settings/automation/page.tsx`    | Review automation settings |
| `apps/web/src/app/(dashboard)/settings/notifications/page.tsx` | Notification prefs matrix  |

### Modified Files

| File                                                                 | Change                                               |
| -------------------------------------------------------------------- | ---------------------------------------------------- |
| `apps/api/src/routes/appointments.ts`                                | Wire review request trigger on completed             |
| `apps/api/src/routes/contacts.ts`                                    | Add assigned_to_user_id to CRUD, filter, bulk assign |
| `apps/api/src/routes/deals.ts`                                       | Add assigned_to_user_id to CRUD                      |
| `apps/api/src/workers/index.ts`                                      | Register review-request worker                       |
| `apps/api/src/index.ts`                                              | Mount new routes                                     |
| `apps/web/src/app/(dashboard)/Sidebar.tsx`                           | Add nav items                                        |
| `apps/web/src/app/(dashboard)/contacts/[id]/ContactDetailClient.tsx` | Add assignee dropdown                                |
| `apps/web/src/components/contacts/ContactsList.tsx`                  | Add assigned column + filter                         |

---

## Task 1: Database Migration

**Files:**

- Create: `supabase/migrations/0037_review_notifs_assignment.sql`

- [ ] **Step 1: Create migration**

```sql
-- Review automation on tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS review_automation_enabled BOOLEAN DEFAULT false;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS review_delay_minutes INTEGER DEFAULT 120;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS review_message_template TEXT DEFAULT 'Thanks {{first_name}}! We''d love a quick Google review: {{review_url}}';

-- Notification preferences (event × channel matrix)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS notification_prefs JSONB DEFAULT '{
  "new_contact": {"push": true, "sms": false, "email": false},
  "appointment_booked": {"push": true, "sms": true, "email": false},
  "appointment_completed": {"push": true, "sms": false, "email": false},
  "quote_viewed": {"push": true, "sms": false, "email": false},
  "quote_accepted": {"push": true, "sms": true, "email": false},
  "deposit_paid": {"push": true, "sms": true, "email": false},
  "new_sms": {"push": true, "sms": false, "email": false},
  "task_due": {"push": true, "sms": false, "email": false},
  "review_sent": {"push": true, "sms": false, "email": false},
  "form_submitted": {"push": true, "sms": false, "email": false},
  "low_lead_score": {"push": true, "sms": false, "email": false},
  "contact_assigned": {"push": true, "sms": false, "email": false}
}'::jsonb;

-- User assignment
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES users(id);
ALTER TABLE deals ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_contacts_assigned ON contacts(tenant_id, assigned_to_user_id);
CREATE INDEX IF NOT EXISTS idx_deals_assigned ON deals(tenant_id, assigned_to_user_id);

-- Review request tracking
CREATE TABLE review_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  contact_id UUID NOT NULL REFERENCES contacts(id),
  appointment_id UUID REFERENCES appointments(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'clicked', 'reviewed')),
  sent_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE review_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON review_requests
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE authjs_user_id = auth.uid()));
CREATE INDEX idx_review_requests_tenant ON review_requests(tenant_id);
CREATE INDEX idx_review_requests_contact ON review_requests(contact_id);
```

- [ ] **Step 2: Commit**

---

## Task 2: Central Notification Dispatcher

**Files:**

- Create: `apps/api/src/lib/notifications.ts`

- [ ] **Step 1: Create notifications.ts**

Central helper that checks tenant prefs before sending:

```typescript
export async function notifyOwner(
  tenantId: string,
  eventType: string,
  payload: { pushTitle?: string; pushBody?: string; pushUrl?: string; smsBody?: string }
): Promise<void>
```

- Fetch tenant.notification_prefs from DB
- If prefs is null/undefined: default to push=true for all events (backwards compat)
- Check prefs[eventType] for each channel:
  - push=true → call sendPushNotification(tenantId, { title, body, url })
  - sms=true → fetch owner user (role='owner') for tenant, get their phone from users table, call sendSms() to owner
- Fire-and-forget, never throw — log errors

Imports: `sendPushNotification` from `./push-client.js`, `sendSms` from `./sms.js`

- [ ] **Step 2: Commit**

---

## Task 3: Review Request Worker + Tracking

**Files:**

- Create: `apps/api/src/workers/review-request-worker.ts`
- Create: `apps/api/src/routes/review-settings.ts`

- [ ] **Step 1: Create review-request-worker.ts**

Queue: 'review-request'
Job data: { tenantId, contactId, appointmentId }
Processing:

1. Fetch tenant (review_automation_enabled, review_message_template, booking_google_review_url)
2. If not enabled or no google_review_url: skip
3. Check review_requests for existing sent record for this appointment — prevent duplicates
4. Fetch contact (first_name, last_name, phone)
5. If no phone: skip
6. INSERT review_requests (status='pending')
7. Build tracking URL: `{API_URL}/api/review-tracking/{reviewRequestId}`
8. Resolve template: replace {{first_name}}, {{last_name}}, {{business_name}}, {{review_url}} (review_url → tracking URL)
9. Fetch tenant's telnyx_number from primary location
10. sendSms(telnyxNumber, contact.phone, resolvedMessage, { tenantId, contactId })
11. UPDATE review_requests SET status='sent', sent_at=now()
12. logActivity: type='system', body='Review request SMS sent'
13. notifyOwner(tenantId, 'review_sent', { pushTitle: 'Review Request Sent', pushBody: `Sent to ${contact.first_name}` })

Factory: `createReviewRequestWorker()` → `{ queue, worker }`

- [ ] **Step 2: Create review-settings.ts** — settings API + tracking

Routes (all requireAuth except tracking):

- GET /api/settings/review-automation — return { enabled, delayMinutes, messageTemplate, googleReviewUrl }
- PUT /api/settings/review-automation — update settings, validate delayMinutes 15-1440, validate template contains {{review_url}}
- GET /api/settings/review-automation/stats — return { totalSent, totalClicked, clickRate, last30Days: { sent, clicked } }

Public route (NO auth):

- GET /api/review-tracking/:id — look up review_requests, UPDATE clicked_at + status='clicked', logActivity, redirect 302 to google review URL. If not found: redirect to nuatis.com.

- [ ] **Step 3: Commit**

---

## Task 4: Wire Review Trigger + Register Worker

**Files:**

- Modify: `apps/api/src/routes/appointments.ts`
- Modify: `apps/api/src/workers/index.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Wire review trigger on appointment completed**

In appointments.ts PATCH handler, after status changes to 'completed':

```typescript
// After the existing completed activity log
const { data: tenantData } = await supabase
  .from('tenants')
  .select('review_automation_enabled, review_delay_minutes')
  .eq('id', authed.tenantId)
  .single()
if (tenantData?.review_automation_enabled) {
  await reviewRequestQueue.add(
    'send-review',
    { tenantId: authed.tenantId, contactId: appointment.contact_id, appointmentId: appointment.id },
    { delay: (tenantData.review_delay_minutes || 120) * 60 * 1000 }
  )
}
```

- [ ] **Step 2: Register worker in workers/index.ts**

- [ ] **Step 3: Mount routes in index.ts**

```typescript
import reviewSettingsRouter from './routes/review-settings.js'
app.use('/api/settings/review-automation', reviewSettingsRouter)
app.use('/api/review-tracking', reviewTrackingRouter) // public
```

- [ ] **Step 4: Commit**

---

## Task 5: Notification Settings API + Frontend

**Files:**

- Create: `apps/api/src/routes/notification-settings.ts`
- Create: `apps/web/src/app/(dashboard)/settings/notifications/page.tsx`

- [ ] **Step 1: Create notification-settings.ts**

- GET /api/settings/notifications — return tenant.notification_prefs
- PUT /api/settings/notifications — validate shape, UPDATE tenant

- [ ] **Step 2: Create notifications settings page**

Event × Channel matrix table with toggle switches. Events: New Contact, Appointment Booked, Appointment Completed, Quote Viewed, Quote Accepted, Deposit Paid, New SMS, Task Due, Review Sent, Form Submitted, Lead Score Alert, Contact Assigned. Channels: Push, SMS, Email (with notes). Save + Reset buttons.

- [ ] **Step 3: Commit**

---

## Task 6: Users List Endpoint + User Assignment API

**Files:**

- Create: `apps/api/src/routes/users.ts`
- Modify: `apps/api/src/routes/contacts.ts`
- Modify: `apps/api/src/routes/deals.ts`

- [ ] **Step 1: Create users.ts** — tenant users list

GET /api/users — return users for current tenant: id, full_name, email, role, avatar_url, is_active. Filter to is_active=true. requireAuth.

- [ ] **Step 2: Modify contacts.ts** — add assignment

- Add assigned_to_user_id to SELECT in GET /
- Add assigned_to_user_id acceptance in PUT /:id, with logActivity type='system' body='Assigned to {name}'
- Add ?assigned_to query param filter (accepts 'me' or a userId)
- Add PATCH /bulk/assign: { contactIds, assignedToUserId } — bulk update + notify assignee
- Join users table to include assigned_user_name in response

- [ ] **Step 3: Modify deals.ts** — add assignment

Same pattern: accept assigned_to_user_id on PUT, add to SELECT, add ?assigned_to filter.

- [ ] **Step 4: Commit**

---

## Task 7: Review Automation Settings Page (Frontend)

**Files:**

- Create: `apps/web/src/app/(dashboard)/settings/automation/page.tsx`

- [ ] **Step 1: Create automation settings page**

- Enable/disable toggle
- Delay dropdown (30 min, 1 hour, 2 hours, 4 hours, Next day)
- Message template textarea with merge tag buttons ({{first_name}}, {{last_name}}, {{business_name}}, {{review_url}})
- Warning if {{review_url}} missing from template
- Google Review URL input
- Stats: X sent · Y clicked (Z% rate) — last 30 days
- Save button

- [ ] **Step 2: Commit**

---

## Task 8: User Assignment UI (Frontend)

**Files:**

- Modify: `apps/web/src/app/(dashboard)/contacts/[id]/ContactDetailClient.tsx`
- Modify: `apps/web/src/components/contacts/ContactsList.tsx`

- [ ] **Step 1: Add assignee dropdown to contact detail**

- Fetch GET /api/users for tenant users list
- "Assigned To" dropdown showing user names + "Unassigned"
- On change: PUT /api/contacts/:id with assigned_to_user_id
- Show current assignee with avatar/initials

- [ ] **Step 2: Add assigned column + filter to contact list**

- New "Assigned" column showing assignee name or "—"
- Assigned To filter: dropdown with tenant users + "Unassigned"

- [ ] **Step 3: Commit**

---

## Task 9: Sidebar Nav + Wire Routes

**Files:**

- Modify: `apps/web/src/app/(dashboard)/Sidebar.tsx`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Add nav items**

Add before '/settings':

```typescript
{ href: '/settings/automation', label: 'Automation', icon: '⚡', suiteOnly: true },
{ href: '/settings/notifications', label: 'Notifications', icon: '🔔', suiteOnly: true },
```

Wait — 'Automation' at /settings/automation already exists at /automation in the nav (line ~56). Let me check... The existing '/automation' is a CRM feature page, not settings. The new one is a settings sub-page. Use a different label to avoid confusion:

```typescript
{ href: '/settings/automation', label: 'Review Auto', icon: '⭐', suiteOnly: true },
{ href: '/settings/notifications', label: 'Notifications', icon: '🔔', suiteOnly: true },
```

- [ ] **Step 2: Mount remaining routes in index.ts**

```typescript
import notificationSettingsRouter from './routes/notification-settings.js'
import usersRouter from './routes/users.js'
app.use('/api/settings/notifications', notificationSettingsRouter)
app.use('/api/users', usersRouter)
```

- [ ] **Step 3: Commit**

---

## Task 10: Run Tests & Verify

- [ ] **Step 1: Run tests**

```bash
npm test
```

Expected: 52/52 passing.

- [ ] **Step 2: Report**

```bash
git log --oneline -3
```

---

## Summary of All Route Registrations

| Route                                       | Auth        | File                     |
| ------------------------------------------- | ----------- | ------------------------ |
| `GET /api/settings/review-automation`       | requireAuth | review-settings.ts       |
| `PUT /api/settings/review-automation`       | requireAuth | review-settings.ts       |
| `GET /api/settings/review-automation/stats` | requireAuth | review-settings.ts       |
| `GET /api/review-tracking/:id`              | **PUBLIC**  | review-settings.ts       |
| `GET /api/settings/notifications`           | requireAuth | notification-settings.ts |
| `PUT /api/settings/notifications`           | requireAuth | notification-settings.ts |
| `GET /api/users`                            | requireAuth | users.ts                 |
| `PATCH /api/contacts/bulk/assign`           | requireAuth | contacts.ts              |
