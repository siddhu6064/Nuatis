# Nuatis Dead-Code & Duplication Audit — 2026-06-12

**Report-only pass. Nothing was deleted, moved, or refactored.** Raw tool output lives in `./audit-tmp/` (throwaway, do not commit). Tooling: knip 5 (with `./knip.json` workspace config), ts-prune, depcheck, madge, jscpd, `tsc --noUnusedLocals --noUnusedParameters`, plus manual grep/agent passes.

Confidence tiers:

- **SAFE** — zero references proven by grep (count given), not an entry point, not on the INTENTIONAL list.
- **REVIEW** — likely dead but carries dynamic-ref / deploy-by-name / test-seam / judgment risk.
- **INTENTIONAL** — flagged by a tool but load-bearing; reason given.

---

## Summary table

| Category                                 | apps/api                            | apps/web | apps/mobile | packages/shared |
| ---------------------------------------- | ----------------------------------- | -------- | ----------- | --------------- |
| Unused files (SAFE)                      | 0                                   | 3        | 0           | 0               |
| Unused files (REVIEW)                    | 2 (+2 supabase fns)                 | 0        | 0           | 0               |
| Unused exports/types (SAFE)              | 20                                  | 5        | 1           | 0               |
| Unused exports (REVIEW, test-seam)       | 16                                  | 2        | 0           | 1               |
| Unused shared type exports (REVIEW)      | —                                   | —        | —           | 107             |
| Unused deps (SAFE)                       | 1                                   | 0        | 0           | 0               |
| Unused deps (INTENTIONAL/false-positive) | 0                                   | 3        | 2           | 0               |
| Unlisted (missing) deps                  | 3                                   | 1        | 0           | 1               |
| Duplicate blocks (jscpd clones)          | ~150                                | ~140     | 0           | ~10             |
| Duplicate functions (semantic groups)    | 5 groups                            | 2 groups | 0           | —               |
| Dead branches / unreachable              | 0                                   | 0        | 0           | 0               |
| Commented-out code blocks                | 0                                   | 0        | 0           | 0               |
| Stale TODOs                              | 1                                   | 2        | 0           | 0               |
| Unused/mismatched env vars               | 3 mismatched, ~20 no-setter-in-repo | —        | —           | —               |
| Circular deps                            | 2                                   | 0        | 0           | 0               |
| Complexity review (files >400 lines)     | 25                                  | 47       | 1           | 2               |
| Complexity review (functions >60 lines)  | ~45                                 | ~55      | 0           | ~4              |
| Unused locals/params (tsc, SAFE)         | 2                                   | 1        | 0           | 0               |

**Total SAFE: apps/api 23 · apps/web 9 · apps/mobile 1 · packages/shared 0 = 33**

---

## 1. Unused files

### SAFE (zero references proven)

| Path                                               | What                               | References                                                                                                                  | Recommendation |
| -------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `apps/web/src/components/contacts/SavedViews.tsx`  | Saved-views UI component           | 0 (grep `SavedViews` across all apps: only self)                                                                            | Remove         |
| `apps/web/src/lib/auth/types.ts`                   | Auth type defs                     | 0 (grep `auth/types` in apps/web: none)                                                                                     | Remove         |
| `apps/web/src/app/(dashboard)/pipeline/actions.ts` | Server action `updateContactStage` | 0 (grep `updateContactStage` + `pipeline/actions`: none; the one `./actions` import is appointments/new's own actions file) | Remove         |

### REVIEW

| Path                                                      | What                                                                          | Why flagged                                                                            | Risk                                                                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `apps/api/src/voice/telnyx-setup.ts`                      | Manual ops script — header says `Run with: npx tsx src/voice/telnyx-setup.ts` | 0 imports (knip, madge orphan)                                                         | Manual-run tool, not dead. Keep or move to `scripts/`.                                                   |
| `apps/api/src/voice/test-gemini.ts`                       | Manual Gemini Live smoke test (`dotenv/config` + console run)                 | 0 imports (grep `test-gemini`: only the unrelated string `'test-gemini-key'` in tests) | Manual smoke script. Decide: keep, move to `scripts/`, or delete.                                        |
| `supabase/functions/notify-waitlist/index.ts` (143 lines) | Waitlist email edge function                                                  | Not imported by code (expected — deployed by name)                                     | **Duplicate pair** with below. One of these is stale.                                                    |
| `supabase/functions/waitlist-notify/index.ts` (72 lines)  | Same job, different implementation (adds HTML-escape `esc()`)                 | Same                                                                                   | Check which name is actually deployed (`supabase functions list`), delete the other. Do NOT remove both. |

Madge "orphans" in `apps/api/src/scripts/seed-*.ts` are manual seed scripts (entry points) — not dead. `apps/web` orphans are all App Router files — entry points by definition.

---

## 2. Unused exports

### SAFE — zero references anywhere (including tests); remove `export` keyword or the symbol if also unused in-file

apps/api (grep ref count = 0 for every row, whole repo, tests included):
| Location | Symbol |
|---|---|
| `apps/api/src/routes/quotes.ts:1989` | `calcTotals` |
| `apps/api/src/lib/calendar-provider.ts:108` | `checkCalendarAvailability` |
| `apps/api/src/lib/calendar-provider.ts:141` | `createCalendarAppointment` |
| `apps/api/src/lib/email-templates.ts:14` | `resolveMergeTags` |
| `apps/api/src/lib/square-client.ts:153` | `getSquarePayment` |
| `apps/api/src/lib/gbp-sync.ts:162` | `generateAiReply` |
| `apps/api/src/voice/gemini-live.ts:91` | `containsFarewell` |
| `apps/api/src/voice/pre-call-lookup.ts:27` | `enrichCallerInfo` |
| `apps/api/src/services/embeddings.ts:45` | `generateEmbedding` |
| `apps/api/src/services/google.ts:3` | `getOAuthClient` |
| `apps/api/src/lib/contact-enrichment.ts:105` | `enrichByPhone` |
| `apps/api/src/lib/contact-enrichment.ts:133` | `enrichByEmail` |
| `apps/api/src/lib/email-oauth.ts:85` | `refreshGmailToken` |
| `apps/api/src/lib/email-oauth.ts:130` | `refreshOutlookToken` |
| `apps/api/src/lib/email-oauth.ts:6` | `EmailAccount` (type — note: apps/web re-declares its own local `EmailAccount` interface; see §7) |
| `apps/api/src/lib/expo-push.ts:23` | `sendExpoPush` (pairs with unused `expo-server-sdk` dep, §4) |
| `apps/api/src/lib/receipt-email.ts:3` | `ReceiptLineItem` (type) |
| `apps/api/src/lib/report-engine.ts:7` | `ReportFilter` (type — web re-declares locally) |
| `apps/api/src/lib/email-client.ts:4` | `EmailAttachment` (type) |
| `apps/api/src/routes/campaigns-prereq.ts:14` | `PrereqCheck` (type) |

apps/web:
| Location | Symbol | References |
|---|---|---|
| `apps/web/src/components/crm/index.ts:1` | `VerticalFieldRenderer` re-export | 0 via barrel (demo page imports the component file directly; barrel itself IS used for `VerticalSelector`) |
| `apps/web/src/components/crm/index.ts:3` | `VerticalSwitcher` re-export | 0 via barrel (same) |
| `apps/web/src/app/(dashboard)/dashboard/DashboardClient.tsx:77` | `StatItem` (type) | 0 |
| `apps/web/src/components/ColumnsButton.tsx:4` | `ColumnDef` (type) | 0 |
| `apps/web/src/components/staff/types.ts:1` | `DayAvailability` (type) | 0 |

apps/mobile:
| Location | Symbol | References |
|---|---|---|
| `apps/mobile/lib/api.ts:51` | `apiDelete` | 0 |

### REVIEW — referenced ONLY by tests (test-seam exports; removing breaks tests, keeping is intentional-ish)

| Location                                                   | Symbol(s)                                                                                   | Note                                                                                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/routes/inventory-logic.ts`                   | `validateInventoryCreate`, `applyQuantityAdjustment`, `VALID_UNITS`, `Unit`                 | ⚠️ See §7 — `routes/inventory.ts:10` carries its own LOCAL copies; tests exercise the extracted file, the route runs its private copy. Drift risk.                                           |
| `apps/api/src/routes/staff-logic.ts`                       | `detectShiftConflict`, `validateShiftBody`, `validateStaffCreateBody`, `DATE_RE`, `TIME_RE` | ⚠️ Same pattern — `routes/staff.ts:9-10,339` has local duplicates.                                                                                                                           |
| `apps/api/src/lib/email-risk.ts:103`                       | `getRiskLabel`                                                                              | test-only (6 test refs)                                                                                                                                                                      |
| `apps/api/src/routes/invoices.ts:673,735`                  | `processRecordPayment`, `processVoidInvoice`                                                | test-only                                                                                                                                                                                    |
| `apps/api/src/routes/subscriptions.ts:319,333,374`         | `calcMonthlyEquivalent`, `processPauseSubscription`, `getSubscriptionsForTenant`            | test-only                                                                                                                                                                                    |
| `apps/api/src/services/scheduling.ts:18`                   | `getAvailableSlots`                                                                         | test-only                                                                                                                                                                                    |
| `apps/api/src/voice/tenant-helpers.ts:10`                  | `getTenantBusinessName`                                                                     | test-only                                                                                                                                                                                    |
| `apps/api/src/lib/outlook-calendar.ts:102`                 | `refreshOutlookCalendarToken`                                                               | 1 test ref only                                                                                                                                                                              |
| `apps/api/src/voice/maya-circuit-breaker.ts:30,182,14`     | `TOOL_TIMEOUT_MS`, `_setMayaCircuitBreaker`, `BreakerState`                                 | 0 refs found even in tests; `_set` prefix suggests test hook for recently shipped circuit breaker. Confirm with author before removing.                                                      |
| `apps/api/src/routes/__test-support__/jwt.ts:14-15`        | `TEST_JWT_ISSUER`, `TEST_JWT_AUDIENCE`                                                      | test infrastructure                                                                                                                                                                          |
| `apps/api/src/routes/__test-support__/supabase-mock.ts:25` | `StorageMock` (type)                                                                        | test infrastructure                                                                                                                                                                          |
| `apps/web/src/lib/auth/authjs.ts:174-175`                  | `signIn`, `signOut`                                                                         | NextAuth v5 destructure idiom (`const { handlers, auth, signIn, signOut } = NextAuth(...)`). Client code uses `next-auth/react` instead. Server-side pair currently unused but conventional. |
| `apps/mobile/lib/api.ts:53`                                | `API_URL`                                                                                   | used in module (ts-prune); export keyword unused                                                                                                                                             |

### packages/shared — `buildTriggerUrl` (REVIEW)

`packages/shared/src/lib/trigger-links.ts:1` `buildTriggerUrl` — non-test references are only COMMENTS in `apps/api/src/lib/sms-templates.ts:66-67` ("Import buildTriggerUrl from '@nuatis/shared'") plus test usage. Intended public API per the comment; keep or wire up.

---

## 3. Unused shared type exports — `packages/shared/src/types/index.ts` (REVIEW, 107 symbols)

Knip flagged ~150 type exports. Grep verification of import statements across apps/api, apps/web, apps/mobile:

**USED (27) — knip false positives** (knip resolved `@nuatis/shared` to `dist/`, missing src-level usage): `ConversationsWsEvent, DayHours, ServiceEntry, StaffEntry, FaqEntry, BusinessProfile(6), Review, ReputationStats, GbpInsights, ScannerPause, ScannerStatus, AutomationOverview, SmsDeliveryError, SmsHealthStats, EmailHealthStats, WeeklyDigestData, CampaignRecipientStatus, Campaign, CampaignStats, BrandVoice(6), MayaKbUrl, GeneratedAutomation, CustomAutomation, ResourceAvailabilitySlot, VERTICALS(17), PipelineStageConfig, FollowUpStep`. Also `VERTICAL_SLUGS`, `getVertical`, `seedInventory`, `seedStaff` (all used in `apps/api/src/routes/tenants.ts`) — knip false positives, keep.

**ZERO imports anywhere (107)** — full list in `audit-tmp/` knip output; includes `Tenant, Contact, Appointment, Call, Quote, Invoice, PipelineStage/Entry, SmsMessage, Conversation*, ApiSuccess/Error/Response, PaginatedResponse, TriggerLink*, ReviewRequest*, Webchat*, Portal*, Video*, TelnyxNumber*, CustomAutomation{Trigger,Action,Status}, Resource*, Referral*, Announcement*, GiftCard*, MediaFile, FieldType, VerticalField, BusinessHours, VerticalConfig`, and ~50 more.

**Tier: REVIEW, not SAFE.** These compile-check as removable, but they are the de-facto schema/domain documentation for the platform and the standalone Expo app (own package-lock) may adopt them. Recommendation: decide deliberately — either trim to the 27 used + actively-needed ones, or keep the barrel as documented contract. Don't bulk-delete blindly.

---

## 4. Unused dependencies

| Package     | Dep                                           | Tier            | Evidence / reason                                                                                                                                                    |
| ----------- | --------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| apps/api    | `expo-server-sdk`                             | **SAFE**        | 0 imports (grep). `lib/expo-push.ts` does push via fetch — and `sendExpoPush` is itself unused (§2).                                                                 |
| apps/mobile | `react-native-gesture-handler`                | **INTENTIONAL** | No direct import, but required at runtime by expo-router/react-navigation. Removing breaks gestures.                                                                 |
| apps/mobile | `typescript` (devDep)                         | **INTENTIONAL** | Used by `tsc`; depcheck can't see it.                                                                                                                                |
| apps/web    | `autoprefixer`, `postcss`, `tailwindcss`      | **INTENTIONAL** | Wired via `postcss.config.js` / `tailwind.config.js`; depcheck false positive.                                                                                       |
| root        | `eslint-plugin-prettier`, `ts-node` (devDeps) | REVIEW          | knip flags both. `eslint-config-prettier` is in `eslint.config.js`; verify the plugin (vs config) is actually referenced, and whether any script still uses ts-node. |

## 4b. Unlisted (missing) dependencies — work via hoisting today, fragile

| Package         | Import                   | Where                                                                                                     |
| --------------- | ------------------------ | --------------------------------------------------------------------------------------------------------- |
| apps/web        | `jose`                   | `src/proxy.ts:4`, `src/lib/auth/authjs.ts:5` — declared only in apps/api. Add to apps/web `package.json`. |
| apps/api        | `httpxy` (type-only)     | `routes/voice-live-proxy.ts:15`                                                                           |
| apps/api        | `domhandler` (type-only) | `lib/url-crawler.ts:4`                                                                                    |
| apps/api        | `@jest/globals`          | `routes/__test-support__/supabase-mock.ts` (devDep missing)                                               |
| packages/shared | `@supabase/supabase-js`  | `src/seed/inventory.ts`, `src/seed/staff.ts`, `supabase/seeds/service_packages_seed.ts`                   |

---

## 5. Duplicate blocks (jscpd) — REVIEW

300 clones, 4,839 duplicated lines (3.59%), 30,336 duplicated tokens (3.99%). Full JSON: `audit-tmp/jscpd/jscpd-report.json`. Top file pairs by duplicated lines:

| Lines | Pair                                                                                                                         |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- |
| 341   | `apps/web/src/components/deals/DealsKanban.tsx` ↔ `DealsList.tsx` (4 clones ≥31 lines each — shared deal-card/editing logic) |
| 127   | `(dashboard)/onboarding/OnboardingWizard.tsx` ↔ `onboarding/maya/MayaOnboardingWizard.tsx`                                   |
| 108   | `apps/api/src/scripts/seed-intake-forms.ts` (internal self-duplication)                                                      |
| 71    | `components/inventory/InventorySlideOver.tsx` ↔ `components/staff/StaffSlideOver.tsx`                                        |
| 68    | `apps/api/src/routes/campaigns.ts` (internal)                                                                                |
| 66    | `(dashboard)/contacts/[id]/ContactDetailClient.tsx` ↔ `components/deals/DealDetail.tsx`                                      |
| 63    | `apps/api/src/routes/inventory.ts` ↔ `routes/staff.ts` (CRUD scaffolding — same pair as the `*-logic.ts` drift issue, §2)    |
| 58    | `apps/api/src/routes/email-health.ts` ↔ `routes/sms-health.ts` (48-line clone starting line 1)                               |
| 57    | `(dashboard)/invoices/page.tsx` ↔ `(dashboard)/subscriptions/page.tsx`                                                       |
| 51    | `settings/snippets/page.tsx` ↔ `settings/trigger-links/page.tsx`                                                             |

Test-file clones (campaign tests, maya-memory tests, automation-overview↔scanner-pause) are lower priority.

---

## 6. Duplicate functions (semantic) — REVIEW

### 6.1 Tenant from-number lookups (5 duplicates)

Same query shape: `telnyx_numbers.select('phone_number').eq('tenant_id',…).eq('status','active').order('is_primary',desc).limit(1)`.

- `apps/api/src/workers/campaign-sender.ts:182-192`
- `apps/api/src/workers/quote-followup-worker.ts:65-72`
- `apps/api/src/workers/outbound-call-worker.ts:137-146`
- `apps/api/src/workers/follow-up-cadence-worker.ts:100-107`
- `apps/api/src/routes/sms.ts:99-106`

**Canonical:** `apps/api/src/lib/telnyx-tenant-lookup.ts` is the canonical `telnyx_numbers` module (timeout + fallback), but it does inbound lookup. Recommendation: add `getTenantPhoneNumber(tenantId)` there; point all 5 sites at it.

### 6.2 First-name extraction from `full_name` (11+ duplicates)

**Canonical:** `apps/api/src/workers/campaign-sender.ts:66-69` `getFirstName()` (null-safe, `'there'` fallback). Inline duplicates:
`apps/api/src/routes/appointments.ts:408` · `routes/contacts.ts:1021,1199` · `workers/review-request-worker.ts:108` · `apps/web/.../CollectPageClient.tsx:342` · `portal/[slug]/dashboard/page.tsx:178` · `(dashboard)/dashboard/page.tsx:40` · `components/inbox/InboxList.tsx:180,216` · `components/contacts/SmsThread.tsx:133` · `components/contacts/BulkActionBar.tsx:211`. Move to `@nuatis/shared`.

### 6.3 Currency formatters (7 duplicates, web)

**Canonical:** `Intl.NumberFormat('en-US', {style:'currency'})` style as in `(dashboard)/referrals/ReferralsClient.tsx:20`. Duplicates: `invoices/page.tsx:24` · `invoices/[id]/page.tsx:51` · `subscriptions/page.tsx:31` (3 identical copies) · `insights/InsightsDashboard.tsx:231` (compact variant) · `pipeline/PipelineContent.tsx:50` · `components/dashboard/LeadSourceReport.tsx:32`. Extract `apps/web/src/lib/format.ts` with full/compact/short variants.

### 6.4 Date/timezone formatters (6+ duplicates, api)

- `voice/tool-handlers.ts:316-369` (`dateAtHour`, `formatHourAmPm`, `formatHHMM`) ↔ `lib/booking-availability.ts:75-112` — **near-identical copies** of `dateAtHour` + `formatHHMM`. Canonical: tool-handlers versions; extract to `lib/time-format.ts`.
- `voice/business-knowledge.ts:23-30` `formatTime` (AM/PM from HH:MM string) overlaps `formatHourAmPm`.
- `workers/appointment-reminder-worker.ts:16-23` `formatTime` — hardcodes `America/Chicago`; should take tenant tz.

### 6.5 Phone E.164 normalizers (3 variants, api)

- `voice/pre-call-lookup.ts:14-21` `normalizeE164` — strict, validates (canonical)
- `lib/import-processor.ts:28-33` — US-centric, passthrough on failure
- `voice/tool-handlers.ts:284-287` — lenient strip-and-prefix
  Export the strict one; review whether lenient variants are intentional.

### 6.6 Local re-declared types (drift duplicates)

- `EmailAccount`: exported `apps/api/src/lib/email-oauth.ts:6` AND re-declared locally `apps/web/.../settings/integrations/page.tsx:6`
- `ReportFilter`: exported `apps/api/src/lib/report-engine.ts:7` AND re-declared `apps/web/.../reports/page.tsx:12`

### 6.7 Gemini JSON fence-strip (3 copies — pattern is INTENTIONAL, extraction optional)

`lib/automation-ai-builder.ts:116` · `workers/maya-memory-extractor.ts:90` · `routes/campaigns.ts:506`. The fallback itself is on the INTENTIONAL list; a tiny shared `stripJsonFences()` would still be reasonable.

### Not duplicates (verified clean)

- `buildConfirmationSms()` (`lib/sms-templates.ts:25-62`) — all 4 call sites (tool-handlers, post-call, appointments, booking-public) import the canonical builder. No inline copies.
- Email HTML builders (`wrapHtml` / `plainTextToHtml` / receipt `buildHtml`) — distinct purposes.
- Gemini wrappers: `voice/gemini-live.ts` (Live audio WS) vs `voice/maya-kb-extractor.ts` (REST text) — different API modes, INTENTIONAL.

---

## 7. Dead branches, commented-out code, TODOs

- **Dead branches / unreachable code: none found.** No `if (false)`, `&& false`, or post-return code detected.
- **Commented-out code blocks (≥3 lines): none.** Single commented import `apps/api/src/lib/notifications.ts:4-5` is annotated "reserved for future" — INTENTIONAL.
- **`apps/api/src/workers/follow-up-worker.ts`** — empty stub, header: "intentionally empty… kept for future one-off follow-up job processing. Do not register in index.ts." — INTENTIONAL.
- **Feature flags:** `SCANNERS_ENABLED` (`workers/index.ts:40`) is a live env toggle, not permanently disabled.
- **Stale TODOs (3):** `apps/api/src/routes/google-reserve.ts:69` (awaiting partner credentials) · `apps/web/.../appointments/AppointmentsCalendar.tsx:140` (G65) · `apps/web/src/components/tasks/TasksDashboard.tsx:102` (G65).

## 7b. Unused locals/params (tsc) — SAFE

- `apps/api/src/routes/announcements.ts:14` — param `req` never read
- `apps/api/src/voice/gemini-live.ts:288` — local `lastAudioTime` never read
- `apps/web/src/app/(dashboard)/reports/page.tsx:796` — local `label` never read

---

## 8. Env vars

69 distinct vars referenced in code (full counts: `audit-tmp/envvars-used.txt`). Setter sources checked: `infra/azure/*.sh`, `docker-compose.yml`. (`.env*` files not read.)

### ⚠️ Name mismatches — set by infra but NEVER read by code (REVIEW — likely config bug)

| Infra sets (`infra/azure/update-env.sh`) | Code reads instead      | Code refs |
| ---------------------------------------- | ----------------------- | --------- |
| `MS_OAUTH_CLIENT_ID`                     | `OUTLOOK_CLIENT_ID`     | 7         |
| `MS_OAUTH_CLIENT_SECRET`                 | `OUTLOOK_CLIENT_SECRET` | 4         |
| `TELNYX_SIP_CONNECTION_ID`               | `TELNYX_CONNECTION_ID`  | 3         |

Container app receives the `MS_OAUTH_*` / `TELNYX_SIP_*` names verbatim; the code's names get `undefined` unless also set manually in the portal. Verify and align.

### Read in code, no setter found in repo (REVIEW — may be set manually in Azure portal / Vercel; verify each)

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, all 8 `STRIPE_PRICE_*`, `SQUARE_APP_ID/APP_SECRET/ENVIRONMENT`, `OUTLOOK_CLIENT_ID/SECRET`, `TELNYX_CONNECTION_ID`, `TELNYX_PUBLIC_KEY`, `TELNYX_PHONE_NUMBER`, `TELNYX_FROM_NUMBER`, `TELNYX_STREAM_URL`, `GOOGLE_EMAIL_CLIENT_ID/SECRET`, `EMAIL_FROM`, `EMAIL_TOKEN_SECRET`, `INBOUND_WEBHOOK_SECRET`, `RESEND_WEBHOOK_SECRET`, `API_BASE_URL`, `WEB_URL`, `SUPABASE_ANON_KEY`, `VOICE_DEV_TENANT_ID`, `VOICE_WEBHOOK_URL`, `CORS_ORIGIN`, several `NEXT_PUBLIC_*`.

### Documented vars confirmed in use

`TELNYX_STREAM_URL` (2 refs, `index.ts:313`) · `OPS_COPILOT_URL` (3 refs, `lib/ops-copilot-client.ts:35` — early-return guard is INTENTIONAL).

---

## 9. Circular dependencies (madge) — REVIEW

apps/api (2):

1. `lib/ops-copilot-client.ts` → `workers/webhook-retry-worker.ts` → back
2. `voice/tool-handlers.ts` → `voice/post-call.ts` → back

apps/web, apps/mobile, packages/shared: none.

---

## 10. Complexity review (REVIEW only — list, not judgment)

Files >400 lines (non-test): **api 25 · web 47 · mobile 1 · shared 2**. Largest:
`apps/api/src/routes/quotes.ts` (1,989) · `apps/web/.../insights/InsightsDashboard.tsx` (1,957) · `apps/api/src/routes/contacts.ts` (1,651) · `apps/web/.../contacts/[id]/ContactDetailClient.tsx` (1,650) · `apps/api/src/routes/insights.ts` (1,612) · `apps/api/src/voice/tool-handlers.ts` (1,417) · `packages/shared/src/types/index.ts` (1,402) · `packages/shared/src/verticals/index.ts` (1,398 — config-first verticals, INTENTIONAL size) · `apps/api/src/routes/campaigns.ts` (1,264).

Functions >60 lines (heuristic scan): **104**. Top offenders:
`InsightsDashboard.tsx:792 renderWidget` (1,110) · `voice/telnyx-handler.ts:565 registerVoiceWebSocket` (521) · `settings/calendar/page.tsx:65` (513) · `voice/post-call.ts:58 handlePostCall` (361) · `ContactFilters.tsx:304` (330) · `lib/digest-builder.ts:24 buildDigestData` (313) · `workers/campaign-sender.ts:94 processCampaignSend` (279) · `services/pdf-generator.ts:53 generateQuotePdf` (274) · `campaigns-prereq.ts:27 getPrereqChecks` (241) · `workers/campaign-send-worker.ts:44 processCampaignSend` (233 — dual-worker pattern, INTENTIONAL) · `workers/index.ts:39 startWorkers` (214).

Single-caller abstractions flagged with caution: `inventory-logic.ts`/`staff-logic.ts` (§2 — extracted for tests but routes don't use them; this is the inverse problem: abstraction exists, production code bypasses it).

---

## Appendix: DO-NOT-TOUCH (confirmed INTENTIONAL patterns + locations)

| Pattern                                                                              | Confirmed location(s)                                                                                                                                                                                                                                                                                                                | Reason                                                      |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| Dual `campaign-send` worker                                                          | `workers/campaign-send-worker.ts` (legacy 0100, queue at :281) + `workers/campaign-sender.ts` (P13, queue at :379); mutual-exclusion guards documented in both headers (`:4-8`, `:64`)                                                                                                                                               | Intentional tech debt; both guard on `campaign.channels`    |
| `createBullMQConnection()` per Queue/Worker                                          | `lib/lead-score-queue.ts` + 10+ workers (`campaign-send-worker`, `campaign-sender`, `webhook-retry-worker`, `quote-followup-worker`, `outbound-call-worker`, …)                                                                                                                                                                      | Required BullMQ pattern; NOT a singleton-refactor candidate |
| `Promise.race` timeout wrappers                                                      | `voice/telnyx-handler.ts:248,316` · `voice/tenant-helpers.ts:40` · `voice/pre-call-lookup.ts:146` · `voice/gemini-live.ts:162,227` (2s caller-memory + KB loading) · `lib/digest-builder.ts:319` · `voice/maya-circuit-breaker.ts:143` · `lib/telnyx-tenant-lookup.ts:97` (~400ms getTenantConfig) · `lib/auth.ts:60` (2s appUserId) | Intentional resilience around optional DB lookups           |
| Segment resolver fallback `"selected segment"`                                       | `services/campaigns/segment-resolver.ts:19,37,53`                                                                                                                                                                                                                                                                                    | Intentional defensive fallback                              |
| Personalization fallback `'there'`                                                   | `voice/telnyx-handler.ts:388` · `lib/email-client.ts:106,121,139` · `routes/portal.ts:374` · `workers/campaign-sender.ts:68`                                                                                                                                                                                                         | Intentional                                                 |
| Gemini JSON fence-strip fallback                                                     | `lib/automation-ai-builder.ts:116-117` · `workers/maya-memory-extractor.ts:90-91` · `routes/campaigns.ts:506`                                                                                                                                                                                                                        | Intentional resilience                                      |
| `ops-copilot-client.ts` early return on empty `OPS_COPILOT_URL`                      | `lib/ops-copilot-client.ts:35`                                                                                                                                                                                                                                                                                                       | Intentional                                                 |
| Config-first verticals (spa, gym, nail_bar, pet_grooming, tattoo, car_wash, laundry) | `packages/shared/src/verticals/index.ts` (e.g. `nail_bar` at :1230); `tenant.product` branching `voice/telnyx-handler.ts:309`, `voice/tool-handlers.ts:384,812`                                                                                                                                                                      | Tenant-config-driven; low static ref count by design        |
| `requirePlan()` / module gates, Stripe price-ID constants, env constants             | `middleware/require-plan.ts` · `config/stripe-plans.ts` (`BASE_SUITE:110`, `TIER_GATED:121`, `PlanDef:69` — knip flags these; keep) · `STRIPE_PRICE_*` env reads                                                                                                                                                                     | Intentional even at 1 reference                             |
| `console.info/warn/error`                                                            | throughout                                                                                                                                                                                                                                                                                                                           | Allowed                                                     |
| `follow-up-worker.ts` empty stub                                                     | `workers/follow-up-worker.ts:1-4`                                                                                                                                                                                                                                                                                                    | Documented "kept for future"; do not register               |
| Manual scripts                                                                       | `voice/telnyx-setup.ts` ("Run with npx tsx") · `scripts/seed-*.ts`                                                                                                                                                                                                                                                                   | Entry points run by hand                                    |
| Mobile `react-native-gesture-handler`                                                | `apps/mobile/package.json:24`                                                                                                                                                                                                                                                                                                        | expo-router runtime requirement                             |

---

_Audit artifacts: `./knip.json` (uncommitted), `./audit-tmp/` (throwaway). Pre-existing working-tree modifications (many `apps/api` files) predate this audit and were not touched by it._
