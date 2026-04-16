# Nuatis CRM — Pending Tasks (2026-04-16)

Replaces stale April-14 doc. Reflects post-Phase 10 state.

## Snapshot

| Layer                  | Status                                                                         |
| ---------------------- | ------------------------------------------------------------------------------ |
| Code                   | All 10 phases shipped, 52/52 tests passing                                     |
| Migrations             | **2 of 42 applied** (0001 + 0002 only)                                         |
| Internal tenant seeded | ❌ blocked on migrations                                                       |
| Demo tenant seeded     | ❌ blocked on migrations                                                       |
| Env vars               | 11 of 29 required missing (Phase 10 OAuth + Resend + VAPID + URLs)             |
| API local              | ✅ runs (supabase / redis / gemini all healthy)                                |
| Web local              | ❌ tailwind v3/v4 dep mismatch (CI builds OK; local needs `npm install` reset) |
| Mobile                 | Code shipped, not in TestFlight/Play Console                                   |
| Azure deploy           | Not started                                                                    |

## 1. Database state

- Schema reflects phase-1-only: `tenants`, `users`, `contacts`, `appointments`, `locations`, `vertical_configs`, `pipeline_stages` (+ supporting `calls`, `knowledge_docs`, etc).
- Migrations 0003 through 0042 (40 files) are NOT applied.
- `schema_versions` is unreliable (only `1.0.0` tracked; 0002 partially landed without recording).

**Action:** Sid pastes each pending migration into Supabase SQL Editor in order. See `MIGRATIONS_TO_APPLY.md` for the ordered list and the re-audit script.

## 2. Environment variables

See `PENDING_ENV_VARS.md`. Summary:

- **Set (15):** Supabase x3, AUTH_SECRET, REDIS_URL, Telnyx x3, Gemini, Clerk JWKS, Google calendar x3
- **Missing (11):** Resend, EMAIL_TOKEN_SECRET, Google email OAuth x2, Outlook OAuth x2, VAPID x3, API_URL, WEB_URL
- **Deferred:** all Stripe vars (Phase 9)

## 3. OAuth apps not registered (blocks Phase 10 features)

| Provider           | What for                 | Where to create                                          | Redirect URIs needed                                                                                                                              |
| ------------------ | ------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google Cloud OAuth | Gmail send/read          | console.cloud.google.com → APIs & Services → Credentials | `http://localhost:3001/api/email-integrations/google/callback`, `https://api.nuatis.com/api/email-integrations/google/callback`                   |
| Microsoft Entra    | Outlook email + calendar | portal.azure.com → Entra ID → App registrations          | `http://localhost:3001/api/email-integrations/outlook/callback`, `http://localhost:3001/api/settings/calendar/outlook/callback`, prod equivalents |

Scopes needed:

- Google: `gmail.send`, `gmail.readonly`, `calendar`
- Microsoft: `Mail.Send`, `Mail.Read`, `Calendars.ReadWrite`, `User.Read`, `offline_access`

## 4. Manual smoke tests not yet passed

20 sections covering auth, contacts, appointments, pipelines, quotes, email, booking, intake, scoring, reviews, chat, reports, import/export, calendar, push, knowledge, webhooks, multi-vertical. See `MANUAL_SMOKE_TESTS.md`.

**Cannot run until Tasks 1 + 2 complete (migrations + env vars + web fix).**

## 5. Phase 9 Stripe (Deferred)

- Pricing decision needed (proposed: Starter $99 / Pro $249 / Scale $499 — confirm before launch)
- Stripe account creation
- 4 env vars (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, 3 price IDs)
- New migration likely needed for Stripe-related tracking (current `subscriptions` table from 0001 may need columns for Stripe billing portal URL, current_period_end, etc.)
- Webhook endpoint: `/api/stripe/webhook` not yet implemented

## 6. Azure deployment (not started)

Infra scripts present at `infra/azure/`:

- `deploy.sh` — main provisioning
- `update-env.sh` — sync env from local to App Service
- `custom-domain.sh` — bind api.nuatis.com / app.nuatis.com
- `budget-alert.sh` — Azure budget guardrail

Steps before pulling trigger:

1. All 40 pending migrations applied (Section 1)
2. All 11 missing env vars resolved (Section 2)
3. OAuth apps registered (Section 3)
4. Local web fixed
5. Smoke tests pass locally (Section 4)
6. Run `infra/azure/deploy.sh`
7. Run `infra/azure/update-env.sh` to push env vars to App Service
8. Update Telnyx webhook to point at `https://api.nuatis.com/voice/webhook`
9. Run `infra/azure/custom-domain.sh` for `api.nuatis.com`
10. Update DNS at registrar to point at Azure Front Door / App Service

## 7. Tech debt from Phase 10

### Session type cast (10 occurrences in apps/web — not 5 as previously reported)

Each is `(session as unknown as Record<string, unknown>)?.accessToken ?? ''` to read the JWT off NextAuth's session. Should be a typed `Session` extension with `accessToken`. Files:

- `apps/web/src/app/(dashboard)/settings/data-export/page.tsx`
- `apps/web/src/app/(dashboard)/settings/calendar/page.tsx`
- `apps/web/src/app/(dashboard)/settings/email-templates/page.tsx`
- `apps/web/src/app/(dashboard)/settings/booking/page.tsx`
- `apps/web/src/app/(dashboard)/settings/pipelines/page.tsx`
- `apps/web/src/app/(dashboard)/settings/intake-forms/page.tsx`
- `apps/web/src/app/(dashboard)/settings/lead-scoring/page.tsx`
- `apps/web/src/app/(dashboard)/settings/chat-widget/page.tsx` (2x — token + user lookup)
- `apps/web/src/app/(dashboard)/settings/automation/page.tsx`

Fix: declare `module 'next-auth' { interface Session { accessToken?: string } }` once in `apps/web/src/types/next-auth.d.ts`, drop all casts.

### Worker `any` cast

`apps/api/src/workers/export-worker.ts:68` — `supabase: any` parameter. Should be typed `SupabaseClient<Database>`. Fix when generating Supabase types post-migration.

### Web tailwind v3 → v4 mismatch

`apps/web/package.json` declares `tailwindcss@^3.4.19` but root has `tailwindcss@4.2.2`. Local `npm install` resolves to a broken state where v3 sub-deps (`object-hash`, `dlv`) aren't fetched. CI is likely passing because of a different lockfile state on the runner. Action: pick one version, sync, regenerate lockfile.

## 8. Mobile app status

- Code shipped (apps/mobile, Expo Router, `_layout.tsx` + 6 screens)
- Lib uses `Constants.expoConfig.extra.apiUrl` (not `process.env`)
- **Not in TestFlight or Play Console**
- Apple Developer account needed ($99/yr)
- Google Play Console needed ($25 one-time)
- App icon + splash are Expo defaults (placeholders)
- `eas.json` exists but no production build profile beyond defaults

## 9. Landing page / marketing

- nuatis.com WordPress page needs pricing update (when Stripe pricing finalized)
- Demo video — not recorded
- "Book a demo" CTA — needs working endpoint (currently dead)
- Public booking page (`/book/<slug>`) works but no marketing tenant set up to point at

## 10. CI / build

- Last 3 commits all CI-fix related (`fix(ci): resolve lint + typecheck errors in Phase 10 code`, etc). Indicates rapid iteration.
- 52/52 tests passing locally; root `npm test` runs in 16s
- No e2e / integration test layer yet (only unit tests + the schema tests)

## Summary of blockers (priority order)

1. **Apply 40 migrations** — without this, almost nothing in Phase 4-10 works
2. **Register Google + Microsoft OAuth apps** — without this, email + Outlook calendar dead
3. **Add 11 missing env vars** — without `RESEND_API_KEY`, transactional email dead; without VAPID, push dead
4. **Fix local web (tailwind dep mismatch)** — needed to run smoke tests
5. **Run all 7 seeds** for both internal + demo tenants
6. **Run smoke test sequence** (20 sections, MANUAL_SMOKE_TESTS.md)

Then — and only then — Azure deploy.
