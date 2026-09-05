# Nuatis

**AI-powered front-office SaaS for SMBs.** Maya answers your phones, books appointments, sends follow-ups, and closes deals — so your team doesn't have to.

---

## What is Nuatis?

Nuatis is a vertical-aware CRM + Voice AI platform built for small and mid-sized businesses. One subscription replaces your receptionist, your scheduling software, your follow-up automation, and your CRM.

**Maya** — our Voice AI receptionist — answers calls in under 1.5 seconds, speaks 4 languages, books appointments live, escalates to humans when needed, and generates quotes automatically from the conversation.

**16 verticals supported:** dental · medical · veterinary · salon · spa · gym · nail bar · pet grooming · tattoo · car wash · laundry · restaurant · contractor · law firm · real estate · sales CRM

---

## Modules

| Module           | Description                                                                                                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Maya**         | Voice AI receptionist — Gemini 2.0 Flash Live, Telnyx PSTN, <1.5s latency, tool calls, multilingual, cross-call caller memory                                                                            |
| **CRM**          | Contacts, companies, deals, notes, tasks, activity timeline, CSV import, lead scoring, tags, smart lists, custom fields                                                                                  |
| **Scheduling**   | Native calendar + Google/Microsoft 365 sync, public booking page + self-service reschedule/cancel, round-robin groups                                                                                    |
| **Pipeline**     | Lead Kanban + list view, multi-pipeline, stage probability, revenue forecasting, weighted funnel + sales quotas                                                                                          |
| **Automation**   | BullMQ scanners — stalled leads, no-shows, lapsed clients, follow-up cadences, review requests, invoice/expense/time-off reminders, tenant-editable outreach sequences, multi-step branching automations |
| **AI Campaigns** | Segment-driven AI-generated copy across SMS/email/social, human approval gate, A/B variant testing, performance analytics                                                                                |
| **Orders**       | Order intake, kanban fulfillment, Maya voice ordering, quote conversion, inventory deduction                                                                                                             |
| **Expenses**     | Categories, receipts, recurring rules, approval thresholds, P&L insights, accounting-software export                                                                                                     |
| **CPQ**          | Service catalog, quote builder, PDF proposals, tax + discounts, promo codes, payment links, refunds, ledger                                                                                              |
| **Insights**     | Recharts analytics, ROI dashboard, Maya metrics, cohort retention, Product Health, trial→paid funnel                                                                                                     |
| **Staff Portal** | Self-service logins for staff — own schedule, appointments, time clock, pay rate, time-off requests                                                                                                      |

Vendors/purchase orders, inventory (variants/kits, barcode, multi-location), customer portal (self-service booking, documents, referrals), SSO (WorkOS), Stripe Connect, and an outbound-webhooks/API-key integration layer ship alongside the modules above.

---

## Tech Stack

| Layer     | Technology                                                             |
| --------- | ---------------------------------------------------------------------- |
| Frontend  | Next.js 14 App Router · Tailwind v3 · Recharts · @hello-pangea/dnd     |
| API       | Express ESM TypeScript · NodeNext · BullMQ                             |
| Mobile    | React Native + Expo (iOS/Android)                                      |
| Voice AI  | Gemini 2.0 Flash Live (STT + LLM + TTS unified, ~$0.008/call)          |
| Telephony | Telnyx (PSTN, SIP, SMS, 10DLC approved)                                |
| Database  | Supabase PostgreSQL + RLS (194+ migrations)                            |
| Auth      | Auth.js v5 (credentials) · SSO via WorkOS (SAML/OIDC)                  |
| Queue     | BullMQ + Azure Cache for Redis                                         |
| Email     | Resend (transactional)                                                 |
| Calendar  | Native (default) · Google Calendar · Microsoft 365                     |
| Deploy    | Azure Container Apps (API) · Next.js standalone (Web)                  |
| CI/CD     | GitHub Actions · Node 24 · 1,626 API tests / 211 suites · 16 web tests |

---

## Repository Structure

```
apps/
  web/          Next.js 14 dashboard
  api/          Express API + voice pipeline + BullMQ workers
  mobile/       React Native + Expo
packages/
  shared/       Shared types, VERTICALS config, utilities
infra/
  azure/        Container Apps deployment scripts
supabase/
  migrations/   194+ migration files (sequential, 0001–0194)
```

---

## Development Setup

```bash
# Clone
git clone https://github.com/siddhu6064/Nuatis.git
cd Nuatis

# Install
npm install

# Environment
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
# Fill in required values (see Environment Variables below)

# Database
npx supabase db push

# Start
npm run dev   # web :3000 · api :3001
```

### Mobile

```bash
cd apps/mobile && npx expo start
```

### Tests

```bash
cd apps/api
NODE_OPTIONS=--experimental-vm-modules npx jest
# 1,626 tests · 211 suites · CI green

cd apps/web
npx jest
# 16 tests · 3 suites
```

---

## Production Infrastructure

| Resource               | Value                            |
| ---------------------- | -------------------------------- |
| Web                    | https://app.nuatis.com           |
| API                    | https://api.nuatis.com           |
| Health                 | https://api.nuatis.com/health    |
| Azure region           | South Central US                 |
| Redis                  | Azure Cache for Redis (Basic C1) |
| Container registry     | nuatisacr.azurecr.io             |
| Supabase project       | zhykavqqvvvpfpgtipzp.supabase.co |
| 10DLC Brand            | B2FT83B (approved)               |
| Maya production number | +1 512 737 6388                  |
| Maya demo number       | +1 512 737 6322                  |

---

## Environment Variables

See `apps/api/.env.example` for the full list. Required variables:

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
GEMINI_API_KEY
TELNYX_API_KEY
TELNYX_TENANT_MAP
REDIS_URL
AUTH_SECRET
RESEND_API_KEY
STRIPE_SECRET_KEY
GEMINI_API_KEY
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
CORS_ORIGIN
SCANNERS_ENABLED
```

---

## Compliance

| Vertical                                                                                   | Compliance                                                        |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| dental, medical                                                                            | HIPAA · BAA required · 6-yr retention · included in Practice plan |
| law_firm                                                                                   | ABA 1.6/1.1 attorney-client privilege                             |
| real_estate                                                                                | FHA · TREC                                                        |
| veterinary                                                                                 | TX ITEA                                                           |
| salon, restaurant, contractor, spa, gym, nail_bar, tattoo, car_wash, laundry, pet_grooming | TCPA · opt-in gated · STOP language appended · 10DLC approved     |
| physical_therapy, optometry                                                                | HIPAA-gated · deferred until HIPAA hardening complete             |

---

## Deployment

```bash
# Build and push containers
cd infra/azure && ./deploy.sh

# Update environment variables on Azure
./update-env.sh
```

Both containers run on Azure Container Apps in South Central US.
Budget alert configured at $700/month → sid@nuatis.com.

---

**Call Maya:** +1 512 737 6322
Say "book an appointment" or "get a quote" — Maya handles the full flow live.

---

## Built by

[Sid Yennamaneni](https://github.com/siddhu6064) — founder, Nuatis LLC
