# Outlook Calendar + Compliance Fields + Territory Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Outlook Calendar integration alongside existing Google Calendar, vertical-specific compliance tracking fields, and territory management for contacts and locations.

**Architecture:** Calendar provider abstraction routes availability checks and event creation to Google or Outlook based on tenant.calendar_provider. Outlook tokens stored on tenants table (per-tenant), Google tokens remain on locations table. Compliance fields are a config-driven JSONB column on contacts with vertical-specific schemas. Territory is a simple text field on contacts + locations with auto-assignment and analytics.

**Tech Stack:** Express routes, Supabase PostgreSQL, Microsoft Graph API, Next.js 14 App Router, Tailwind v3, recharts.

**Key Codebase Facts:**

- Latest migration: `0039` → new is `0040`
- Google Calendar: credentials on locations table (google_refresh_token, google_calendar_id), OAuth in google-auth.ts
- booking-availability.ts: getTenantCalendarCredentials queries locations for primary location
- tool-handlers.ts: check_availability/book_appointment use getCalendarClient(refreshToken) directly
- Token encryption: encryptToken/decryptToken in email-oauth.ts (reusable)
- Outlook email OAuth: OUTLOOK_CLIENT_ID + OUTLOOK_CLIENT_SECRET already in .env
- No calendar_provider column on tenants yet, no calendar settings page exists
- Locations columns: name, address, city, state, zip, phone, telnyx_number, maya_enabled, is_primary, google_calendar_id, google_refresh_token
- Workers: 16 current
- Sidebar NAV: ~35 entries

---

## File Structure

### New Files — API

| File                                                        | Responsibility                                        |
| ----------------------------------------------------------- | ----------------------------------------------------- |
| `supabase/migrations/0040_outlook_compliance_territory.sql` | Calendar provider + compliance + territory columns    |
| `apps/api/src/lib/outlook-calendar.ts`                      | Outlook Calendar OAuth + availability + booking       |
| `apps/api/src/lib/calendar-provider.ts`                     | Unified calendar abstraction (Google or Outlook)      |
| `apps/api/src/routes/calendar-settings.ts`                  | Calendar connection settings + Outlook OAuth callback |

### New Files — Web

| File                                                      | Responsibility                  |
| --------------------------------------------------------- | ------------------------------- |
| `apps/web/src/app/(dashboard)/settings/calendar/page.tsx` | Calendar provider settings page |

### Modified Files

| File                                                                 | Change                                              |
| -------------------------------------------------------------------- | --------------------------------------------------- |
| `apps/api/src/lib/booking-availability.ts`                           | Use calendar-provider abstraction                   |
| `apps/api/src/routes/contacts.ts`                                    | Add compliance_fields + territory to CRUD + filters |
| `apps/api/src/routes/locations.ts`                                   | Add territory to CRUD                               |
| `apps/api/src/routes/insights.ts`                                    | Add territory analytics endpoint                    |
| `apps/api/src/index.ts`                                              | Mount calendar settings routes                      |
| `apps/web/src/app/(dashboard)/Sidebar.tsx`                           | Add Calendar nav item                               |
| `apps/web/src/app/(dashboard)/contacts/[id]/ContactDetailClient.tsx` | Add compliance section                              |
| `apps/web/src/components/contacts/ContactsList.tsx`                  | Add territory column + filter                       |
| `apps/web/src/app/(dashboard)/insights/InsightsDashboard.tsx`        | Add territory analytics section                     |

---

## Task 1: Database Migration

- Create `supabase/migrations/0040_outlook_compliance_territory.sql`
- Calendar provider + Outlook token columns on tenants
- compliance_fields JSONB on contacts
- territory TEXT on contacts + locations

## Task 2: Outlook Calendar Helper + Calendar Provider Abstraction

- Create `apps/api/src/lib/outlook-calendar.ts` — OAuth URL, token exchange/refresh, availability check via Graph API, event creation
- Create `apps/api/src/lib/calendar-provider.ts` — unified checkAvailability + bookAppointment that routes to Google or Outlook
- Update `apps/api/src/lib/booking-availability.ts` — use calendar-provider instead of direct Google calls

## Task 3: Calendar Settings API + Outlook OAuth

- Create `apps/api/src/routes/calendar-settings.ts` — GET status, Outlook auth URL, callback, disconnect

## Task 4: Contacts + Locations API (Compliance + Territory)

- Modify contacts.ts: add compliance_fields + territory to CRUD, compliance validation, territory filter
- Modify locations.ts: add territory to CRUD
- Add territory insights endpoint to insights.ts

## Task 5: Wire Routes

- Mount calendar-settings routes (callback is PUBLIC)
- Mount in index.ts

## Task 6: Calendar Settings Page (Frontend)

- Create settings/calendar/page.tsx — show provider status, connect Google/Outlook, disconnect

## Task 7: Compliance + Territory UI (Frontend)

- Contact detail: compliance section with field-type rendering
- Contact list: territory column + filter
- Insights: territory analytics section

## Task 8: Sidebar Nav

- Add Calendar, and any other missing nav items

## Task 9: Run Tests & Verify

---

## Summary of Route Registrations

| Route                                   | Auth        | File                                  |
| --------------------------------------- | ----------- | ------------------------------------- |
| `GET /api/settings/calendar`            | requireAuth | calendar-settings.ts                  |
| `GET /api/calendar/outlook/auth-url`    | requireAuth | calendar-settings.ts                  |
| `GET /api/calendar/outlook/callback`    | **PUBLIC**  | calendar-settings.ts                  |
| `DELETE /api/settings/calendar/outlook` | requireAuth | calendar-settings.ts                  |
| `GET /api/settings/compliance-fields`   | requireAuth | contacts.ts (or calendar-settings.ts) |
| `GET /api/insights/territory`           | requireAuth | insights.ts                           |
