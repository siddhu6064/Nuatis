# Nuatis Suite

AI-powered front-office SaaS for SMBs. Voice AI receptionist (Maya) + vertical-aware CRM + automated scheduling + lead pipeline + follow-up automation + CPQ + insights. Web + mobile, one codebase, 16 verticals.

> Built by [Sid Yennamaneni](https://github.com/siddhu6064) | Phases 1–8 + 10 + 11 + Maya Standalone (P6) complete | 461 tests on main · 464 on p12-spa · 66 suites · CI green

## Architecture

| Layer      | Technology                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------- |
| Frontend   | Next.js 14 App Router, Tailwind v3, Vercel (port 3000)                                      |
| Mobile     | React Native + Expo (Expo Router, NativeWind, Expo Push APNS/FCM, expo-sqlite, SecureStore) |
| API        | Express ESM TypeScript, port 3001 (NodeNext, explicit `.js` imports)                        |
| Auth       | Auth.js v5 (NextAuth) for customer tenants; Clerk for demo tenant only                      |
| Database   | Supabase PostgreSQL + RLS, pgvector for RAG (54 tables, migrations 0001–0057)               |
| Voice AI   | Gemini 2.0 Flash Live (unified STT/LLM/TTS, ~$0.008/call)                                   |
| Telephony  | Telnyx (PSTN, SIP, SMS — Texas area codes)                                                  |
| Calendar   | Native (default) + Google Calendar + Microsoft 365 (Graph API)                              |
| Email      | Resend (transactional) + Gmail OAuth2 + Microsoft Graph (user mailbox sync)                 |
| Queue      | BullMQ + Upstash Redis (17 workers)                                                         |
| Push       | Web Push (VAPID) + Expo Push                                                                |
| Monitoring | Sentry, audit_log table, weekly data retention worker                                       |
| Ops        | Nuatis-Ops-Copilot (Python sidecar, 5 detectors)                                            |
| CI/CD      | GitHub Actions (Node 24)                                                                    |
| Deploy     | Vercel (web), Azure Container Apps (api/voice — southcentralus, scripts ready)              |

## Monorepo Structure

```
apps/
  web/          Next.js 14 dashboard (Vercel)
  api/          Express API + voice pipeline + BullMQ workers
  mobile/       React Native + Expo (iOS/Android)
packages/
  shared/       VERTICALS config, types, seed helpers, shared utilities
infra/
  azure/        Deployment scripts (deploy.sh, update-env.sh, custom-domain.sh)
  cloudflare/   Cloudflare Tunnel config (local dev tunnel)
supabase/
  migrations/   57 migration files (0001–0057)
```

## Modules

### Maya — Voice AI Receptionist

- Gemini 2.0 Flash Live over Telnyx WebSocket (8kHz PCMU ↔ 24kHz PCM16), <1.5s first-response latency
- **7 tool calls**: `get_business_hours`, `lookup_contact`, `check_availability`, `book_appointment`, `reschedule_appointment`, `end_call`, `escalate_to_human`
- Multilingual: English, Spanish, Hindi, Telugu (auto-detect, no announcement)
- Three-way calendar branching: native / Google / Microsoft 365 — resolved per call from `tenant.calendar_provider` → `location.google_refresh_token` → fallback `native`
- Post-call automation (in `post-call.ts`): contact upsert → TCPA opt-in grant → SMS confirmation → email confirmation (Gmail/Outlook/Resend) → Ops-Copilot webhook → voice session persistence → auto-quote draft
- Echo suppression, VAD with interruptions, silence fallback hangup, farewell detection
- Knowledge-base RAG injection into system prompt (pgvector embeddings per vertical)
- **Maya Standalone**: voice-only product variant — same codebase, `tenant.product = 'maya_only'`, no CRM UI

### CRM

- Contacts with vertical-specific custom fields (16 vertical schemas)
- Activity timeline, notes, tasks, deals, companies
- CSV import + dedupe
- Global Cmd+K search across contacts, deals, companies, appointments
- Lead scoring
- **Inventory management** (default ON under `modules.crm`)
- **Staff scheduling** (default ON under `modules.crm`)
- Pipeline (Kanban) with multi-pipeline support and per-vertical stages
- Stage probability + revenue forecasting

### Scheduling

- **Native calendar is the default** — every tenant gets working booking with no integration required
- `appointments` table is always source of truth; `google_event_id` nullable
- Native busy periods: `status IN ('scheduled', 'completed')` only — `no_show` and `canceled` are free
- Google Calendar + Microsoft 365 are optional sync layers
- Booking via call (Maya), SMS, or public booking page
- `booking_buffer_minutes` + `booking_advance_days` respected in native path
- Web calendar grid: `react-big-calendar` (week/month/day/agenda, drag-to-create, status color-coding, staff filter)
- Mobile calendar: `react-native-calendars` (mini month picker + day agenda + push refetch on `new_booking`)

### Revenue Ops

- Follow-up cadence: 3-step per vertical (SMS day 1, email day 3, SMS day 7) with template interpolation
- Appointment reminders: 24h + 1h SMS via Telnyx
- No-show scanner: auto-marks no-show, rebook SMS, push notification
- Lead-stalled scanner: 7-day inactivity detection
- Follow-up missed scanner: 2–7 day gap detection
- Webhook dispatcher: tenant-scoped HMAC-signed delivery to Zapier/Make
- Ops-Copilot retry queue: exponential backoff (30s/60s/120s)

### Insights

- Call analytics: volume trends, outcome breakdown, peak hours, language distribution (recharts)
- Pipeline funnel with conversion rates
- ROI dashboard: Maya cost vs receptionist cost, savings, ROI multiplier
- Revenue forecast based on booking trends and per-vertical appointment values
- CPQ metrics: win rate, deal size, revenue won, quote funnel, AI quote performance
- **Custom report builder** with pin-to-dashboard
- **Stock health panel** (inventory)
- **Team schedule panel** (staff)

### CPQ (Configure-Price-Quote)

> Default **OFF** for every new tenant. Add-on, gated by `modules.cpq`.

- Service catalog: per-vertical pricing
- Quote builder: line items from catalog or custom, auto-calculated totals with tax
- PDF generation (pdfkit): branded professional quotes
- Quote delivery: SMS + email with PDF attachment
- Public quote view: shareable link, no auth, accept/decline buttons
- Auto-quote generation: Maya creates draft quotes from booking calls
- Quote expiry worker: auto-expires past `valid_until`

### Automation

- 17 BullMQ workers covering: lead-stalled, no-show, follow-up-missed, webhook-retry, appointment-reminder, follow-up-cadence, data-retention, quote-expiry, on-demand retry, and more
- `SCANNERS_ENABLED` env var to disable in dev
- Graceful SIGTERM shutdown

### Platform

- PWA: manifest.json, service worker, installable on iOS/Android
- Push notifications: Web Push (VAPID) for web, Expo Push (APNS/FCM) for mobile — new calls, bookings, escalations, no-shows, follow-ups
- Audit logging: SOC 2 prep, mutating API operations logged with IP/user-agent
- RBAC schema: `tenant_users` table with owner/admin/member roles
- Data retention: weekly cleanup (audit 365d, sessions 180d, push 90d)
- Security headers: HSTS, X-Frame-Options, CSP, Referrer-Policy
- Onboarding wizard: 6-step (business info, phone provisioning, calendar, hours, test Maya, done)
- Demo vertical switcher: live industry switching for sales demos
- Self-serve auth: sign-up, sign-in, forgot-password, reset-password
- Mobile: biometric unlock, offline cache (expo-sqlite), SecureStore auth

## Verticals

**Live (9):** dental, medical, veterinary, salon, restaurant, contractor, law_firm, real_estate, sales_crm

**P12 config-first (7):**

- ✅ spa (complete on demo tenant)
- ✅ gym (complete on demo tenant)
- ⏳ nail_bar, pet_grooming, tattoo, car_wash, laundry (pending)

**HIPAA-gated (deferred until HIPAA hardening):** physical_therapy, optometry

| Vertical    | Custom Fields                              | Pipeline Stages                                                 | Business Hours                    |
| ----------- | ------------------------------------------ | --------------------------------------------------------------- | --------------------------------- |
| dental      | insurance, recall interval, treatment plan | New inquiry → Consultation → Treatment → Active → Recall        | Mon-Fri 8am-5pm, Sat 9am-1pm      |
| medical     | insurance, condition, referring physician  | New patient → Intake → Active → Follow-up → Discharged          | Mon-Fri 8am-5pm                   |
| veterinary  | pet name, species, vaccination status      | New client → Intake → Active care → Recall → Lapsed             | Mon-Fri 8am-6pm, Sat 9am-2pm      |
| salon       | stylist, hair type, color formula          | New client → First booked → Returning → VIP → Lapsed            | Mon-Fri 9am-7pm, Sat 9am-5pm      |
| restaurant  | party size, dietary, seating               | New guest → Returning → Regular → VIP                           | Mon-Fri 11am-10pm, Sat-Sun varies |
| contractor  | property type, estimate status, warranty   | New lead → Estimate sent → Accepted → Scheduled → Completed     | Mon-Fri 7am-5pm, Sat 8am-12pm     |
| law_firm    | case type, retainer, jurisdiction          | New inquiry → Conflict check → Consultation → Retained → Active | Mon-Fri 9am-5pm                   |
| real_estate | buyer/seller, budget, pre-approval         | New lead → Qualified → Showing → Offer → Under contract         | Mon-Fri 9am-6pm, Sat 10am-4pm     |
| sales_crm   | company, demo status, vertical interest    | Prospect → Demo scheduled → Demo done → Pilot → Paying          | Mon-Fri 9am-6pm                   |
| spa         | service preference, allergies, membership  | New client → First booked → Returning → VIP → Lapsed            | Mon-Sun 9am-8pm                   |
| gym         | membership tier, fitness goal, trainer     | Trial → Member → Active → At-risk → Churned                     | Mon-Sun 5am-11pm                  |

## Architecture Decisions (Locked)

### Calendar (April 2026)

- Native calendar is the default. Every tenant gets working booking with no integration required.
- `appointments` table is always source of truth.
- Provider resolution: `tenant.calendar_provider` → `location.google_refresh_token` → fallback `'native'`.

### SMS + Email Confirmation (April 2026)

- Both fire from `post-call.ts`, not `tool-handlers.ts`.
- Wrapped in try/catch — never block booking or each other.
- **SMS**: gate = `bookedAppointment && callerId`. Vertical-aware via `buildConfirmationSms()`. Tenant timezone from DB. `maya_only` gets generic SMS.
- **Email**: gate = `bookedAppointment && appointmentId && !maya_only && contactId && contact.email`. Gmail/Outlook/Resend routing. Tracking pixel injected after `email_messages` row insert.

### TCPA SMS Consent (April 2026)

- `contacts.sms_opt_in` boolean NOT NULL DEFAULT false (migration 0055).
- `apps/api/src/lib/tcpa.ts` exports `checkTcpaOptIn(contactId, tenantId)` and `grantTcpaOptIn(contactId, tenantId)`.
- `sendSms()` gates on `sms_opt_in` when `options.contactId + options.tenantId` are provided. System messages without contactId bypass the gate.
- `post-call.ts` calls `grantTcpaOptIn()` after Maya books — verbal/transactional consent.
- CSV-imported contacts default to `false` — never silently send to imported lists.

### Module Gating

- Lives in `tenants.modules` jsonb.
- Internal + both demo tenants forced all-ON.
- CPQ defaults OFF for every new tenant.
- Inventory + Staff are default-ON sub-features under `modules.crm`. API filters by vertical from DB (not JWT).

### Tier Structure

- Maya Standalone → Starter → Pro. CPQ add-on. Memberships add-on (future).
- **Starter**: maya, crm, appointments, inventory, staff
- **Pro**: everything in Starter + pipeline, automation, insights, companies, deals
- Public pricing not yet set.

### Maya Standalone

- Same codebase, `tenant.product = 'maya_only' | 'suite'`.
- Voice-only product, no CRM UI, generic SMS confirmation, email skipped.

### Tech Choices (don't re-litigate)

- Gemini 2.0 Flash Live over Deepgram + ElevenLabs + Claude: 16x cheaper, native multilingual, <1.5s latency.
- Auth.js over Clerk: Clerk per-org pricing breaks B2B unit economics.
- Supabase RLS: multi-tenancy at the DB layer, not the app layer.
- Tailwind v3 (v4 had monorepo breakage); NativeWind on mobile mirrors web tokens.

## Compliance

- **HIPAA (BAA required)**: dental, medical — 6-yr retention, 60-day breach notification
- **State regulated**: veterinary (TX ITEA, 30-day deletion), real_estate (FHA, TREC)
- **Privileged**: law_firm (ABA 1.6/1.1)
- **TCPA**: salon, restaurant, contractor, spa, gym, nail_bar, tattoo, car_wash, laundry, pet_grooming
- **HIPAA-gated (deferred)**: physical_therapy, optometry
- **SOC 2 Type I**: in progress

## Getting Started

```bash
# Clone
git clone https://github.com/siddhu6064/Nuatis.git
cd Nuatis

# Install dependencies
npm install

# Copy env file and fill in values
cp apps/api/.env.example apps/api/.env

# Run migrations (paste each file into Supabase SQL editor, or use Supabase CLI)
ls supabase/migrations/

# Start development
npm run dev        # starts web:3000 + api:3001

# Run tests (from apps/api)
NODE_OPTIONS=--experimental-vm-modules npx jest
# 461 tests on main, 66 suites — live-infra suites excluded (see jest.config.ts)
```

### Mobile

```bash
cd apps/mobile
npx expo start
# Expo project ID: 12d55e0d-0ffe-430c-97cc-305bae7645d6 (@nuatis/nuatis-crm)
```

### Local Voice (Telnyx tunnel)

```bash
cloudflared tunnel --credentials-file ~/.cloudflared/<tunnel-id>.json run nuatis-voice
# api.nuatis.com → localhost:3001
# voice.nuatis.com → localhost:3001/voice/stream
```

## Environment Variables

See `apps/api/.env.example` for the full list. Key vars:

| Variable                       | Description                                         |
| ------------------------------ | --------------------------------------------------- |
| SUPABASE_URL                   | Supabase project URL                                |
| SUPABASE_SERVICE_ROLE_KEY      | Supabase service role key                           |
| GEMINI_API_KEY                 | Google Gemini API key                               |
| TELNYX_API_KEY                 | Telnyx API key for voice + SMS                      |
| TELNYX_TENANT_MAP              | Phone-to-tenant mapping                             |
| REDIS_URL                      | Upstash Redis connection string                     |
| GOOGLE_CLIENT_ID / SECRET      | Google Calendar OAuth2                              |
| MS_CLIENT_ID / SECRET          | Microsoft 365 (Graph API)                           |
| RESEND_API_KEY                 | Resend email API key                                |
| SENTRY_DSN                     | Sentry error monitoring DSN                         |
| VAPID_PUBLIC_KEY / PRIVATE_KEY | Web Push VAPID keys                                 |
| ADMIN_API_KEY                  | Admin stats endpoint key                            |
| VOICE_WS_URL                   | Production WebSocket URL for Telnyx                 |
| OPS_COPILOT_URL                | Ops-Copilot sidecar URL (set after Azure deploy)    |
| NEXT_PUBLIC_APP_URL            | Web app base URL                                    |
| NEXT_PUBLIC_SUPABASE_URL       | Supabase URL (browser, used by reset-password page) |
| NEXT_PUBLIC_SUPABASE_ANON_KEY  | Supabase anon key (browser)                         |
| AUTH_SECRET                    | Auth.js v5 JWT signing secret                       |
| SCANNERS_ENABLED               | Toggle BullMQ workers in dev                        |

## Deployment

- **Web**: Vercel (auto-deploys from `main`)
- **API + Voice**: Azure Container Apps (`infra/azure/`, southcentralus, ~$27–40/mo, $5K credits exp Dec 2026) — scripts ready, deploy pending
- **Local tunnel**: Cloudflare Tunnel (`infra/cloudflare/cloudflared.yml`)

## Roadmap

- ✅ P1–P8, P10, P11, Maya Standalone (P6)
- 🔄 P12: 5 remaining verticals (nail_bar, pet_grooming, tattoo, car_wash, laundry)
- ⏳ P5: 49-item manual test backlog → fix all P0/P1 → Azure + Vercel deploy
- ⏳ P9: Stripe billing (after pricing decisions)
- ⏳ P13: AI Campaigns (CRM segments → AI copy → scheduled SMS/email/social → tracking; migrations start at 0058; depends on P9)

## Related Repos

- [Nuatis-Ops-Copilot](https://github.com/siddhu6064/Nuatis-Ops-Copilot) — Python alerting sidecar with 5 detectors (booking failure, call failure, no-show, lead stalled, follow-up missed)
