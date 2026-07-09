# AUDIT-P1 — API Surface (authentication, authorization, tenant isolation)

Scope: `apps/api/src/routes/**`, `apps/api/src/middleware/**`, `apps/api/src/index.ts`. Read-only. No files modified.

Method: every route file read in full by a dedicated reader; `index.ts` mount order and `lib/auth.ts` / all middleware read directly; every finding cites file:line with verbatim code. Migrations consulted only to confirm column FK types and enum spellings.

Baseline facts verified against `index.ts`:

- `securityHeaders` → `helmet()` → `cors` → raw-body webhook mounts → `express.json()` → `auditLoggerMiddleware` → health/admin → `generalLimiter` → all `/api/*` routers.
- **Stripe billing webhook mounts BEFORE `express.json()`** — confirmed. `app.use('/api/webhooks/stripe-billing', express.raw({type:'application/json'}), stripeBillingWebhooksRouter)` at index.ts:159-163. `/api/webhooks/stripe` (index.ts:154-156) and `/api/webhooks/email` (index.ts:154? — email raw at index.ts:154) likewise raw before json. Telnyx routes use a `verify`-callback JSON parser that captures `rawBody` before the global parser (index.ts:167-174). Ordering is correct.
- `requireAuth` (lib/auth.ts:91) verifies HS256 with `issuer ∈ {nuatis-web, nuatis-mobile}`, `audience: nuatis-api`. Sets `tenantId`, `userId` (= NextAuth `sub`), `appUserId` (= public.users.id, may be null), `role` (default `'staff'`). `res.locals.tenantId` set for the audit logger.
- `generalLimiter` = 100 req/min/IP, applied after health/admin; skipped when `NODE_ENV=test`. `/health`, `/admin`, `/api/voice/live` mount BEFORE it → no IP throttle.
- `tenant_id` is never read from req.body/req.query and used in a domain query except the public exceptions noted below (chat/webchat `init` accept a raw `tenant_id` — see findings; digest/review-request/trigger-link/OAuth-callback resolve tenant from token/nonce, which is allowed).

## Endpoint Inventory

Auth column: `requireAuth` unless noted. `general-only` = only the global 100/min IP limiter. Tenant column: `yes` = every query scoped by tenant_id (directly or via a same-handler tenant-scoped fetch); `partial`/`no` explained inline.

| Method                    | Path                                    | File:Line                        | Auth                                              | RBAC                                      | Module Gate                       | Rate Limit                                   | Tenant-Scoped                                                |
| ------------------------- | --------------------------------------- | -------------------------------- | ------------------------------------------------- | ----------------------------------------- | --------------------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| GET                       | /api/quotes                             | quotes.ts:123                    | requireAuth                                       | none                                      | requireCpq                        | general-only                                 | yes                                                          |
| GET                       | /api/quotes/:id                         | quotes.ts:156                    | requireAuth                                       | none                                      | requireCpq                        | general-only                                 | yes                                                          |
| POST                      | /api/quotes                             | quotes.ts:182                    | requireAuth                                       | none                                      | requireCpq                        | general-only                                 | body contact_id/created_by unvalidated                       |
| PUT                       | /api/quotes/:id                         | quotes.ts:347                    | requireAuth                                       | none                                      | requireCpq                        | general-only                                 | yes                                                          |
| DELETE                    | /api/quotes/:id                         | quotes.ts:467                    | requireAuth                                       | none                                      | requireCpq                        | general-only                                 | yes                                                          |
| POST                      | /api/quotes/:id/send                    | quotes.ts:491                    | requireAuth                                       | none                                      | requireCpq                        | general-only                                 | yes (SMS conventions violated)                               |
| POST                      | /api/quotes/:id/duplicate               | quotes.ts:664                    | requireAuth                                       | none                                      | requireCpq                        | general-only                                 | yes                                                          |
| GET                       | /api/quotes/:id/pdf                     | quotes.ts:820                    | requireAuth                                       | none                                      | requireCpq                        | general-only                                 | yes                                                          |
| GET                       | /api/quotes/view/:token                 | quotes.ts:854                    | none (public)                                     | n/a                                       | none                              | general-only                                 | n/a (share_token)                                            |
| GET                       | /api/quotes/view/:token/pdf             | quotes.ts:957                    | none                                              | n/a                                       | none                              | general-only                                 | n/a                                                          |
| POST                      | /api/quotes/view/:token/pay-square      | quotes.ts:982                    | none                                              | n/a                                       | none                              | general-only                                 | n/a (client amountCents — see P1)                            |
| POST                      | /api/quotes/view/:token/accept          | quotes.ts:1058                   | none                                              | n/a                                       | none                              | general-only                                 | partial (global receipt seq)                                 |
| POST                      | /api/quotes/view/:token/decline         | quotes.ts:1286                   | none                                              | n/a                                       | none                              | general-only                                 | n/a                                                          |
| POST                      | /api/quotes/sign/:token                 | quotes.ts:1428                   | none                                              | n/a                                       | none                              | general-only                                 | n/a                                                          |
| POST                      | /api/quotes/:id/approve                 | quotes.ts:1458                   | requireAuth                                       | **none**                                  | requireCpq                        | general-only                                 | yes                                                          |
| POST                      | /api/quotes/:id/reject                  | quotes.ts:1523                   | requireAuth                                       | **none**                                  | requireCpq                        | general-only                                 | yes                                                          |
| GET                       | /api/quotes/:id/payments                | quotes.ts:1583                   | requireAuth                                       | none                                      | requireCpq                        | general-only                                 | yes                                                          |
| POST                      | /api/quotes/:id/payments                | quotes.ts:1627                   | requireAuth                                       | none                                      | requireCpq                        | general-only                                 | yes                                                          |
| POST                      | /api/quotes/:id/add-package             | quotes.ts:1739                   | requireAuth                                       | none                                      | requireCpq                        | general-only                                 | partial (services .in unscoped)                              |
| DELETE                    | /api/quotes/:quoteId/items/:itemId      | quotes.ts:1865                   | requireAuth                                       | none                                      | requireCpq                        | general-only                                 | yes                                                          |
| USE                       | /api/contacts/\*                        | contacts.ts:28                   | requireAuth                                       | none                                      | requireCrm                        | —                                            | —                                                            |
| GET                       | /api/contacts                           | contacts.ts:38                   | requireAuth                                       | none                                      | requireCrm                        | general-only                                 | yes                                                          |
| GET                       | /api/contacts/tags                      | contacts.ts:248                  | requireAuth                                       | none                                      | requireCrm                        | general-only                                 | yes                                                          |
| GET                       | /api/contacts/stages                    | contacts.ts:292                  | requireAuth                                       | none                                      | requireCrm                        | general-only                                 | yes                                                          |
| POST                      | /api/contacts                           | contacts.ts:368                  | requireAuth                                       | none                                      | requireCrm                        | general-only                                 | yes (referred_by FK unvalidated)                             |
| PUT/PATCH                 | /api/contacts/:id                       | contacts.ts:639                  | requireAuth                                       | none                                      | requireCrm                        | general-only                                 | yes                                                          |
| GET                       | /api/contacts/duplicates                | contacts.ts:643                  | requireAuth                                       | none                                      | requireCrm                        | general-only                                 | yes                                                          |
| POST                      | /api/contacts/merge                     | contacts.ts:751                  | requireAuth                                       | none                                      | requireCrm                        | general-only                                 | partial (child updates by contact_id only)                   |
| POST                      | /api/contacts/bulk-tag                  | contacts.ts:876                  | requireAuth                                       | none                                      | requireCrm                        | general-only                                 | yes                                                          |
| POST                      | /api/contacts/bulk-assign               | contacts.ts:930                  | requireAuth                                       | none                                      | requireCrm                        | general-only                                 | yes (assignee FK unvalidated)                                |
| POST                      | /api/contacts/bulk-sms                  | contacts.ts:981                  | requireAuth                                       | none                                      | requireCrm                        | **general-only (no SMS limiter)**            | yes (opt-in shape wrong)                                     |
| POST                      | /api/contacts/bulk/stage                | contacts.ts:1073                 | requireAuth                                       | none                                      | requireCrm                        | general-only                                 | yes                                                          |
| POST                      | /api/contacts/bulk/tag                  | contacts.ts:1120                 | requireAuth                                       | none                                      | requireCrm                        | general-only                                 | yes                                                          |
| POST                      | /api/contacts/bulk/sms                  | contacts.ts:1177                 | requireAuth                                       | none                                      | requireCrm                        | **general-only (no SMS limiter)**            | yes (no opt-in check)                                        |
| POST                      | /api/contacts/bulk/archive              | contacts.ts:1265                 | requireAuth                                       | none                                      | requireCrm                        | general-only                                 | yes                                                          |
| POST                      | /api/contacts/bulk/export               | contacts.ts:1297                 | requireAuth                                       | none                                      | requireCrm                        | general-only                                 | yes                                                          |
| GET                       | /api/contacts/referral-sources          | contacts.ts:1368                 | requireAuth                                       | none                                      | requireCrm                        | general-only                                 | yes                                                          |
| PATCH                     | /api/contacts/:id/lifecycle             | contacts.ts:1394                 | requireAuth                                       | none                                      | requireCrm                        | general-only                                 | yes                                                          |
| PATCH                     | /api/contacts/bulk/lifecycle            | contacts.ts:1452                 | requireAuth                                       | none                                      | requireCrm                        | general-only                                 | **UNREACHABLE (shadowed)**                                   |
| PATCH                     | /api/contacts/bulk/assign               | contacts.ts:1517                 | requireAuth                                       | none                                      | requireCrm                        | general-only                                 | yes (assignee FK unvalidated)                                |
| GET                       | /api/contacts/source-report             | contacts.ts:1585                 | requireAuth                                       | none                                      | requireCrm                        | general-only                                 | yes                                                          |
| GET                       | /api/contacts/:id                       | contacts.ts:1660                 | requireAuth                                       | none                                      | requireCrm                        | general-only                                 | yes                                                          |
| GET                       | /api/insights/\* (16 routes)            | insights.ts:28–1556              | requireAuth                                       | none (plg: inline owner)                  | requirePlan('insights')           | general-only                                 | yes except plg/pipeline-forecast/pipeline-funnel/referrals   |
| POST/GET/PATCH/PUT/DELETE | /api/campaigns/\* (17)                  | campaigns.ts:81–1170             | requireAuth                                       | none                                      | requirePlan('campaigns')          | general-only (generate: aiGenerationLimiter) | yes (sends/recipients broken by first/last_name)             |
| GET/POST/PUT              | /api/invoices/\* (8)                    | invoices.ts:32–636               | requireAuth                                       | **none**                                  | none                              | general-only                                 | yes (POST line-items miss tenant_id; contact_id unvalidated) |
| GET                       | /api/invoices/public/:token             | invoices.ts:776                  | none (public)                                     | n/a                                       | none                              | general-only                                 | n/a (share_token)                                            |
| GET/POST/PATCH/DELETE     | /api/appointments/\* (6)                | appointments.ts:72–646           | requireAuth                                       | none                                      | requireAppointments('scheduling') | general-only                                 | yes except POST (resource cross-tenant)                      |
| GET/POST/PUT/DELETE       | /api/deals/\* (9)                       | deals.ts:28–671                  | requireAuth                                       | none                                      | requireDeals('deals')             | general-only                                 | yes except PUT (users lookup unscoped)                       |
| GET/POST                  | /api/conversations/\* (9)               | conversations.ts:19–656          | requireAuth                                       | none                                      | **none**                          | general-only (send: smsSendLimiter)          | yes                                                          |
| GET/POST/PUT/DELETE       | /api/pipelines/\* (11)                  | pipelines.ts:31–587              | requireAuth                                       | none                                      | requirePipeline('pipeline')       | general-only                                 | yes                                                          |
| GET                       | /api/booking/:slug                      | booking-public.ts:27             | none (public)                                     | n/a                                       | none                              | general-only                                 | yes (slug)                                                   |
| GET                       | /api/booking/:slug/availability         | booking-public.ts:139            | none                                              | n/a                                       | none                              | **general-only (no limiter)**                | yes (slug)                                                   |
| POST                      | /api/booking/:slug/confirm              | booking-public.ts:220            | none                                              | n/a                                       | none                              | bookingLimiter                               | partial (resource_id unvalidated)                            |
| GET/DELETE/POST           | /api/email-integrations/\* (7)          | email-integrations.ts:26–399     | requireAuth (2 public OAuth callbacks)            | none                                      | none                              | general-only (send: none)                    | yes                                                          |
| GET/POST/PUT/DELETE       | /api/staff/\* (10)                      | staff.ts:73–496                  | requireAuth                                       | none                                      | requireCrm('crm')                 | general-only                                 | yes                                                          |
| GET/POST/PUT/DELETE       | /api/reputation/\* (10)                 | reputation.ts:27–432             | requireAuth (callback public)                     | none                                      | none                              | general-only                                 | yes                                                          |
| POST                      | /api/webchat/session/init               | webchat.ts:19                    | none (public)                                     | n/a                                       | none                              | sessionInitLimiter                           | **no (raw tenant_id from body)**                             |
| POST/GET                  | /api/webchat/session/:token/\*          | webchat.ts:92–260                | none (public)                                     | n/a                                       | none                              | aiGenerationLimiter/general                  | n/a (session_token)                                          |
| GET                       | /api/webchat/sessions                   | webchat.ts:295                   | requireAuth                                       | none                                      | none                              | general-only                                 | yes                                                          |
| GET/PUT                   | /api/settings/webchat                   | webchat.ts:328–358               | requireAuth                                       | **none**                                  | none                              | general-only                                 | yes                                                          |
| GET/POST/DELETE           | /api/portal/\* (10)                     | portal.ts:19–402                 | requireAuth (5 public token routes)               | **none**                                  | none                              | general-only (request-access: authLimiter)   | yes                                                          |
| GET/POST                  | /api/subscriptions/\* (6)               | subscriptions.ts:24–290          | requireAuth                                       | requireRole('owner','admin') on mutations | none                              | general-only                                 | yes                                                          |
| GET/POST/PUT/DELETE       | /api/resources/\* (8)                   | resources.ts:19–314              | requireAuth                                       | none                                      | none                              | general-only                                 | yes except /book (FK unvalidated)                            |
| GET/POST/PATCH/DELETE     | /api/calendar-groups/\* (8)             | calendar-groups.ts:34–325        | requireAuth                                       | none                                      | none                              | general-only                                 | yes                                                          |
| GET/POST/PUT/DELETE       | /api/trigger-links (4)                  | trigger-links.ts:36–198          | requireAuth                                       | none                                      | none                              | general-only                                 | yes                                                          |
| GET                       | /t/:slug                                | trigger-links.ts:243             | none (public)                                     | n/a                                       | none                              | triggerLinkLimiter                           | **appt update cross-tenant (P0)**                            |
| POST                      | /api/webhooks/stripe-billing            | stripe-billing-webhooks.ts:103   | webhook-sig                                       | n/a                                       | none                              | **none (pre-limiter)**                       | n/a (Stripe metadata)                                        |
| GET/POST/PUT/DELETE       | /api/reports/\* (9)                     | reports.ts:28–350                | requireAuth                                       | none                                      | none                              | general-only                                 | yes                                                          |
| GET/POST/PUT/DELETE       | /api/inventory/\* (6)                   | inventory.ts:29–306              | requireAuth                                       | none                                      | requireCrm('crm')                 | general-only                                 | yes (actor_id = userId)                                      |
| GET/POST/PUT/DELETE       | /api/intake-forms/\* (6)                | intake-forms.ts:51–306           | requireAuth                                       | none                                      | none                              | general-only                                 | yes                                                          |
| GET/POST/DELETE           | /api/automation/\* (6)                  | automation-overview.ts:129–339   | requireAuth                                       | none                                      | requirePlan('automation')         | general-only                                 | yes except scanner retry/clear (global queue)                |
| POST                      | /api/tenants                            | tenants.ts:35                    | none (public signup)                              | n/a                                       | none                              | authLimiter                                  | n/a (creates tenant)                                         |
| GET                       | /api/tenants/me                         | tenants.ts:289                   | requireAuth                                       | none                                      | none                              | general-only                                 | yes                                                          |
| PATCH                     | /api/tenants/me                         | tenants.ts:306                   | requireAuth                                       | requireRole('owner','admin')              | none                              | general-only                                 | yes                                                          |
| GET/DELETE                | /api/settings/calendar/\* (4)           | calendar-settings.ts:136–238     | requireAuth                                       | none                                      | none                              | general-only                                 | yes                                                          |
| GET                       | /api/calendar/outlook/callback          | calendar-settings.ts:268         | none (public OAuth)                               | n/a                                       | none                              | general-only                                 | **state unsigned (P2)**                                      |
| GET/POST/PATCH/DELETE     | /api/custom-automations/\* (7)          | custom-automations.ts:37–307     | requireAuth                                       | none                                      | requirePlan('automation')         | **general-only (generate: no ai limiter)**   | yes                                                          |
| POST                      | /webhooks/telnyx/sms                    | sms-webhooks.ts:16               | webhook-sig (Ed25519)                             | n/a                                       | none                              | general-only                                 | partial (tenant via locations.telnyx_number)                 |
| POST                      | /api/chat/init                          | chat-public.ts:19                | none (public)                                     | n/a                                       | none                              | sessionInitLimiter                           | **partial (raw tenant_id from body)**                        |
| POST                      | /api/chat/message                       | chat-public.ts:67                | none                                              | n/a                                       | none                              | aiGenerationLimiter                          | yes (share_token)                                            |
| GET/POST                  | /api/chat/messages,/end                 | chat-public.ts:259–298           | none                                              | n/a                                       | none                              | general-only                                 | yes (share_token)                                            |
| GET/POST/PUT/DELETE       | /api/tasks/\* (4)                       | tasks.ts:17–287                  | requireAuth                                       | none                                      | none                              | general-only                                 | yes (PUT FK unvalidated; created_by=userId)                  |
| GET/POST/DELETE           | /api/maya-kb/\* (7)                     | maya-kb.ts:37–272                | requireAuth                                       | none                                      | none                              | general-only                                 | yes                                                          |
| GET/POST/PATCH/DELETE     | /api (activity + notes) (5)             | activity.ts:16–276               | requireAuth                                       | author-or-owner on note edit/delete       | none                              | general-only                                 | yes (actor_id = userId)                                      |
| POST                      | /voice/outbound-status                  | voice-outbound.ts:39             | webhook-sig                                       | n/a                                       | none                              | general-only                                 | partial (tenant from job; in-mem fallback)                   |
| GET/POST/PUT/DELETE       | /api/packages/\* (6)                    | packages.ts:31–270               | requireAuth                                       | none                                      | requirePlan('cpq')                | general-only                                 | yes except GET/:id (services .in unscoped)                   |
| GET                       | /api/campaigns/prereq                   | campaigns-prereq.ts:270          | requireAuth                                       | none                                      | **none**                          | general-only                                 | yes                                                          |
| GET/PUT                   | /api/maya-settings (2)                  | maya-settings.ts:35–100          | requireAuth                                       | **none**                                  | none                              | general-only                                 | yes                                                          |
| GET/POST                  | /api/settings/bcc-logging (2)           | email-inbound.ts:30–54           | requireAuth                                       | **none**                                  | none                              | general-only                                 | yes                                                          |
| POST                      | /api/webhooks/email-inbound             | email-inbound.ts:111             | shared-secret (timing-safe)                       | n/a                                       | none                              | general-only                                 | yes (tenant from bcc addr)                                   |
| GET/POST/PUT/DELETE       | /api/telnyx-numbers/\* (5)              | telnyx-numbers.ts:17–230         | requireAuth                                       | **none**                                  | none                              | general-only                                 | yes                                                          |
| GET                       | /api/email/health                       | email-health.ts:30               | requireAuth                                       | none                                      | none                              | general-only                                 | yes                                                          |
| POST                      | /api/webhooks/email                     | email-webhooks.ts:48             | webhook-sig (Svix HMAC)                           | n/a                                       | none                              | general-only                                 | partial (recipient update by id only)                        |
| GET                       | /api/billing/plans                      | billing.ts:51                    | none (public)                                     | n/a                                       | none                              | general-only                                 | n/a                                                          |
| GET                       | /api/billing/subscription               | billing.ts:69                    | requireAuth                                       | none                                      | none                              | general-only                                 | yes                                                          |
| POST                      | /api/billing/checkout                   | billing.ts:99                    | requireAuth                                       | requireRole('owner','admin')              | none                              | checkoutLimiter                              | yes                                                          |
| POST                      | /api/billing/portal                     | billing.ts:211                   | requireAuth                                       | requireRole('owner','admin')              | none                              | general-only                                 | yes                                                          |
| GET/POST                  | /api/calls/\* (4)                       | calls.ts:15–235                  | requireAuth                                       | none                                      | none                              | general-only                                 | yes (initiate = stub)                                        |
| POST/GET                  | /api/provisioning/\* (4)                | provisioning.ts:18–201           | requireAuth                                       | owner/admin (provision, upgrade)          | none                              | phoneProvisionLimiter (provision)            | yes                                                          |
| GET/POST/PUT/DELETE       | /api/email-templates/\* (6)             | email-templates.ts:16–203        | requireAuth                                       | none                                      | none                              | general-only                                 | yes (preview broken: first/last_name)                        |
| GET/POST/PUT/DELETE       | /api/lead-scoring/\* (6)                | lead-scoring.ts:19–187           | requireAuth                                       | none                                      | none                              | general-only (rescore: no limiter)           | yes                                                          |
| GET/POST                  | /api/referrals/\* (4)                   | referrals.ts:16–170              | requireAuth (2 public)                            | n/a                                       | none                              | general-only                                 | n/a (code token)                                             |
| POST/GET                  | /api/outbound-calls/\* (4)              | outbound-calls.ts:28–187         | requireAuth                                       | owner/admin on POST                       | none                              | smsSendLimiter (POST)                        | yes                                                          |
| GET/PUT                   | /api/settings/review-automation (3)     | review-settings.ts:20–117        | requireAuth                                       | **none**                                  | none                              | general-only                                 | yes                                                          |
| GET                       | /api/review-tracking/:id                | review-settings.ts:167           | none (public)                                     | n/a                                       | none                              | general-only                                 | n/a (id token)                                               |
| GET/POST/PUT/DELETE       | /api/companies/\* (5)                   | companies.ts:28–198              | requireAuth                                       | none                                      | requireCompanies('companies')     | general-only                                 | yes                                                          |
| POST                      | /api/webhooks/stripe                    | stripe-webhooks.ts:72            | webhook-sig                                       | n/a                                       | none                              | general-only                                 | n/a (Stripe metadata)                                        |
| GET/PUT                   | /api/settings/booking (3)               | booking-settings.ts:19–189       | requireAuth                                       | **none**                                  | none                              | general-only                                 | yes                                                          |
| GET/DELETE                | /api/square/\* (4)                      | square.ts:29–201                 | requireAuth (callback public)                     | none                                      | none                              | general-only                                 | yes                                                          |
| GET                       | /api/sms/health                         | sms-health.ts:31                 | requireAuth                                       | none                                      | none                              | general-only                                 | yes (opt-out count shape wrong)                              |
| GET/POST                  | /api/chat/sessions/\* (5)               | chat-agent.ts:16–188             | requireAuth                                       | none                                      | none                              | general-only                                 | yes (sender_id = userId)                                     |
| POST/GET/DELETE           | /api/contacts/:id/attachments (3)       | attachments.ts:38–178            | requireAuth                                       | none                                      | none                              | general-only                                 | yes (uploaded_by = userId)                                   |
| GET/POST/PUT/DELETE       | /api/views/\* (4)                       | saved-views.ts:17–180            | requireAuth                                       | none                                      | none                              | general-only                                 | yes (user_id = userId; reorder UNREACHABLE)                  |
| GET                       | /api/payments/ledger,summary (2)        | payments.ts:37–126               | requireAuth                                       | none                                      | none                              | general-only                                 | yes (Stripe metadata filter)                                 |
| POST/GET                  | /api/import/\* (4)                      | import.ts:21–171                 | requireAuth                                       | none                                      | none                              | general-only                                 | yes (created_by = userId)                                    |
| GET/POST/PATCH/DELETE     | /api/availability-schedules/\* (5)      | availability-schedules.ts:27–144 | requireAuth                                       | none                                      | none                              | general-only                                 | yes                                                          |
| GET/POST/PUT/DELETE       | /api/snippets/\* (5)                    | snippets.ts:18–156               | requireAuth                                       | none                                      | none                              | general-only                                 | yes                                                          |
| GET/PUT/POST              | /api/brand-voice/\* (3)                 | brand-voice.ts:17–149            | requireAuth                                       | none                                      | none                              | **general-only (preview: no ai limiter)**    | yes                                                          |
| GET/PUT                   | /api/business-profile/\* (3)            | business-profile.ts:31–151       | requireAuth                                       | none                                      | none                              | general-only                                 | yes                                                          |
| POST/GET                  | /api/settings/data-export (3)           | data-export.ts:27–134            | requireAuth                                       | owner/admin (POST, download)              | none                              | general-only + 1-in-flight                   | yes (requested_by = userId; GET list no RBAC)                |
| GET/POST                  | /api/contacts/:id/sms + /api/sms/\* (4) | sms.ts:19–152                    | requireAuth                                       | none                                      | none                              | smsSendTenantLimiter (send)                  | yes (no opt-in check)                                        |
| GET/POST/PUT/DELETE       | /api/locations/\* (5)                   | locations.ts:15–133              | requireAuth                                       | **none**                                  | none                              | general-only                                 | yes (telnyx_number read/write)                               |
| GET/POST/PATCH/DELETE     | /api/scheduled-reports/\* (4)           | scheduled-reports.ts:18–140      | requireAuth                                       | none                                      | none                              | general-only                                 | yes                                                          |
| GET                       | /api/digest/unsubscribe                 | digest.ts:37                     | none (HMAC token)                                 | n/a                                       | none                              | general-only                                 | no (tenantId from query, HMAC-bound)                         |
| PUT/POST                  | /api/digest/preferences,send-test (2)   | digest.ts:85–111                 | requireAuth                                       | none                                      | none                              | general-only (send-test: none)               | yes                                                          |
| GET/DELETE                | /api/caller-memory/\* (2)               | caller-memory.ts:38–94           | requireAuth                                       | none                                      | none                              | general-only                                 | yes                                                          |
| GET/POST                  | /api/gift-cards/\* (4)                  | gift-cards.ts:16–118             | requireAuth                                       | none                                      | none                              | giftCardBalanceLimiter (balance only)        | yes (purchased_by FK unvalidated; redeem non-atomic)         |
| GET/POST                  | /api/review-requests/\* (3)             | review-requests.ts:17–87         | requireAuth (2 public track)                      | none                                      | none                              | general-only                                 | yes                                                          |
| GET/POST/DELETE           | /api/payment-links/\* (3)               | payment-links.ts:22–118          | requireAuth                                       | **none**                                  | none                              | general-only                                 | yes                                                          |
| POST/GET/DELETE           | /api/media/\* (3)                       | media-library.ts:19–106          | requireAuth                                       | none                                      | none                              | general-only                                 | yes                                                          |
| GET/PUT                   | /api/follow-up-templates (2)            | follow-up-templates.ts:64–84     | requireAuth                                       | none                                      | none                              | general-only                                 | yes                                                          |
| GET/PUT                   | /api/settings/notifications (2)         | notification-settings.ts:89–111  | requireAuth                                       | none                                      | none                              | general-only                                 | yes                                                          |
| POST/GET                  | /api/google-reserve/\* (2)              | google-reserve.ts:15–109         | requireAuth                                       | none                                      | none                              | general-only                                 | yes (audit user_id = userId)                                 |
| GET/PUT                   | /api/settings/modules (2)               | settings-modules.ts:19–38        | requireAuth                                       | owner (inline)                            | inline plan gate                  | general-only                                 | yes                                                          |
| GET/POST/PUT/DELETE       | /api/services/\* (4)                    | services.ts:31–112               | requireAuth                                       | none                                      | requireCpq('cpq')                 | general-only                                 | yes                                                          |
| POST/GET/DELETE           | /api/webhooks (3)                       | webhooks.ts:26–103               | requireAuth                                       | **none**                                  | none                              | general-only                                 | yes                                                          |
| GET                       | /api/search                             | search.ts:17                     | requireAuth                                       | none                                      | crm (inventory sub-query)         | general-only                                 | yes                                                          |
| POST/GET/DELETE           | /api/knowledge/\* (4)                   | knowledge.ts:29–97               | requireAuth                                       | none                                      | none                              | general-only                                 | yes                                                          |
| GET/PUT                   | /api/cpq/settings (2)                   | cpq-settings.ts:25–48            | requireAuth                                       | none                                      | requirePlan('cpq')                | general-only                                 | yes                                                          |
| USE                       | /api/voice/live                         | voice-live-proxy.ts:109          | requireAuth (HTTP); WS via verifyVoiceLiveUpgrade | none                                      | none                              | **none (pre-limiter)**                       | n/a (proxy)                                                  |
| GET/POST/DELETE           | /api/smart-lists/\* (3)                 | smart-lists.ts:15–70             | requireAuth                                       | none                                      | none                              | general-only                                 | yes (created_by = userId)                                    |
| POST                      | /api/auth/mobile/login                  | mobile-auth.ts:15                | none (login)                                      | n/a                                       | none                              | authLimiter                                  | n/a (global email lookup)                                    |
| POST                      | /api/push/\* (3)                        | push.ts:16–79                    | requireAuth                                       | none                                      | none                              | general-only                                 | yes                                                          |
| GET                       | /api/email-tracking/:token              | email-tracking.ts:29             | none (public pixel)                               | n/a                                       | none                              | general-only                                 | n/a (tracking_token)                                         |
| GET                       | /api/auth/google(+callback)             | google-auth.ts:18–30             | requireAuth (callback public)                     | none                                      | none                              | general-only                                 | yes (nonce)                                                  |
| GET/PUT                   | /api/settings/chat-widget (2)           | chat-settings.ts:17–41           | requireAuth                                       | none                                      | none                              | general-only                                 | yes                                                          |
| GET                       | /admin/stats                            | admin.ts:31                      | admin-key (timing-safe)                           | n/a                                       | none                              | **none (pre-limiter)**                       | n/a (global aggregate)                                       |
| POST/DELETE               | /api/push/mobile/register (2)           | push-mobile.ts:15–58             | requireAuth                                       | none                                      | none                              | general-only                                 | yes (user_id = userId)                                       |
| GET/POST                  | /api/nps/\* (3)                         | nps.ts:15–67                     | requireAuth                                       | none                                      | none                              | general-only                                 | yes                                                          |
| GET/PATCH                 | /api/settings/inventory (2)             | inventory-settings.ts:15–37      | requireAuth                                       | none                                      | none                              | general-only                                 | yes                                                          |
| GET                       | /api/audit-log                          | audit-log.ts:15                  | requireAuth                                       | requireRole('owner','admin')              | none                              | general-only                                 | yes (selects nonexistent columns)                            |
| GET/PUT                   | /api/settings/labs (2)                  | settings-labs.ts:15–31           | requireAuth                                       | none                                      | none                              | general-only                                 | yes                                                          |
| PUT                       | /api/demo/switch-vertical               | demo.ts:20                       | requireAuth + demo allowlist                      | none                                      | none                              | general-only                                 | yes                                                          |
| GET                       | /health                                 | health.ts:31                     | none                                              | n/a                                       | none                              | none                                         | n/a                                                          |
| GET                       | /api/qr                                 | qr.ts:7                          | none                                              | n/a                                       | none                              | general-only                                 | n/a (no DB)                                                  |
| POST                      | /api/analytics/event                    | analytics-events.ts:15           | requireAuth                                       | none                                      | none                              | general-only                                 | yes                                                          |
| GET                       | /api/users                              | users.ts:15                      | requireAuth                                       | none                                      | none                              | general-only                                 | yes                                                          |
| GET                       | /api/announcements                      | announcements.ts:14              | none (public)                                     | n/a                                       | none                              | general-only                                 | n/a (no tenant_id column)                                    |
| POST                      | /voice/inbound (+events)                | index.ts:310                     | webhook-sig (Ed25519)                             | n/a                                       | none                              | general-only                                 | n/a (Telnyx call flow)                                       |

## Findings

### [P0] Trigger-link confirm/cancel updates appointment by id with no tenant scope

File: apps/api/src/routes/trigger-links.ts:312
Evidence:

```
if (apptId) {
  await supabase.from('appointments').update({ status: 'confirmed' }).eq('id', apptId)
}
```

(cancel branch same, trigger-links.ts:326: `.update({ status: 'cancelled' }).eq('id', apptId)`)
Impact: `action_config.appointment_id` is attacker-set at link creation; the public `/t/:slug` handler on the service-role client flips ANY tenant's appointment status by UUID — cross-tenant mutation. (The sibling contactId branches correctly add `.eq('tenant_id', link.tenant_id)`.)
Fix: Add `.eq('tenant_id', link.tenant_id)` to both appointment updates.

### [P0] insights pipeline-funnel leaks another tenant's pipeline_stages via client pipeline_id

File: apps/api/src/routes/insights.ts:1037
Evidence:

```
const { data: stagesData } = await supabase
  .from('pipeline_stages')
  .select('id, name, position, probability')
  .eq('pipeline_id', pipelineId)
```

Impact: `pipeline_id` (req.query, insights.ts:1018) is never checked against tenant_id, so any authed user reads another tenant's stage names/positions/probabilities via the service-role client.
Fix: Resolve the pipeline `.eq('id', pipelineId).eq('tenant_id', authed.tenantId)` and 404 if not found before querying stages.

### [P0] insights pipeline-forecast validates pipeline tenant-scoped but ignores the null result

File: apps/api/src/routes/insights.ts:850
Evidence:

```
const { data: pipeline } = await supabase
  .from('pipelines').select('id, name')
  .eq('id', pipelineId).eq('tenant_id', authed.tenantId).maybeSingle()
pipelineName = pipeline?.name ?? ''
```

Impact: When the tenant-scoped lookup returns null the handler falls through and the stages query at insights.ts:860 (`.eq('pipeline_id', pipelineId)`, no tenant_id) returns a foreign tenant's stage data.
Fix: Return 404 when `pipeline` is null.

### [P1] Quote created_by accepts client body value and falls back to NextAuth sub

File: apps/api/src/routes/quotes.ts:276
Evidence:

```
created_by: (b['created_by'] as string) || authed.userId || null,
```

Impact: Writes an arbitrary body UUID (or the NextAuth `sub`) into the `created_by` FK → users(id); the duplicate route (quotes.ts:701) correctly uses `authed.appUserId ?? null`. Two-identity violation + client-controlled FK.
Fix: Ignore body created_by; always write `authed.appUserId ?? null`.

### [P1] Quote POST accepts unvalidated body contact_id → cross-tenant contact PII via join

File: apps/api/src/routes/quotes.ts:255
Evidence:

```
contact_id: (b['contact_id'] as string) || null,
```

Impact: GET /:id (`select('*, contacts(full_name, phone, email)')`, quotes.ts:162) and /send return a foreign tenant's contact name/phone/email when the quote points at another tenant's contact UUID. contacts.ts enforces this exact FK-tenant check; quotes.ts does not.
Fix: Verify contact_id `.eq('tenant_id', authed.tenantId)` before insert.

### [P1] Quote approve/reject have no requireRole — discount-approval control bypassable

File: apps/api/src/routes/quotes.ts:1458 (and :1523)
Evidence:

```
router.post('/:id/approve', requireAuth, requireCpq, ...
```

Impact: The CPQ workflow requires owner approval for discounts above threshold, but any tenant member of any role can call approve/reject, defeating the control.
Fix: Add `requireRole('owner')` (or owner/admin) to both.

### [P1] Invoice record-payment / void / send have no RBAC

File: apps/api/src/routes/invoices.ts:565 (also :636, :491)
Evidence:

```
router.post('/:id/record-payment', requireAuth, ...
```

Impact: Any authenticated tenant member can record payments, void invoices, and email invoices to customers.
Fix: Add `requireRole('owner','admin')` to record-payment, void, send.

### [P1] Invoice POST inserts line items without tenant_id (PUT sets it)

File: apps/api/src/routes/invoices.ts:398
Evidence:

```
const itemRows = lineItems.map((item, i) => ({
  invoice_id: invoice.id,
  description: item.description,
```

Impact: POST-created line items get NULL tenant_id; any RLS/tenant-scoped read path silently misses them — data-integrity divergence from PUT (invoices.ts:471 includes tenant_id).
Fix: Add `tenant_id: authed.tenantId` to the POST itemRows.

### [P1] Public pay-square accepts arbitrary client amountCents, no route limiter

File: apps/api/src/routes/quotes.ts:984
Evidence:

```
const { sourceId, amountCents } = req.body as { sourceId?: unknown; amountCents?: unknown }
```

Impact: An unauthenticated share-token holder charges any amount (untethered to quote total), and with only the global limiter can card-test on the tenant's Square account.
Fix: Derive the charge from the quote's deposit/remaining balance server-side; add a route-specific limiter.

### [P1] insights /plg exposes platform-wide cross-tenant metrics gated only by per-tenant owner role

File: apps/api/src/routes/insights.ts:591
Evidence:

```
if (authed.role !== 'owner') { res.status(403)...; return }
```

(unscoped queries insights.ts:599-612: `.from('tenants')…`, `.from('analytics_events').select('event_name, created_at')` — no tenant_id)
Impact: Every tenant has an owner, so any owner reads platform-wide signup/upgrade funnel counts and all tenants' analytics_events. Aggregate/non-PII → P1.
Fix: Gate on a platform-operator identity, not the tenant owner role.

### [P1] campaigns sends/recipients select contacts.first_name/last_name (column does not exist)

File: apps/api/src/routes/campaigns.ts:1028 (also :1115)
Evidence:

```
contacts!contact_id(first_name, last_name, phone, email)
```

Impact: contacts has full_name only; the query errors so /:id/sends and /:id/recipients always 500.
Fix: Select full_name.

### [P1] email-templates preview selects contacts.first_name/last_name

File: apps/api/src/routes/email-templates.ts:85
Evidence:

```
.from('contacts').select('first_name, last_name, email, phone')
```

Impact: Query errors → preview endpoint always returns 404 "Contact not found"; feature silently dead.
Fix: Select full_name and adapt resolveTemplate.

### [P1] Cross-tenant resource booking via unvalidated resource_id + globally-scoped availability check

File: apps/api/src/routes/appointments.ts:369 (lib resource-availability.ts:24)
Evidence:

```
await supabase.from('resource_bookings').insert({ tenant_id: authed.tenantId, resource_id: resourceId, ...
```

(availability check: `.from('resource_bookings').select('id').eq('resource_id', resourceId).neq('status','cancelled')` — no tenant_id)
Impact: An authed user books against another tenant's resource UUID (blocking B's scheduling, since availability is cross-tenant) and probes any tenant's resource busy/free via the 409.
Fix: Verify resource_id belongs to req.tenantId before booking; add tenant_id to checkResourceAvailable.

### [P1] Public booking inserts resource_bookings with unvalidated resource_id, no availability check

File: apps/api/src/routes/booking-public.ts:465
Evidence:

```
if (resource_id) {
  void supabase.from('resource_bookings').insert({ tenant_id: tenantId, resource_id, ...
```

Impact: Any valid booking slug lets an unauthenticated caller book arbitrary cross-tenant resource UUIDs.
Fix: Validate resource_id belongs to the slug-resolved tenant and is active; run availability first.

### [P1] deals PUT unscoped users lookup + assigned_to_user_id accepted without tenant check

File: apps/api/src/routes/deals.ts:532
Evidence:

```
const { data: assignee } = await supabase
  .from('users').select('full_name').eq('id', newAssignedUserId).single()
```

Impact: Caller sets assigned_to_user_id to any UUID; a match in another tenant leaks that user's full_name cross-tenant into this tenant's activity log.
Fix: Add `.eq('tenant_id', authed.tenantId)` and reject out-of-tenant assignees (mirror conversations.ts:608).

### [P1] contacts bulk-assign / bulk/assign write body user FK without tenant validation

File: apps/api/src/routes/contacts.ts:954 (also :1556)
Evidence:

```
.from('contacts')
.update({ assigned_to_user_id: assignedTo.trim(), updated_at: new Date().toISOString() })
.eq('tenant_id', authed.tenantId).in('id', contactIds)
```

Impact: Any string (another tenant's users.id, or garbage) written into assigned_to_user_id for up to 500 contacts; single-contact update enforces the FK-tenant check but bulk does not. PATCH /bulk/assign also reads users unscoped (contacts.ts:1548).
Fix: Validate the assignee against users `.eq('tenant_id', authed.tenantId)` before the bulk update.

### [P1] Multiple SMS sends have no opt-in check or wrong (opt-out) shape

File: apps/api/src/routes/sms.ts:83, contacts.ts:1048 & 1214, quotes.ts:554, conversations.ts:510
Evidence (sms.ts:83, no opt-in selected at all):

```
.from('contacts').select('id, phone, full_name').eq('id', contactId).eq('tenant_id', authed.tenantId)
```

Evidence (contacts.ts:1048, opt-out shape):

```
if (!c.phone || c.sms_opt_in === false) continue
```

Impact: `sms_opt_in` is an OPT-IN boolean; skip must be `!== true`. Using `=== false` (or no check) sends to NULL-consent contacts — TCPA/consent violation. conversations.ts:510 additionally grants opt-in for null-consent contacts.
Fix: Select sms_opt_in and skip unless `sms_opt_in === true` on every send path.

### [P1] Bulk SMS endpoints have no smsSendLimiter / smsSendTenantLimiter

File: apps/api/src/routes/contacts.ts:981 (also :1177)
Evidence:

```
router.post('/bulk-sms', requireAuth, async (req: Request, res: Response): Promise<void> => {
```

Impact: Up to 500 outbound SMS/request bounded only by the 100/min IP limiter — Telnyx cost/blast abuse.
Fix: Apply smsSendLimiter + smsSendTenantLimiter.

### [P1] Outbound SMS "from" number sourced from locations.telnyx_number (banned)

File: quotes.ts:555 & 1126, appointments.ts:423, booking-public.ts:317, sms-webhooks.ts:160, provisioning.ts:92 (write path)
Evidence (quotes.ts:574):

```
from: location.telnyx_number,
```

Impact: Convention 3 requires telnyx_numbers.phone_number scoped by tenant_id (is_primary preferred). Reading/writing locations.telnyx_number risks sending from a stale/unprovisioned number; provisioning.ts writes ONLY to locations.telnyx_number so numbers never reach the canonical table (outbound-calls.ts:71 then 400s).
Fix: Read from and provision into telnyx_numbers.phone_number scoped by tenant_id.

### [P1] Stripe billing webhook writes raw Stripe status into tenant subscription_status enum

File: apps/api/src/routes/stripe-billing-webhooks.ts:223
Evidence:

```
const status = sub.status === 'trialing' ? 'trialing' : sub.status
```

(written at stripe-billing-webhooks.ts:228 `subscription_status: status`)
Impact: Stripe emits `incomplete_expired`, which is NOT a `subscription_status` enum label (verified prod Jul 8 2026) — writing it raw throws and the webhook 500s (Stripe then retries indefinitely). `incomplete` and `unpaid` ARE valid labels, so those pass, but the pass-through also lets Stripe's `canceled` land alongside the enum's polluted `cancelled` (2L) duplicate; code must write only `canceled` (1L). No allow-list guards any of this.
Fix: Map `sub.status` through an explicit allow-list to the sanctioned labels (`trialing|active|past_due|canceled|unpaid|incomplete`), collapsing `incomplete_expired`→`canceled` and normalizing to single-L `canceled`, before any write.

### [P1] Two-identity: NextAuth sub written into uuid FK → users(id) columns

File: multiple — smart-lists.ts:56 (created_by), push-mobile.ts:34 (user_id NOT NULL), import.ts:117 (created_by_user_id), attachments.ts:105 (uploaded_by_user_id), data-export.ts:77 (requested_by), saved-views.ts:78 (user_id), chat-agent.ts:136 (sender_id), tasks.ts:121 (created_by_user_id), email-integrations.ts:215 (user_id NOT NULL), inventory.ts:166 & 370 (activity actor_id)
Evidence (smart-lists.ts:56):

```
filters,
created_by: authed.userId,
```

Impact: These columns are `uuid REFERENCES users(id)` (migrations 0065, 0042, 0025, 0027, 0110-export, 0024, 0029, 0023). `authed.userId` is the NextAuth `sub`, not public.users.id (that is `appUserId`). Web-token inserts either fail the FK (500) or corrupt attribution; NOT-NULL columns (mobile_push_tokens, user_email_accounts) hard-fail.
Fix: Write `authed.appUserId` (null-guarded) on all these paths.

### [P1] Mobile JWT puts public.users.id in `sub` and omits appUserId claim

File: apps/api/src/routes/mobile-auth.ts:65
Evidence:

```
const token = await new SignJWT({
  sub: user.id,
  email: user.email,
```

Impact: requireAuth resolves appUserId from `payload.appUserId` or `WHERE authjs_user_id = sub` (auth.ts:113,48). Mobile `sub` is public.users.id, not an authjs id → `req.appUserId` is null for every mobile session and `req.userId` silently changes identity space between web and mobile, corrupting every write that uses either value.
Fix: Add explicit `appUserId: user.id` claim and set `sub` to the account's authjs_user_id.

### [P1] Automation scanner retry/clear act on global BullMQ queues, no tenant partition

File: apps/api/src/routes/automation-overview.ts:211
Evidence:

```
const failedJobs = await q.getFailed(0, -1)
for (const job of failedJobs) { await job.retry() }
```

Impact: Queues are keyed by scanner name only; any authed tenant with the automation plan can retry/clear (`q.clean`, :240) every other tenant's failed jobs — cross-tenant control-plane action.
Fix: Filter jobs by payload tenantId === authed.tenantId, or move to admin-only.

### [P1] custom-automations /generate + brand-voice /preview: AI endpoints without aiGenerationLimiter

File: apps/api/src/routes/custom-automations.ts:37 (also brand-voice.ts:149)
Evidence:

```
router.post('/generate', requireAuth, async (req: Request, res: Response): Promise<void> => {
```

Impact: LLM-backed endpoints bounded only by the 100/min IP limiter → paid-model cost abuse (chat-public.ts uses aiGenerationLimiter for the same class).
Fix: Add aiGenerationLimiter.

### [P1] Gift card redeem is non-atomic (double-spend race)

File: apps/api/src/routes/gift-cards.ts:100
Evidence:

```
if (card.balance_cents < amount_cents) { res.status(400)...; return }
const new_balance_cents = card.balance_cents - amount_cents
```

Impact: Concurrent redeems both pass the check and both write → card redeemed beyond balance (financial loss).
Fix: Atomic decrement (`UPDATE … SET balance_cents = balance_cents - $x WHERE id = $id AND balance_cents >= $x`, verify affected rows).

### [P1] Gift card creation accepts purchased_by_contact_id from body without tenant check

File: apps/api/src/routes/gift-cards.ts:55
Evidence:

```
recipient_email: recipient_email ?? null,
purchased_by_contact_id: purchased_by_contact_id ?? null,
```

Impact: Links a gift card to another tenant's contact UUID (cross-tenant FK write).
Fix: Verify contact `.eq('tenant_id', authed.tenantId)` before insert.

### [P1] provisioning upgrade-to-suite grants all modules with no plan verification

File: apps/api/src/routes/provisioning.ts:214
Evidence:

```
.from('tenants').update({ product: 'suite', modules: { maya: true, ...
```

Impact: Any tenant owner flips to product 'suite' with every module enabled, bypassing plan-tier entitlement (no Stripe/plan check).
Fix: Gate the grant on the tenant's actual subscription_plan or drive it only from the verified Stripe webhook.

### [P1] Webhook subscriptions: no RBAC + no SSRF/URL restriction on tenant-data egress

File: apps/api/src/routes/webhooks.ts:26 (regex :23)
Evidence:

```
const URL_REGEX = /^https?:\/\/.+/
...
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
```

Impact: Any staff-role user registers an arbitrary URL (incl. http:// internal/metadata) to receive call/contact/appointment payloads — exfiltration + SSRF channel.
Fix: requireRole('owner','admin'); require https; deny private/loopback/link-local hosts at dispatch.

### [P1] Payment-link creation (live Stripe objects): no RBAC, no route limiter

File: apps/api/src/routes/payment-links.ts:42
Evidence:

```
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
```

Impact: Any staff-role token mints unlimited live Stripe Prices/Payment Links, bounded only by the 100/min IP limiter.
Fix: requireRole('owner','admin') on POST/DELETE + a route-specific limiter.

### [P1] Telnyx-number CRUD has no RBAC

File: apps/api/src/routes/telnyx-numbers.ts:34 (also :102, :180, :230)
Evidence:

```
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
```

Impact: Any authed member registers/re-routes (forwarding_number)/disables/deletes the tenant's phone numbers; the comparable provisioning endpoint requires owner/admin.
Fix: requireRole('owner','admin') on the four mutating handlers.

### [P1] Public tenant-signup returns raw DB error detail to unauthenticated caller

File: apps/api/src/routes/tenants.ts:130
Evidence:

```
res.status(500).json({ error: 'Failed to create tenant', detail: tenantError?.message })
```

Impact: Anonymous POST /api/tenants (authLimiter only) leaks internal schema/constraint details.
Fix: Drop `detail` from the client response; keep it in console.error only.

### [P1] Email send (Gmail/Outlook) has no route-specific limiter and no shouldSuppressEmail()

File: apps/api/src/routes/email-integrations.ts:399 (suppression gap :419)
Evidence:

```
router.post('/send/:contactId', requireAuth, async (req: Request, res: Response): Promise<void> => {
```

Impact: Outbound email through the user's mailbox bounded only by the IP limiter (SMS path has dedicated limiters), and no suppression check (convention 4) so unsubscribed/suppressed contacts still get mailed.
Fix: Add a per-tenant/per-user send limiter and call shouldSuppressEmail() before sending.

### [P1] Settings mutations without RBAC (webchat, portal enable/disable, review-automation, booking, maya-settings, bcc-logging)

File: webchat.ts:358, portal.ts:229 & 257, review-settings.ts:48, booking-settings.ts:75, maya-settings.ts:100, email-inbound.ts:54
Evidence (webchat.ts:358):

```
webchatSettingsRouter.put('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
```

Impact: Any authenticated role can toggle the public webchat widget / customer portal exposure, rewrite customer-facing SMS templates, change the public booking slug, and rotate the tenant BCC address — all tenant-level operations that subscriptions.ts/tenants.ts gate with owner/admin.
Fix: Add requireRole('owner','admin') to these settings mutations.

### [P2] Public chat/webchat init accept raw tenant_id from client body

File: apps/api/src/routes/chat-public.ts:20 (also webchat.ts:24)
Evidence:

```
const { tenantId } = req.body as { tenantId?: string }
```

Impact: Convention 9's public-route rule requires flagging raw client tenant_id; any caller who learns a tenants.id UUID enumerates widget config and opens sessions for any widget-enabled tenant. webchat also attaches an arbitrary (cross-tenant) location_id.
Fix: Resolve tenant from a dedicated public widget key/slug; validate location_id in-tenant.

### [P2] Outlook OAuth callback trusts unsigned client `state` as tenant id

File: apps/api/src/routes/calendar-settings.ts:285
Evidence:

```
const parsed = JSON.parse(decoded) as { tenantId: string }
tenantId = parsed.tenantId
```

Impact: `state` is plain base64 JSON with no HMAC/nonce; the public callback writes encrypted Outlook tokens onto whatever tenantId the state names — a forged callback attaches an attacker mailbox to another tenant (login-CSRF).
Fix: Sign `state` (HMAC) or bind a one-time nonce to the initiating session and verify it.

### [P2] custom_webhook trigger action performs server-side POST to arbitrary tenant URL (SSRF)

File: apps/api/src/routes/trigger-links.ts:363
Evidence:

```
const webhookUrl = config['webhook_url'] as string | undefined
if (webhookUrl) { await fetch(webhookUrl, { method: 'POST', ...
```

Impact: `webhook_url` comes from tenant-set action_config with no host/scheme allow-list; fires from the public `/t/:slug` handler → SSRF against internal/metadata hosts. Also awaited without the 2s timeout (convention 8), blocking the public redirect.
Fix: Allow-list https + block private ranges; wrap in Promise.race 2s / AbortController.

### [P2] Contacts merge reassigns child records by contact_id only, no tenant_id

File: apps/api/src/routes/contacts.ts:826
Evidence:

```
supabase.from('activity_log').update({ contact_id: primaryId }).eq('contact_id', secondaryId),
supabase.from('tasks').update({ contact_id: primaryId }).eq('contact_id', secondaryId),
```

Impact: Both contacts are tenant-verified so exploit surface is low today, but the child updates and the primary update (contacts.ts:817) match on id alone, deviating from the tenant-scoping invariant.
Fix: Add `.eq('tenant_id', authed.tenantId)` to primary and child updates.

### [P2] campaign_recipients webhook update matched by id only (no tenant scope)

File: apps/api/src/routes/email-webhooks.ts:170
Evidence:

```
let query = supabase.from('campaign_recipients').update(recipientUpdate).eq('id', campaignRecipientId)
```

Impact: campaignRecipientId comes from a Resend tag and the update is not constrained to the resolved tenant; a mis-tagged/forged-tag event could mutate another tenant's recipient row.
Fix: Add `.eq('tenant_id', tenantId)`.

### [P2] Public unsubscribe HMAC degrades to empty key when AUTH_SECRET unset

File: apps/api/src/routes/digest.ts:23
Evidence:

```
export function signDigestToken(tenantId: string): string {
  const secret = process.env['AUTH_SECRET'] ?? ''
```

Impact: The tenants update (digest.ts:59) is keyed by tenantId from req.query; with the `?? ''` fallback a misconfigured deploy lets anyone forge tokens and disable any tenant's digests (unauthenticated cross-tenant mutation).
Fix: Fail hard when AUTH_SECRET is unset instead of defaulting to ''.

### [P2] GBP OAuth tokens stored in plaintext

File: apps/api/src/routes/reputation.ts:127
Evidence:

```
access_token: tokens.access_token,
refresh_token: tokens.refresh_token,
```

Impact: gbp_connections holds raw Google tokens at rest while email-integrations encrypts the equivalent — inconsistent, higher blast radius on a DB leak.
Fix: Encrypt with the existing encryptToken()/decrypt helpers.

### [P2] portal_access tokens created without expires_at and reused indefinitely

File: apps/api/src/routes/portal.ts:333
Evidence:

```
const newToken = randomBytes(32).toString('hex')
const { data: newAccess, error } = await supabase.from('portal_access').insert({ tenant_id: authed.tenantId, ...
```

Impact: /verify and /data enforce expiry only "if expires_at" (portal.ts:41,85), so invite magic-link tokens (sent in URL query strings) never expire and are re-sent verbatim.
Fix: Set expires_at on insert; rotate on re-invite.

### [P2] Missing module/plan gate on several feature areas

File: reputation.ts:27, subscriptions.ts:24, resources.ts:19, portal.ts, webchat settings, conversations.ts (SMS send)
Evidence (reputation.ts:27):

```
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
```

Impact: staff.ts gates every route behind 'crm'; these feature areas apply no requireModule/requirePlan, so lapsed-subscription tenants keep using them (and can send cost-bearing SMS via conversations /:contactId/send with no plan gate).
Fix: Apply requireModule/requirePlan at each mount + smsSendTenantLimiter on the conversations send.

### [P2] Shadowed / unreachable routes

File: contacts.ts:1452 (PATCH /bulk/lifecycle), saved-views.ts:180 (PUT /reorder)
Evidence (saved-views.ts:98 before :180):

```
router.put('/:id', requireAuth, ...   // matches "reorder" as :id
```

Impact: `/bulk/lifecycle` and `/reorder` are registered after the parameterized `/:id` routes, so Express always matches `/:id` and these handlers are dead code (404).
Fix: Register literal routes before `/:id`.

### [P2] audit-log endpoint selects columns that do not exist

File: apps/api/src/routes/audit-log.ts:34
Evidence:

```
.select('id, created_at, action, resource_type, entity_id, actor_type, actor_id, ip_address, metadata', { count: 'exact' })
```

Impact: audit_log (migration 0010) has `user_id, resource_id, details` — no entity_id/actor_type/actor_id/metadata — so this owner/admin endpoint always errors (500); `ilike('entity_id', …)` at :43 too.
Fix: Select the real columns or migrate the table.

### [P2] Email webhook stores raw Buffer as raw_payload

File: apps/api/src/routes/email-webhooks.ts:133
Evidence:

```
raw_payload: req.body,
```

Impact: With express.raw upstream, req.body is a Buffer, so raw_payload persists as `{"type":"Buffer","data":[...]}` — corrupt audit column. Parsed `body` is available at :61.
Fix: Store parsed `body` (or `req.body.toString('utf8')`).

### [P2] Signed stream URL falls back to tenantId 'unknown' from in-memory Map

File: apps/api/src/routes/voice-outbound.ts:172
Evidence:

```
const meta = outboundWebhookMeta.get(callControlId)
const signedStreamUrl = buildSignedStreamUrl(streamUrl, meta?.tenantId ?? 'unknown', callControlId)
```

Impact: outboundWebhookMeta is a per-process 30-min Map; on multi-instance/after-expiry the VOICE-01 stream token signs for tenant 'unknown', breaking or weakening the tenant binding.
Fix: Resolve tenantId from the outbound_call_jobs row already fetched at :145.

### [P2] Inbound-email shared secret accepted via query string

File: apps/api/src/routes/email-inbound.ts:94
Evidence:

```
const fromQuery = typeof req.query['secret'] === 'string' ? req.query['secret'] : undefined
```

Impact: URL-borne secret is persisted in proxy/access logs; leakage lets anyone inject email_messages/activity into any tenant whose bcc address they know.
Fix: Accept the x-inbound-secret header only (or per-tenant tokens).

### [P2] Public/enumeration rate-limit gaps (booking availability, gift-card redeem, referral signup, digest send-test, lead-scoring rescore-all, review-request track, /admin)

File: booking-public.ts:139, gift-cards.ts:74, referrals.ts:207, digest.ts:111, lead-scoring.ts:181, review-requests.ts:54, admin.ts:8
Evidence (gift-cards.ts:74):

```
router.post('/redeem', requireAuth, async (req: Request, res: Response): Promise<void> => {
```

Impact: Each is bounded only by the 100/min IP limiter (or none, for /admin which mounts before generalLimiter): Google-quota exhaustion, gift-card code probing, referral counter inflation, digest-email spam, bulk-rescore self-DoS, review-funnel skew, and admin-key brute-force.
Fix: Attach dedicated limiters (giftCardBalanceLimiter, triggerLinkLimiter-style, bookingLimiter) and a strict IP limiter before requireAdminKey.

### [P2] Client-supplied FK ids inserted without in-tenant validation (appointments, deals, invoices, tasks PUT, resources /book)

File: appointments.ts:335, deals.ts:383, invoices.ts:376, tasks.ts:195, resources.ts:375
Evidence (tasks.ts:195):

```
if (typeof b['contact_id'] === 'string') updates['contact_id'] = b['contact_id']
```

Impact: location_id/assigned_user_id/contact_id/company_id/pipeline_stage_id/appointment_id written from req.body without a tenant-ownership check → cross-tenant reference injection (and PII read-back via joins). POST paths sometimes validate; the matching PUT often does not.
Fix: Tenant-scoped existence check on each referenced id before insert/update.

### [P2] locations.telnyx_number readable and writable via the locations API

File: apps/api/src/routes/locations.ts:22 & 63
Evidence:

```
'id, name, ... telnyx_number, ...'    // select :22
telnyx_number: (b['telnyx_number'] as string) || null,   // write :63
```

Impact: Convention 3 names any locations.telnyx_number use as a finding; POST additionally lets any authed user write an arbitrary from-number (PUT does not accept it — inconsistent).
Fix: Stop selecting/accepting the column here; manage numbers only via telnyx_numbers.

### [P2] sms-health opted-out count uses opt-out shape

File: apps/api/src/routes/sms-health.ts:87
Evidence:

```
.eq('tenant_id', authed.tenantId).eq('sms_opt_in', false),
```

Impact: NULL-consent contacts (never opted in) are excluded, so total_opted_out undercounts — misrepresents compliance posture.
Fix: Count where sms_opt_in is not true.

### [P2] send-now re-enqueues mass sends with no status guard

File: apps/api/src/routes/campaigns.ts:903
Evidence:

```
if (!campaign.subject) { res.status(400)...; return }   // no status check
```

Impact: A campaign already 'sending'/'sent' can be re-triggered (general limiter only), enqueuing duplicate campaign-send jobs → duplicate emails unless the worker dedupes.
Fix: Reject unless status ∈ {draft, scheduled}, mirroring the schedule handler.

### [P2] Public accept/decline endpoints have no status guard

File: apps/api/src/routes/quotes.ts:1074 (invoices public analogous)
Evidence:

```
await supabase.from('quotes').update({ status: 'accepted', accepted_at: new Date().toISOString() }).eq('id', quote.id)
```

Impact: share_token exists from creation, so /view/:token/accept transitions any quote (draft, declined, pending-approval) to accepted, firing owner SMS/push, inventory deduction, receipt email; repeatable.
Fix: Reject accept/decline unless current status ∈ {sent, viewed}.

### [P2] billing checkout passes NextAuth sub to supabase.auth.admin.getUserById

File: apps/api/src/routes/billing.ts:149
Evidence:

```
const { data: userRes } = await supabase.auth.admin.getUserById(authed.userId)
```

Impact: authed.userId is the NextAuth sub, not a Supabase Auth id, so the billing_email fallback silently never resolves (error swallowed).
Fix: Look email up from public.users via appUserId, or drop the fallback.

### [P2] Public webchat/portal contact rename via booking confirm

File: apps/api/src/routes/booking-public.ts:341
Evidence:

```
await supabase.from('contacts').update({ full_name: fullName }).eq('id', contactId).eq('tenant_id', tenantId)
```

Impact: Anyone knowing a phone/email of an existing contact in a tenant with a public booking page can overwrite that contact's full_name (bookingLimiter only).
Fix: Backfill full_name only when currently empty, or store the submitted name on the appointment.

### [P3] Public quote view returns full row (select \*) incl. internal fields

File: apps/api/src/routes/quotes.ts:948
Evidence:

```
res.json({ ...quote, line_items: items ?? [], business_name: tenant?.name ?? '', square_info: squareInfo })
```

Impact: tenant_id, signed_ip, signature_data, followup_job_id, approval_status/note, created_by, share_token exposed to any link holder.
Fix: Select and return an explicit public column list.

### [P3] Public invoice/quote routes serve draft/void statuses

File: apps/api/src/routes/invoices.ts:784
Evidence:

```
.eq('share_token', req.params['token']).single()
```

Impact: share_token exists from creation, so a draft/voided invoice is viewable by anyone holding the token before it was ever "sent".
Fix: Restrict the public route to sent/due/overdue/received statuses.

### [P3] Fabricated Google Meet fallback link stored/sent

File: apps/api/src/routes/appointments.ts:383
Evidence:

```
const fallbackLink = `https://meet.google.com/${aid.slice(0,3)}-${aid.slice(3,7)}-${aid.slice(7,11)}`
```

Impact: When video is enabled but no calendar is connected, a non-functional meet.google.com URL built from the appointment UUID is surfaced as a real link.
Fix: Store null video_link instead.

### [P3] Naive-UTC booking start time when calendar not connected

File: apps/api/src/routes/booking-public.ts:432
Evidence:

```
startIso = `${date}T${startTime}:00.000Z`
```

Impact: Appointment stored shifted by the tenant's UTC offset — silent time corruption.
Fix: Convert date+time using the tenant/location timezone before storing.

### [P3] media-library upload buffers full body before the size guard

File: apps/api/src/routes/media-library.ts:28
Evidence:

```
req.on('data', (chunk: Buffer) => chunks.push(chunk))
req.on('end', async () => { const body = Buffer.concat(chunks); if (body.length > MAX_SIZE_BYTES) {
```

Impact: The 10MB check runs after full in-memory buffering — minor memory-pressure DoS.
Fix: Abort the stream once accumulated length exceeds MAX_SIZE_BYTES.

### [P3] Debug/diagnostic logging left in production

File: contacts.ts:455, conversations.ts:384, tasks.ts:123
Evidence (conversations.ts:384):

```
// TEMP DIAGNOSTIC — remove after appUserId debug
console.info('[DIAG appUserId] resolve-handler', { authedAppUserId: authed.appUserId })
```

Impact: console.info/error (not banned console.log) but ships debug noise — tasks.ts:123 logs the full insert payload at error level on every POST.
Fix: Remove the diagnostic blocks.

### [P3] Additional low-severity items

- calls.ts:242 POST /api/calls/initiate is a stub returning `success:true` with no call placed.
- calls.ts:146 /metrics contacts `.in('id', ...)` lacks tenant_id (ids from tenant-scoped voice_sessions — defense-in-depth).
- square.ts:42 OAuth scope `'PAYMENTS_WRITE+ORDERS_READ+...'` — URLSearchParams encodes `+` as %2B (should be spaces).
- billing.ts:202 & 244 return raw Stripe error messages to clients.
- referrals.ts:157 & 220 read-modify-write counters (lost updates) and /track ignores code status.
- companies.ts:170 empty-update PUT surfaces a 500 instead of 400.
- telnyx-numbers.ts:90 duplicate-number 409 is a cross-tenant existence oracle.
- sms.ts:139 /read returns `updated:0` always (missing `{count:'exact'}`).
- staff.ts:89 DB value interpolated into `.or()` filter string (not injectable today).
- resources.ts:207 PUT skips the enum validation POST enforces.
- google-reserve.ts:89 audit_log.user_id (text) receives NextAuth sub (no FK corruption, but inconsistent actor identity — same pattern in caller-memory.ts:138, import.ts:98, chat-agent.ts:160, attachments.ts:123, sms.ts:123).
- CORS `origin:'*'` at /api/chat prefix (index.ts:254) also applies to authed /api/chat/sessions (Bearer-auth, so limited impact).

## Unmounted Route Files

Two files exist under routes/ but are not imported in index.ts — both are **pure helper modules, not routers** (no Express, no Supabase), correctly unmounted:

- `apps/api/src/routes/staff-logic.ts` — exports DATE_RE, TIME_RE, detectShiftConflict, validateShiftBody, validateStaffCreateBody. Imported by staff.ts:6 and its test.
- `apps/api/src/routes/inventory-logic.ts` — exports VALID_UNITS, Unit, validateInventoryCreate, applyQuantityAdjustment. Imported by inventory.ts:7 and its test.

No dead/orphaned router files found. Every router imported in index.ts is mounted.

## Convention Sweep (repo-wide, routes + middleware)

Clean across all routes/middleware (verified by direct grep):

- **console.log** — zero occurrences (only console.info/warn/error).
- **Clerk** — zero imports/env/comments/types. Fully removed.
- **contacts.first_name/last_name as columns** — only two real query violations (campaigns.ts:1028/1115, email-templates.ts:85, all P1 above); other hits are `{{first_name}}` template tokens (review-settings.ts) which are not column refs.
- **subscription_status enum spellings** — corrected against verified prod (Jul 8 2026): the enum is POLLUTED — both `canceled` (1L) and `cancelled` (2L) exist as labels, and `incomplete` IS a valid label. `incomplete_expired` is NOT a label (Stripe emits it; writing raw throws). So code must WRITE only `canceled` (1L) and must pass Stripe status through an allow-list; reads/compares must not assume one spelling. The genuine issue is stripe-billing-webhooks.ts:223 raw pass-through (P1 above, now covers the `incomplete_expired` throw). stripe-webhooks.ts:56-62 writes client_subscriptions.status (own CHECK enum, migration 0098), NOT the tenant enum — not a convention violation. Enum cleanup (drop `cancelled`, `incomplete`) is a deferred migration.

## Summary Counts

- **P0: 3** — trigger-links cross-tenant appointment mutation; insights pipeline-funnel and pipeline-forecast cross-tenant pipeline_stages read.
- **P1: 33** — missing RBAC on financial/settings/phone endpoints; cross-tenant resource booking; unvalidated body FKs enabling PII read; two-identity sub→FK writes across 10+ files; mobile JWT identity mismatch; SMS opt-in/from-number convention breaks; missing AI/SMS rate limiters; global BullMQ queue control; stripe-billing raw status enum corruption; SSRF via webhooks/payment-links; first_name/last_name broken queries.
- **P2: ~24** — unsigned OAuth state; SSRF via trigger custom_webhook; raw client tenant_id on public chat/webchat init; missing module/plan gates; shadowed routes; audit-log wrong columns; rate-limit gaps; unscoped merge/webhook updates; plaintext GBP tokens; non-expiring portal tokens; client FK injection on PUT paths.
- **P3: ~20** — public row over-exposure, status-guard gaps, fabricated meet links, naive-UTC times, debug logging, counter races, stub endpoint, style/consistency items.

Notes / limits:

- Route handler internals were read in full; shared lib helpers (email-client suppression, embeddings tenant-scoping, activity.ts actor column write, url-crawler SSRF) were NOT audited — flagged where a finding depends on them.
- Two-identity FK writes CONFIRMED (verified prod Jul 8 2026): `public.users.authjs_user_id <> id` on live rows, and `authed.userId` = `authjs_user_id`, `authed.appUserId` = `id`. So every `authed.userId`→FK write listed in the P1 cluster is a real corruption/FK-failure, not a hypothetical. Mobile JWT is inverted (sets `sub = users.id`, omits appUserId claim) — pending fix; this is why mobile-token writes to those columns currently "work" while web-token writes fail.
