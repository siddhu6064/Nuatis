# Nuatis API

Express ESM TypeScript backend — voice pipeline, CRM routes, BullMQ workers, CPQ, and integrations.

## Key Modules

- **Voice Pipeline**: Telnyx WebSocket <-> Gemini 2.0 Flash Live, 6 tool calls, post-call automation
- **CRM Routes**: Contacts, appointments (Google Calendar sync), pipeline, call logs
- **CPQ**: Service catalog, quotes (CRUD + PDF + send + public accept/decline), auto-quote from Maya
- **Insights**: Call analytics, pipeline funnel, revenue/ROI, CPQ metrics
- **Workers**: 9 BullMQ managed workers (see below)
- **Push**: Web Push notifications via VAPID
- **Email**: Resend with templates + PDF attachments

## BullMQ Workers (9 total)

| Worker                   | Schedule  | Purpose                                                  |
| ------------------------ | --------- | -------------------------------------------------------- |
| lead-stalled-scanner     | Every 1h  | Detect contacts with 7+ days inactivity                  |
| no-show-scanner          | Every 5m  | Mark no-shows, rebook SMS, push notification             |
| follow-up-missed-scanner | Every 1h  | Detect 2-7 day contact gaps                              |
| appointment-reminder     | Every 15m | 24h + 1h SMS reminders                                   |
| follow-up-cadence        | Every 1h  | Multi-step SMS/email follow-ups per vertical             |
| webhook-retry            | On-demand | Exponential backoff retry for failed webhooks            |
| data-retention           | Weekly    | Clean old audit logs (365d), sessions (180d), push (90d) |
| quote-expiry             | Every 1h  | Auto-expire quotes past valid_until                      |
| (webhook-retry queue)    | On-demand | Ops-Copilot delivery retries                             |

## Ops-Copilot Integration

`src/lib/ops-copilot-client.ts` — fire-and-forget POST to `OPS_COPILOT_URL/internal/events/activity`. 3s timeout. Never throws. Failed deliveries enqueued to webhook-retry queue with exponential backoff (3 attempts).

### Events Wired

| Event Type            | Trigger                         | Source                   |
| --------------------- | ------------------------------- | ------------------------ |
| `booking.failed`      | Appointment creation failure    | appointments route       |
| `call.failed`         | Gemini session creation failure | telnyx-handler           |
| `call.completed`      | Post-call automation            | post-call.ts             |
| `appointment.no_show` | No-show scanner detection       | no-show-scanner          |
| `lead.stalled`        | 7+ day inactivity               | lead-stalled-scanner     |
| `follow_up.missed`    | 2-7 day contact gap             | follow-up-missed-scanner |

## Middleware Stack

1. Security headers (HSTS, X-Frame-Options, etc.)
2. Helmet
3. CORS
4. express.json
5. Audit logger (async, fire-and-forget for POST/PUT/PATCH/DELETE)
6. Sentry error handler (after routes)

## API Routes

| Path                    | Auth            | Description                                           |
| ----------------------- | --------------- | ----------------------------------------------------- |
| /health                 | None            | Service health with Supabase/Redis/Gemini checks      |
| /admin/stats            | API key         | Active WebSockets, calls today, worker status         |
| /api/tenants            | None (sign-up)  | Tenant + user provisioning                            |
| /api/auth/google        | JWT             | Google Calendar OAuth2 flow                           |
| /api/appointments       | JWT             | CRUD + Google Calendar sync                           |
| /api/contacts           | JWT             | Contact management                                    |
| /api/calls              | JWT             | Voice session logs (paginated)                        |
| /api/knowledge          | JWT             | Knowledge base for RAG                                |
| /api/maya-settings      | JWT             | Maya voice config (enabled, greeting, personality)    |
| /api/webhooks           | JWT             | Webhook subscription management                       |
| /api/insights/\*        | JWT             | Analytics (calls, pipeline, revenue, follow-ups, cpq) |
| /api/services           | JWT             | Service catalog CRUD                                  |
| /api/quotes             | JWT             | Quote CRUD + send + PDF + duplicate                   |
| /api/quotes/view/:token | None (token)    | Public quote view/accept/decline/PDF                  |
| /api/provisioning       | JWT             | Phone provisioning + onboarding status                |
| /api/push               | JWT             | Push subscription management                          |
| /api/demo               | JWT (demo only) | Vertical switching for demo tenant                    |
| /voice/inbound          | Telnyx webhook  | Call lifecycle events                                 |
| /voice/stream           | WebSocket       | Telnyx <-> Gemini audio bridge                        |

## Environment

See `../.env.example` for all variables. Key: `SUPABASE_URL`, `GEMINI_API_KEY`, `TELNYX_API_KEY`, `REDIS_URL`, `OPS_COPILOT_URL`.
