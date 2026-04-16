# Environment Variables — Complete Spec (2026-04-16)

Compiled by grepping `process.env.*` across the entire codebase (apps/api, apps/web, apps/mobile, packages/). Use this as the source of truth.

> ⚠️ I could not read `apps/api/.env.example` directly (global Claude Code deny rule on `.env*` files). Compare this list against your current `apps/api/.env.example` and `apps/api/.env` and reconcile manually.

## apps/api/.env (server-side)

### Supabase (REQUIRED)

```dotenv
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...                # service-role JWT, NEVER expose client-side
SUPABASE_ANON_KEY=eyJ...                        # anon JWT (used by mobile-auth route)
```

### Auth (REQUIRED)

```dotenv
AUTH_SECRET=                                    # 32+ char random, used to sign mobile JWTs
CLERK_JWKS_URL=                                 # ONLY for legacy clerk-auth tenants (internal). Optional after migration to authjs.
```

### Voice — Telnyx (REQUIRED for voice calls)

```dotenv
TELNYX_API_KEY=
TELNYX_PHONE_NUMBER=+15127376388                # default fallback
TELNYX_CONNECTION_ID=                           # for outbound calls
TELNYX_STREAM_URL=wss://voice.nuatis.com/voice/stream  # public WSS for media stream
TELNYX_TENANT_MAP=+15551234567:tenant-uuid,+15559876543:tenant-uuid  # phone→tenant map
VOICE_WS_URL=wss://voice.nuatis.com/voice/stream
VOICE_WEBHOOK_URL=https://api.nuatis.com/voice/webhook
VOICE_DEV_TENANT_ID=                            # local dev: routes unknown calls to this tenant
ESCALATION_PHONE_DEFAULT=+1...                  # fallback escalation number
```

### Voice — Gemini (REQUIRED for voice AI)

```dotenv
GEMINI_API_KEY=
```

### Email — Resend transactional (REQUIRED for built-in sending: review requests, follow-ups, etc.)

```dotenv
RESEND_API_KEY=
EMAIL_FROM=Maya <maya@nuatis.com>
```

### Email — User OAuth (REQUIRED for Phase 10 email integrations: Gmail send, Outlook send)

```dotenv
EMAIL_TOKEN_SECRET=                             # 32+ char, encrypts stored OAuth tokens at rest
GOOGLE_EMAIL_CLIENT_ID=                         # Google Cloud → OAuth 2.0 → Gmail send scope
GOOGLE_EMAIL_CLIENT_SECRET=
OUTLOOK_CLIENT_ID=                              # Microsoft Entra → app registration → Mail.Send + Mail.Read scopes
OUTLOOK_CLIENT_SECRET=
```

### Calendar — Google (legacy/separate from email OAuth)

```dotenv
GOOGLE_CLIENT_ID=                               # used by services/google.ts for calendar
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
```

### Calendar — Outlook

> Re-uses `OUTLOOK_CLIENT_ID` / `OUTLOOK_CLIENT_SECRET` from Email section above.

### Push notifications (REQUIRED for web push)

```dotenv
VAPID_PUBLIC_KEY=                               # generate: npx web-push generate-vapid-keys
VAPID_PRIVATE_KEY=
VAPID_EMAIL=mailto:sid@nuatis.com
```

### Queue / Workers (REQUIRED for BullMQ workers — 16 of them)

```dotenv
REDIS_URL=redis://localhost:6379                # local dev. Prod: Azure Cache for Redis
SCANNERS_ENABLED=true                           # set 'false' to disable workers in tests
```

### URLs (REQUIRED — used in OAuth callbacks, link generation)

```dotenv
PORT=3001
NODE_ENV=development                            # production | development | test
API_URL=http://localhost:3001                   # what email/calendar OAuth callbacks redirect TO
API_BASE_URL=http://localhost:3001              # what API uses for self-references
WEB_URL=http://localhost:3000                   # what API embeds in emails (booking links, quote URLs)
```

### Ops Copilot (optional — for webhook retry routing)

```dotenv
OPS_COPILOT_URL=http://localhost:8001
```

### Monitoring

```dotenv
SENTRY_DSN=                                     # optional. If set, sends errors to Sentry
```

### Admin

```dotenv
ADMIN_API_KEY=                                  # for /admin/* endpoints (internal tools)
```

### Stripe — DEFERRED (Phase 9, not yet implemented)

```dotenv
# STRIPE_SECRET_KEY=
# STRIPE_WEBHOOK_SECRET=
# STRIPE_STARTER_PRICE_ID=
# STRIPE_PRO_PRICE_ID=
# STRIPE_SCALE_PRICE_ID=
```

---

## apps/web/.env.local (Next.js client-side)

### Required

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:3001       # used by every page that calls API
NEXT_PUBLIC_WEB_URL=http://localhost:3000       # used by chat-widget settings
NEXT_PUBLIC_SUPABASE_URL=                       # for client-side Supabase (auth, realtime if used)
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_VAPID_PUBLIC_KEY=                   # mirrors VAPID_PUBLIC_KEY for browser subscribe call
```

### Auth.js (NextAuth) — REQUIRED

```dotenv
AUTH_SECRET=                                    # SAME value as apps/api/.env AUTH_SECRET
NEXTAUTH_URL=http://localhost:3000
DATABASE_URL=postgresql://...                   # if Auth.js DB adapter used; otherwise omit
```

### Clerk — legacy (only if Clerk-org tenants still active)

```dotenv
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/dashboard
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/onboarding
```

---

## apps/mobile (Expo)

Mobile reads from `Constants.expoConfig.extra.apiUrl` (set in `app.json` → `expo.extra.apiUrl`), not from `process.env`.

Set in `apps/mobile/app.json`:

```json
{
  "expo": {
    "extra": {
      "apiUrl": "http://localhost:3001"
    }
  }
}
```

For production builds use `eas.json` profile-specific overrides.

---

## What you need to obtain (action items)

### ✅ Already set in apps/api/.env (verified 2026-04-16)

- SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
- AUTH_SECRET (do NOT regenerate — will invalidate sessions/JWTs)
- REDIS_URL
- TELNYX_API_KEY, TELNYX_CONNECTION_ID, TELNYX_TENANT_MAP
- GEMINI_API_KEY
- CLERK_JWKS_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI

### ❌ MISSING from apps/api/.env (verified 2026-04-16) — 11 vars

| Var                          | Blocks                                                           |
| ---------------------------- | ---------------------------------------------------------------- |
| `RESEND_API_KEY`             | review-request emails, follow-up emails, all transactional sends |
| `EMAIL_TOKEN_SECRET`         | encryption of stored Gmail/Outlook OAuth tokens                  |
| `GOOGLE_EMAIL_CLIENT_ID`     | Phase 10 Gmail send/read integration                             |
| `GOOGLE_EMAIL_CLIENT_SECRET` | same                                                             |
| `OUTLOOK_CLIENT_ID`          | Phase 10 Outlook email + calendar                                |
| `OUTLOOK_CLIENT_SECRET`      | same                                                             |
| `VAPID_PUBLIC_KEY`           | web push notifications                                           |
| `VAPID_PRIVATE_KEY`          | web push notifications                                           |
| `VAPID_EMAIL`                | web push (subscribe header)                                      |
| `API_URL`                    | OAuth callback URL composition                                   |
| `WEB_URL`                    | embed links in emails (booking, quotes)                          |

### ⚠️ NEED TO OBTAIN before Azure deploy

**Phase 10 features blocked on these:**

1. **Gmail OAuth** (`GOOGLE_EMAIL_CLIENT_ID` + `GOOGLE_EMAIL_CLIENT_SECRET`)
   - Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client ID
   - Application type: Web
   - Scopes: `https://www.googleapis.com/auth/gmail.send`, `gmail.readonly`
   - Redirect URI: `http://localhost:3001/api/email-integrations/google/callback` (dev), `https://api.nuatis.com/api/email-integrations/google/callback` (prod)

2. **Outlook OAuth** (`OUTLOOK_CLIENT_ID` + `OUTLOOK_CLIENT_SECRET`)
   - Azure Portal → Microsoft Entra ID → App registrations → New
   - Redirect URI: `http://localhost:3001/api/email-integrations/outlook/callback` (dev) + prod equivalent
   - API permissions (delegated): `Mail.Send`, `Mail.Read`, `Calendars.ReadWrite`, `User.Read`, `offline_access`
   - Generate client secret under "Certificates & secrets"

3. **Google Calendar OAuth** (`GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `GOOGLE_REDIRECT_URI`)
   - Same Google Cloud project; can be a SECOND OAuth client OR re-use the email one
   - Scopes: `https://www.googleapis.com/auth/calendar`
   - Redirect URI: whatever `routes/google-auth.ts` uses → check that file

4. **EMAIL_TOKEN_SECRET** — generate fresh:

   ```bash
   openssl rand -hex 32
   ```

5. **CLERK_JWKS_URL** — only if internal tenant still uses Clerk. From Clerk Dashboard → API Keys → JWT Public Keys → JWKS URL. If migrated to Auth.js, can omit.

### ❌ DEFERRED (not needed for Phase 10 launch)

- All Stripe vars (Phase 9 — separate session)
- `SENTRY_DSN` (set up after deploy)

---

## Optional but recommended

```dotenv
# Telnyx outbound (only if making outbound calls)
TELNYX_CONNECTION_ID=

# Local dev hot-reload tenant routing
VOICE_DEV_TENANT_ID=c35f4ce4-04f0-4ec0-bbc2-8512afbd3c5b   # internal tenant
```

---

## Validation script

Run this from `apps/api/` to confirm all required vars are set:

```bash
node --env-file=.env -e "
const required = [
  'SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ANON_KEY',
  'AUTH_SECRET','REDIS_URL','TELNYX_API_KEY','GEMINI_API_KEY',
  'RESEND_API_KEY','EMAIL_TOKEN_SECRET',
  'GOOGLE_EMAIL_CLIENT_ID','GOOGLE_EMAIL_CLIENT_SECRET',
  'OUTLOOK_CLIENT_ID','OUTLOOK_CLIENT_SECRET',
  'VAPID_PUBLIC_KEY','VAPID_PRIVATE_KEY','VAPID_EMAIL',
  'API_URL','WEB_URL'
];
const optional = [
  'CLERK_JWKS_URL','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REDIRECT_URI',
  'TELNYX_CONNECTION_ID','TELNYX_TENANT_MAP','VOICE_DEV_TENANT_ID',
  'ESCALATION_PHONE_DEFAULT','SENTRY_DSN','OPS_COPILOT_URL','ADMIN_API_KEY'
];
console.log('REQUIRED:'); for (const k of required) console.log('  ' + (process.env[k] ? '✅' : '❌') + ' ' + k);
console.log('\\nOPTIONAL:'); for (const k of optional) console.log('  ' + (process.env[k] ? '✅' : '➖') + ' ' + k);
"
```
