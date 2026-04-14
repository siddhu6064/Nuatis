# Nuatis CRM

AI-powered front-office SaaS for SMBs. Voice AI receptionist (Maya) + vertical-aware CRM + automated scheduling + lead pipeline + follow-up automation + CPQ.

## Architecture

| Layer      | Technology                                                |
| ---------- | --------------------------------------------------------- |
| Frontend   | Next.js 14 App Router, Tailwind v3, Vercel                |
| API        | Express ESM TypeScript, port 3001                         |
| Auth       | Auth.js v5 (NextAuth) + Clerk (demo tenant)               |
| Database   | Supabase PostgreSQL + RLS                                 |
| Voice AI   | Gemini 2.0 Flash Live (unified STT/LLM/TTS, ~$0.008/call) |
| Telephony  | Telnyx (PSTN, SIP, SMS)                                   |
| Queue      | BullMQ + Upstash Redis (9 managed workers)                |
| Email      | Resend                                                    |
| Push       | Web Push (VAPID)                                          |
| Monitoring | Sentry                                                    |
| Ops        | Nuatis-Ops-Copilot (Python sidecar, 5 detectors)          |
| Infra      | Docker, Azure Container Apps (southcentralus)             |

## Monorepo Structure

```
apps/
  web/          Next.js 14 dashboard (Vercel)
  api/          Express API + voice pipeline + BullMQ workers
packages/
  shared/       Vertical configs, types, shared utilities
infra/
  azure/        Deployment scripts (deploy.sh, update-env.sh, custom-domain.sh)
  cloudflare/   Cloudflare Tunnel config (ngrok alternative)
supabase/
  migrations/   12 migration files (0001-0012)
```

## Modules

### Maya Voice AI

- Gemini 2.0 Flash Live over Telnyx WebSocket (8kHz PCMU <-> 24kHz PCM16)
- 6 tool calls: get_business_hours, lookup_contact, check_availability, book_appointment, escalate_to_human, end_call
- Multilingual: English, Spanish, Hindi, Telugu (auto-detect, no announcement)
- Post-call automation: contact upsert, SMS confirmation, Ops-Copilot webhook, voice session persistence, auto-quote generation
- Echo suppression, VAD with interruptions, silence fallback hangup, farewell detection
- Knowledge base RAG injection into system prompt

### CRM

- Contacts with vertical-specific custom fields (dental: insurance, recall interval; salon: stylist preference, color formula; etc.)
- Pipeline (Kanban) with per-vertical stages
- Appointments with Google Calendar sync (OAuth2, FreeBusy)
- Call log with outcome badges, tool call timeline, MOS score, latency metrics

### Revenue Ops

- Follow-up cadence: 3-step per vertical (SMS day 1, email day 3, SMS day 7) with template interpolation
- Appointment reminders: 24h + 1h SMS via Telnyx
- No-show scanner: auto-marks no-show, rebook SMS, push notification
- Lead stalled scanner: 7-day inactivity detection
- Follow-up missed scanner: 2-7 day gap detection
- Webhook dispatcher: tenant-scoped HMAC-signed delivery to Zapier/Make
- Ops-Copilot retry queue: exponential backoff (30s/60s/120s)

### Insights

- Call analytics: volume trends, outcome breakdown, peak hours, language distribution (recharts)
- Pipeline funnel with conversion rates
- ROI dashboard: Maya cost vs receptionist cost, savings, ROI multiplier
- Revenue forecast based on booking trends and vertical appointment values
- CPQ metrics: win rate, deal size, revenue won, quote funnel, AI quote performance

### CPQ (Configure-Price-Quote)

- Service catalog: per-vertical pricing (dental $75-$1200, contractor $0-$15000, etc.)
- Quote builder: line items from catalog or custom, auto-calculated totals with tax
- PDF generation (pdfkit): branded professional quotes with header, line items, totals
- Quote delivery: SMS + email with PDF attachment
- Public quote view: shareable link (no auth), accept/decline buttons
- Auto-quote generation: Maya creates draft quotes from booking calls
- Quote expiry worker: auto-expires past valid_until

### Automation

- 9 BullMQ workers: lead-stalled, no-show, follow-up-missed, webhook-retry, appointment-reminder, follow-up-cadence, data-retention, quote-expiry, + on-demand retry
- SCANNERS_ENABLED env var to disable in dev
- Graceful SIGTERM shutdown

### Platform

- PWA: manifest.json, service worker, installable on iOS/Android
- Push notifications: Web Push for new calls, bookings, escalations, no-shows, follow-ups
- Audit logging: SOC 2 prep, mutating API operations logged with IP/user-agent
- RBAC schema: tenant_users table with owner/admin/member roles
- Data retention: weekly cleanup (audit 365d, sessions 180d, push 90d)
- Security headers: HSTS, X-Frame-Options, CSP, Referrer-Policy
- Onboarding wizard: 6-step (business info, phone provisioning, calendar, hours, test Maya, done)
- Demo vertical switcher: live industry switching for sales demos

## Verticals

| Vertical    | Custom Fields                              | Pipeline Stages                                                     | Business Hours                    |
| ----------- | ------------------------------------------ | ------------------------------------------------------------------- | --------------------------------- |
| dental      | insurance, recall interval, treatment plan | New inquiry -> Consultation -> Treatment -> Active -> Recall        | Mon-Fri 8am-5pm, Sat 9am-1pm      |
| salon       | stylist, hair type, color formula          | New client -> First booked -> Returning -> VIP -> Lapsed            | Mon-Fri 9am-7pm, Sat 9am-5pm      |
| restaurant  | party size, dietary, seating               | New guest -> Returning -> Regular -> VIP                            | Mon-Fri 11am-10pm, Sat-Sun varies |
| contractor  | property type, estimate status, warranty   | New lead -> Estimate sent -> Accepted -> Scheduled -> Completed     | Mon-Fri 7am-5pm, Sat 8am-12pm     |
| law_firm    | case type, retainer, jurisdiction          | New inquiry -> Conflict check -> Consultation -> Retained -> Active | Mon-Fri 9am-5pm                   |
| real_estate | buyer/seller, budget, pre-approval         | New lead -> Qualified -> Showing -> Offer -> Under contract         | Mon-Fri 9am-6pm, Sat 10am-4pm     |
| sales_crm   | company, demo status, vertical interest    | Prospect -> Demo scheduled -> Demo done -> Pilot -> Paying          | Mon-Fri 9am-6pm                   |

## Getting Started

```bash
# Clone
git clone https://github.com/siddhu6064/Nuatis.git
cd Nuatis

# Install dependencies
npm install

# Copy env file and fill in values
cp apps/api/.env.example apps/api/.env

# Run migrations (paste each file into Supabase SQL editor)
ls supabase/migrations/

# Start development
npm run dev        # starts web:3000 + api:3001

# Run tests
npm test           # 52 tests, 9 suites
```

## Environment Variables

See `apps/api/.env.example` for the full list. Key vars:

| Variable                       | Description                         |
| ------------------------------ | ----------------------------------- |
| SUPABASE_URL                   | Supabase project URL                |
| SUPABASE_SERVICE_ROLE_KEY      | Supabase service role key           |
| GEMINI_API_KEY                 | Google Gemini API key               |
| TELNYX_API_KEY                 | Telnyx API key for voice + SMS      |
| TELNYX_TENANT_MAP              | Phone-to-tenant mapping             |
| REDIS_URL                      | Upstash Redis connection string     |
| GOOGLE_CLIENT_ID / SECRET      | Google Calendar OAuth2              |
| RESEND_API_KEY                 | Resend email API key                |
| SENTRY_DSN                     | Sentry error monitoring DSN         |
| VAPID_PUBLIC_KEY / PRIVATE_KEY | Web Push VAPID keys                 |
| ADMIN_API_KEY                  | Admin stats endpoint key            |
| VOICE_WS_URL                   | Production WebSocket URL for Telnyx |

## Deployment

- **Frontend**: Vercel (auto-deploys from main)
- **API**: Azure Container Apps (see `infra/azure/README.md`)
- **Voice**: WebSocket server on Azure with Telnyx webhook
- **Alternative**: Cloudflare Tunnel (see `infra/cloudflare/cloudflared.yml`)

## Related Repos

- [Nuatis-Ops-Copilot](https://github.com/siddhu6064/Nuatis-Ops-Copilot) — Python alerting sidecar with 5 detectors (booking failure, call failure, no-show, lead stalled, follow-up missed)
