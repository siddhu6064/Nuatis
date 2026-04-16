# Email Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full email integration to Nuatis CRM — Gmail/Outlook OAuth, email compose from contact detail, open tracking, BCC logging, email templates, and settings UI.

**Architecture:** OAuth2 flows for Gmail (Google APIs) and Outlook (Microsoft Graph) store encrypted tokens in `user_email_accounts`. Emails sent via provider APIs are logged to `email_messages` with tracking pixels. Templates use merge tags resolved at send time. BCC logging provides a passive capture path. All email activity surfaces in the contact timeline.

**Tech Stack:** Express routes (apps/api), Supabase PostgreSQL, AES-256-GCM token encryption, Gmail API, Microsoft Graph API, Next.js 14 App Router (apps/web), Tailwind v3.

**Key Codebase Facts:**

- Latest committed migration: `0028_deals_companies.sql` → new migrations start at `0029`
- Import pattern: all `.ts` files in apps/api use `.js` extensions (`import { x } from '../lib/y.js'`)
- Auth: `requireAuth` middleware → cast `req as AuthenticatedRequest` → access `.tenantId`, `.userId`, `.role`
- DB: `getSupabase()` returns service-role client, defined locally per file
- Activity: `logActivity({ tenantId, contactId, type, body, metadata, actorType, actorId })`
- Sidebar nav: `NAV` array in `apps/web/src/app/(dashboard)/Sidebar.tsx` (line ~49-68)
- ActivityTimeline: `apps/web/src/components/contacts/ActivityTimeline.tsx` — TYPE_CONFIG already has `email` type mapped to `text-blue-600 bg-blue-50`
- Routes mounted in `apps/api/src/index.ts` via `app.use('/api/...', router)`
- CORS: `http://localhost:3000` in dev, `https://nuatis.com` in prod

---

## File Structure

### New Files — API

| File                                               | Responsibility                                           |
| -------------------------------------------------- | -------------------------------------------------------- |
| `supabase/migrations/0029_user_email_accounts.sql` | Email accounts table + RLS                               |
| `supabase/migrations/0030_email_messages.sql`      | Email messages table + RLS                               |
| `supabase/migrations/0031_email_templates.sql`     | Email templates table + RLS                              |
| `supabase/migrations/0032_bcc_logging_address.sql` | Add bcc column to tenants                                |
| `apps/api/src/lib/email-oauth.ts`                  | Token encrypt/decrypt, OAuth refresh, getValidToken      |
| `apps/api/src/lib/email-send.ts`                   | MIME builder, tracking pixel, Gmail/Outlook send helpers |
| `apps/api/src/lib/email-templates.ts`              | Merge tag resolution                                     |
| `apps/api/src/routes/email-integrations.ts`        | OAuth flows, account CRUD                                |
| `apps/api/src/routes/email-templates.ts`           | Template CRUD + preview                                  |
| `apps/api/src/routes/email-tracking.ts`            | Open tracking pixel endpoint                             |
| `apps/api/src/routes/email-inbound.ts`             | BCC webhook handler                                      |
| `apps/api/src/scripts/seed-email-templates.ts`     | Default template seeder                                  |

### New Files — Web

| File                                                             | Responsibility                   |
| ---------------------------------------------------------------- | -------------------------------- |
| `apps/web/src/app/(dashboard)/settings/integrations/page.tsx`    | Email accounts + BCC settings    |
| `apps/web/src/app/(dashboard)/settings/email-templates/page.tsx` | Template list + CRUD             |
| `apps/web/src/components/contacts/EmailComposeModal.tsx`         | Compose + send + template picker |

### Modified Files

| File                                                                 | Change                            |
| -------------------------------------------------------------------- | --------------------------------- |
| `apps/api/src/index.ts`                                              | Mount 4 new route files           |
| `apps/api/.env.example`                                              | Add 5 new env vars                |
| `apps/web/src/app/(dashboard)/Sidebar.tsx`                           | Add 2 nav items                   |
| `apps/web/src/app/(dashboard)/contacts/[id]/ContactDetailClient.tsx` | Add Send Email button + modal     |
| `apps/web/src/components/contacts/ActivityTimeline.tsx`              | Enhanced email activity rendering |

---

## Task 1: Database Migrations

**Files:**

- Create: `supabase/migrations/0029_user_email_accounts.sql`
- Create: `supabase/migrations/0030_email_messages.sql`
- Create: `supabase/migrations/0031_email_templates.sql`
- Create: `supabase/migrations/0032_bcc_logging_address.sql`

- [ ] **Step 1: Create user_email_accounts migration**

Create `supabase/migrations/0029_user_email_accounts.sql`:

```sql
CREATE TABLE user_email_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL CHECK (provider IN ('gmail', 'outlook')),
  email_address TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, email_address)
);

ALTER TABLE user_email_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON user_email_accounts
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE authjs_user_id = auth.uid()));

CREATE INDEX idx_user_email_accounts_user ON user_email_accounts(user_id);
CREATE INDEX idx_user_email_accounts_tenant ON user_email_accounts(tenant_id);
```

- [ ] **Step 2: Create email_messages migration**

Create `supabase/migrations/0030_email_messages.sql`:

```sql
CREATE TABLE email_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  contact_id UUID REFERENCES contacts(id),
  email_account_id UUID REFERENCES user_email_accounts(id),
  direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  subject TEXT,
  body_html TEXT,
  body_text TEXT,
  tracking_token UUID DEFAULT gen_random_uuid(),
  opened_at TIMESTAMPTZ,
  open_count INTEGER DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'oauth' CHECK (source IN ('oauth', 'bcc')),
  template_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE email_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON email_messages
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE authjs_user_id = auth.uid()));

CREATE INDEX idx_email_messages_contact ON email_messages(contact_id, created_at DESC);
CREATE INDEX idx_email_messages_tracking ON email_messages(tracking_token);
CREATE INDEX idx_email_messages_tenant ON email_messages(tenant_id);
```

- [ ] **Step 3: Create email_templates migration**

Create `supabase/migrations/0031_email_templates.sql`:

```sql
CREATE TABLE email_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  vertical TEXT,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON email_templates
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE authjs_user_id = auth.uid()));

CREATE INDEX idx_email_templates_tenant ON email_templates(tenant_id);
```

- [ ] **Step 4: Create bcc_logging_address migration**

Create `supabase/migrations/0032_bcc_logging_address.sql`:

```sql
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS bcc_logging_address TEXT;
```

- [ ] **Step 5: Commit migrations**

```bash
git add supabase/migrations/0029_user_email_accounts.sql supabase/migrations/0030_email_messages.sql supabase/migrations/0031_email_templates.sql supabase/migrations/0032_bcc_logging_address.sql
git commit -m "feat(email): add database migrations for email accounts, messages, templates, BCC"
```

---

## Task 2: Token Encryption & OAuth Helpers

**Files:**

- Create: `apps/api/src/lib/email-oauth.ts`
- Modify: `apps/api/.env.example`

- [ ] **Step 1: Create email-oauth.ts with encryption helpers**

Create `apps/api/src/lib/email-oauth.ts`:

```typescript
import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

function getEncryptionKey(): Buffer {
  const secret = process.env['EMAIL_TOKEN_SECRET']
  if (!secret) throw new Error('EMAIL_TOKEN_SECRET env var not set')
  return Buffer.from(secret, 'hex')
}

export function encryptToken(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${encrypted.toString('hex')}:${authTag.toString('hex')}`
}

export function decryptToken(encrypted: string): string {
  const key = getEncryptionKey()
  const [ivHex, ciphertextHex, authTagHex] = encrypted.split(':')
  if (!ivHex || !ciphertextHex || !authTagHex) throw new Error('Invalid encrypted token format')
  const iv = Buffer.from(ivHex, 'hex')
  const ciphertext = Buffer.from(ciphertextHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  return decipher.update(ciphertext) + decipher.final('utf8')
}

interface EmailAccount {
  id: string
  provider: 'gmail' | 'outlook'
  access_token: string
  refresh_token: string
  token_expires_at: string
}

export async function refreshGmailToken(account: EmailAccount): Promise<string> {
  const refreshToken = decryptToken(account.refresh_token)
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env['GOOGLE_EMAIL_CLIENT_ID'] || '',
      client_secret: process.env['GOOGLE_EMAIL_CLIENT_SECRET'] || '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Gmail token refresh failed: ${res.status} ${text}`)
  }
  const data = (await res.json()) as { access_token: string; expires_in: number }
  const newAccessToken = encryptToken(data.access_token)
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString()

  const supabase = getSupabase()
  await supabase
    .from('user_email_accounts')
    .update({
      access_token: newAccessToken,
      token_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', account.id)

  return data.access_token
}

export async function refreshOutlookToken(account: EmailAccount): Promise<string> {
  const refreshToken = decryptToken(account.refresh_token)
  const res = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env['OUTLOOK_CLIENT_ID'] || '',
      client_secret: process.env['OUTLOOK_CLIENT_SECRET'] || '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
      scope: 'Mail.Send Mail.Read User.Read offline_access',
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Outlook token refresh failed: ${res.status} ${text}`)
  }
  const data = (await res.json()) as { access_token: string; expires_in: number }
  const newAccessToken = encryptToken(data.access_token)
  const expiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString()

  const supabase = getSupabase()
  await supabase
    .from('user_email_accounts')
    .update({
      access_token: newAccessToken,
      token_expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq('id', account.id)

  return data.access_token
}

export async function getValidToken(
  accountId: string
): Promise<{ accessToken: string; provider: 'gmail' | 'outlook' }> {
  const supabase = getSupabase()
  const { data: account, error } = await supabase
    .from('user_email_accounts')
    .select('id, provider, access_token, refresh_token, token_expires_at')
    .eq('id', accountId)
    .single()

  if (error || !account) throw new Error('Email account not found')

  const expiresAt = new Date(account.token_expires_at).getTime()
  const fiveMinFromNow = Date.now() + 5 * 60 * 1000

  if (expiresAt > fiveMinFromNow) {
    return { accessToken: decryptToken(account.access_token), provider: account.provider }
  }

  // Token expired or about to expire — refresh
  const freshToken =
    account.provider === 'gmail'
      ? await refreshGmailToken(account as EmailAccount)
      : await refreshOutlookToken(account as EmailAccount)

  return { accessToken: freshToken, provider: account.provider }
}
```

- [ ] **Step 2: Add env vars to .env.example**

Append to `apps/api/.env.example`:

```
# Email OAuth (separate from Calendar OAuth)
GOOGLE_EMAIL_CLIENT_ID=
GOOGLE_EMAIL_CLIENT_SECRET=
OUTLOOK_CLIENT_ID=
OUTLOOK_CLIENT_SECRET=
EMAIL_TOKEN_SECRET=
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/lib/email-oauth.ts apps/api/.env.example
git commit -m "feat(email): add token encryption and OAuth refresh helpers"
```

---

## Task 3: Email Send Helpers

**Files:**

- Create: `apps/api/src/lib/email-send.ts`

- [ ] **Step 1: Create email-send.ts**

Create `apps/api/src/lib/email-send.ts`:

```typescript
export function buildMimeMessage(
  from: string,
  to: string,
  subject: string,
  htmlBody: string,
  textBody: string
): string {
  const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`
  const mime = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    textBody,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    htmlBody,
    '',
    `--${boundary}--`,
  ].join('\r\n')

  return Buffer.from(mime).toString('base64url')
}

export function injectTrackingPixel(html: string, trackingToken: string, apiUrl: string): string {
  const pixel = `<img src="${apiUrl}/api/email-tracking/${trackingToken}" width="1" height="1" style="display:none" alt="" />`
  if (html.includes('</body>')) {
    return html.replace('</body>', `${pixel}</body>`)
  }
  return html + pixel
}

export async function sendViaGmail(accessToken: string, rawBase64Message: string): Promise<void> {
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: rawBase64Message }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Gmail send failed: ${res.status} ${text}`)
  }
}

export async function sendViaOutlook(
  accessToken: string,
  to: string,
  subject: string,
  htmlBody: string,
  _textBody: string
): Promise<void> {
  const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: htmlBody },
        toRecipients: [{ emailAddress: { address: to } }],
      },
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Outlook send failed: ${res.status} ${text}`)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/lib/email-send.ts
git commit -m "feat(email): add MIME builder and Gmail/Outlook send helpers"
```

---

## Task 4: Merge Tag Resolution

**Files:**

- Create: `apps/api/src/lib/email-templates.ts`

- [ ] **Step 1: Create email-templates.ts**

Create `apps/api/src/lib/email-templates.ts`:

```typescript
interface Contact {
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
}

interface Tenant {
  business_name?: string
  name?: string
  phone?: string
}

const MERGE_TAGS: Record<string, (contact: Contact, tenant: Tenant) => string> = {
  '{{first_name}}': (c) => c.first_name || '',
  '{{last_name}}': (c) => c.last_name || '',
  '{{full_name}}': (c) => `${c.first_name || ''} ${c.last_name || ''}`.trim(),
  '{{email}}': (c) => c.email || '',
  '{{phone}}': (c) => c.phone || '',
  '{{business_name}}': (_c, t) => t.business_name || t.name || '',
  '{{business_phone}}': (_c, t) => t.phone || '',
}

export function resolveMergeTags(templateBody: string, contact: Contact, tenant: Tenant): string {
  let result = templateBody
  for (const [tag, resolver] of Object.entries(MERGE_TAGS)) {
    result = result.replaceAll(tag, resolver(contact, tenant))
  }
  // Leave unknown {{...}} tags as-is
  return result
}

export function resolveTemplate(
  template: { subject: string; body: string },
  contact: Contact,
  tenant: Tenant
): { subject: string; body: string } {
  return {
    subject: resolveMergeTags(template.subject, contact, tenant),
    body: resolveMergeTags(template.body, contact, tenant),
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/lib/email-templates.ts
git commit -m "feat(email): add merge tag resolution for email templates"
```

---

## Task 5: Email Integrations API Routes (OAuth Flows + Account CRUD)

**Files:**

- Create: `apps/api/src/routes/email-integrations.ts`

- [ ] **Step 1: Create email-integrations.ts**

Create `apps/api/src/routes/email-integrations.ts`:

```typescript
import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { encryptToken } from '../lib/email-oauth.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// GET /api/email-integrations — list connected accounts
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('user_email_accounts')
      .select('id, provider, email_address, is_default, created_at')
      .eq('tenant_id', authed.tenantId)
      .eq('user_id', authed.userId)
      .order('created_at', { ascending: true })

    if (error) return res.status(500).json({ error: error.message })
    return res.json(data || [])
  } catch (err) {
    console.error('List email accounts error:', err)
    return res.status(500).json({ error: 'Failed to list email accounts' })
  }
})

// GET /api/email-integrations/gmail/auth-url
router.get('/gmail/auth-url', requireAuth, async (req: Request, res: Response) => {
  try {
    const authed = req as AuthenticatedRequest
    const clientId = process.env['GOOGLE_EMAIL_CLIENT_ID']
    const apiUrl = process.env['API_URL'] || 'http://localhost:3001'
    if (!clientId) return res.status(500).json({ error: 'Google Email OAuth not configured' })

    const state = Buffer.from(
      JSON.stringify({ tenantId: authed.tenantId, userId: authed.userId })
    ).toString('base64url')
    const scopes = [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ].join(' ')

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${apiUrl}/api/email-integrations/gmail/callback`,
      response_type: 'code',
      scope: scopes,
      access_type: 'offline',
      prompt: 'consent',
      state,
    })

    return res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` })
  } catch (err) {
    console.error('Gmail auth URL error:', err)
    return res.status(500).json({ error: 'Failed to generate auth URL' })
  }
})

// GET /api/email-integrations/gmail/callback — NO requireAuth
router.get('/gmail/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query
    if (!code || !state) return res.status(400).send('Missing code or state')

    const { tenantId, userId } = JSON.parse(Buffer.from(state as string, 'base64url').toString())
    const apiUrl = process.env['API_URL'] || 'http://localhost:3001'
    const webUrl = process.env['WEB_URL'] || 'http://localhost:3000'

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code as string,
        client_id: process.env['GOOGLE_EMAIL_CLIENT_ID'] || '',
        client_secret: process.env['GOOGLE_EMAIL_CLIENT_SECRET'] || '',
        redirect_uri: `${apiUrl}/api/email-integrations/gmail/callback`,
        grant_type: 'authorization_code',
      }),
    })

    if (!tokenRes.ok) {
      const text = await tokenRes.text()
      console.error('Gmail token exchange failed:', text)
      return res.redirect(`${webUrl}/settings/integrations?email=error`)
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string
      refresh_token: string
      expires_in: number
    }

    // Fetch user email
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const userInfo = (await userRes.json()) as { email: string }

    const supabase = getSupabase()

    // Check if this is the first account for this user
    const { count } = await supabase
      .from('user_email_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)

    const isDefault = (count || 0) === 0

    // Insert account with encrypted tokens
    await supabase.from('user_email_accounts').upsert(
      {
        tenant_id: tenantId,
        user_id: userId,
        provider: 'gmail',
        email_address: userInfo.email,
        access_token: encryptToken(tokens.access_token),
        refresh_token: encryptToken(tokens.refresh_token),
        token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        is_default: isDefault,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,email_address' }
    )

    return res.redirect(`${webUrl}/settings/integrations?email=connected`)
  } catch (err) {
    console.error('Gmail callback error:', err)
    const webUrl = process.env['WEB_URL'] || 'http://localhost:3000'
    return res.redirect(`${webUrl}/settings/integrations?email=error`)
  }
})

// GET /api/email-integrations/outlook/auth-url
router.get('/outlook/auth-url', requireAuth, async (req: Request, res: Response) => {
  try {
    const authed = req as AuthenticatedRequest
    const clientId = process.env['OUTLOOK_CLIENT_ID']
    const apiUrl = process.env['API_URL'] || 'http://localhost:3001'
    if (!clientId) return res.status(500).json({ error: 'Outlook OAuth not configured' })

    const state = Buffer.from(
      JSON.stringify({ tenantId: authed.tenantId, userId: authed.userId })
    ).toString('base64url')
    const scopes = 'Mail.Send Mail.Read User.Read offline_access'

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: `${apiUrl}/api/email-integrations/outlook/callback`,
      response_type: 'code',
      scope: scopes,
      state,
    })

    return res.json({
      url: `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`,
    })
  } catch (err) {
    console.error('Outlook auth URL error:', err)
    return res.status(500).json({ error: 'Failed to generate auth URL' })
  }
})

// GET /api/email-integrations/outlook/callback — NO requireAuth
router.get('/outlook/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query
    if (!code || !state) return res.status(400).send('Missing code or state')

    const { tenantId, userId } = JSON.parse(Buffer.from(state as string, 'base64url').toString())
    const apiUrl = process.env['API_URL'] || 'http://localhost:3001'
    const webUrl = process.env['WEB_URL'] || 'http://localhost:3000'

    const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code as string,
        client_id: process.env['OUTLOOK_CLIENT_ID'] || '',
        client_secret: process.env['OUTLOOK_CLIENT_SECRET'] || '',
        redirect_uri: `${apiUrl}/api/email-integrations/outlook/callback`,
        grant_type: 'authorization_code',
        scope: 'Mail.Send Mail.Read User.Read offline_access',
      }),
    })

    if (!tokenRes.ok) {
      const text = await tokenRes.text()
      console.error('Outlook token exchange failed:', text)
      return res.redirect(`${webUrl}/settings/integrations?email=error`)
    }

    const tokens = (await tokenRes.json()) as {
      access_token: string
      refresh_token: string
      expires_in: number
    }

    // Fetch user email from Microsoft Graph
    const userRes = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    const userInfo = (await userRes.json()) as { mail?: string; userPrincipalName: string }
    const email = userInfo.mail || userInfo.userPrincipalName

    const supabase = getSupabase()

    const { count } = await supabase
      .from('user_email_accounts')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('tenant_id', tenantId)

    const isDefault = (count || 0) === 0

    await supabase.from('user_email_accounts').upsert(
      {
        tenant_id: tenantId,
        user_id: userId,
        provider: 'outlook',
        email_address: email,
        access_token: encryptToken(tokens.access_token),
        refresh_token: encryptToken(tokens.refresh_token),
        token_expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        is_default: isDefault,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,email_address' }
    )

    return res.redirect(`${webUrl}/settings/integrations?email=connected`)
  } catch (err) {
    console.error('Outlook callback error:', err)
    const webUrl = process.env['WEB_URL'] || 'http://localhost:3000'
    return res.redirect(`${webUrl}/settings/integrations?email=error`)
  }
})

// DELETE /api/email-integrations/:id — disconnect account
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    // Verify account belongs to current user
    const { data: account } = await supabase
      .from('user_email_accounts')
      .select('id')
      .eq('id', req.params['id'])
      .eq('user_id', authed.userId)
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!account) return res.status(404).json({ error: 'Email account not found' })

    const { error } = await supabase.from('user_email_accounts').delete().eq('id', req.params['id'])

    if (error) return res.status(500).json({ error: error.message })
    return res.json({ success: true })
  } catch (err) {
    console.error('Delete email account error:', err)
    return res.status(500).json({ error: 'Failed to disconnect account' })
  }
})

export default router
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/routes/email-integrations.ts
git commit -m "feat(email): add Gmail/Outlook OAuth flows and account CRUD routes"
```

---

## Task 6: Send Email API Endpoint

**Files:**

- Modify: `apps/api/src/routes/email-integrations.ts` (or create as separate file — we'll add to the contacts route area)

We'll add the send endpoint to the email-integrations router since it needs the same imports.

- [ ] **Step 1: Add POST /api/contacts/:id/email route**

This route lives on the contacts router area. Create a small dedicated file for clarity.

Add to the **bottom** of `apps/api/src/routes/email-integrations.ts`, before the `export default router`:

```typescript
// At top of file, add these imports:
import { getValidToken } from '../lib/email-oauth.js'
import {
  buildMimeMessage,
  injectTrackingPixel,
  sendViaGmail,
  sendViaOutlook,
} from '../lib/email-send.js'
import { logActivity } from '../lib/activity.js'
import crypto from 'node:crypto'

// POST /api/email-integrations/send/:contactId — send email to contact
router.post('/send/:contactId', requireAuth, async (req: Request, res: Response) => {
  try {
    const authed = req as AuthenticatedRequest
    const contactId = req.params['contactId']
    const { subject, bodyHtml, bodyText, emailAccountId, templateId } = req.body

    if (!subject || !bodyHtml || !emailAccountId) {
      return res.status(400).json({ error: 'subject, bodyHtml, and emailAccountId are required' })
    }

    const supabase = getSupabase()

    // Validate contact exists and belongs to tenant
    const { data: contact } = await supabase
      .from('contacts')
      .select('id, email, first_name, last_name')
      .eq('id', contactId)
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!contact) return res.status(404).json({ error: 'Contact not found' })
    if (!contact.email) return res.status(400).json({ error: 'Contact has no email address' })

    // Validate email account belongs to current user
    const { data: emailAccount } = await supabase
      .from('user_email_accounts')
      .select('id, provider, email_address')
      .eq('id', emailAccountId)
      .eq('user_id', authed.userId)
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!emailAccount) return res.status(404).json({ error: 'Email account not found' })

    // Get fresh access token
    const { accessToken, provider } = await getValidToken(emailAccountId)

    // Inject tracking pixel
    const trackingToken = crypto.randomUUID()
    const apiUrl = process.env['API_URL'] || 'http://localhost:3001'
    const htmlWithTracking = injectTrackingPixel(bodyHtml, trackingToken, apiUrl)

    // Send via provider
    if (provider === 'gmail') {
      const rawMessage = buildMimeMessage(
        emailAccount.email_address,
        contact.email,
        subject,
        htmlWithTracking,
        bodyText || ''
      )
      await sendViaGmail(accessToken, rawMessage)
    } else {
      await sendViaOutlook(accessToken, contact.email, subject, htmlWithTracking, bodyText || '')
    }

    // Log email message
    const { data: inserted } = await supabase
      .from('email_messages')
      .insert({
        tenant_id: authed.tenantId,
        contact_id: contactId,
        email_account_id: emailAccountId,
        direction: 'outbound',
        from_address: emailAccount.email_address,
        to_address: contact.email,
        subject,
        body_html: bodyHtml,
        body_text: bodyText || null,
        tracking_token: trackingToken,
        source: 'oauth',
        template_id: templateId || null,
      })
      .select('id')
      .single()

    // Log activity
    await logActivity({
      tenantId: authed.tenantId,
      contactId,
      type: 'email',
      body: `Sent email: ${subject}`,
      metadata: { direction: 'outbound', email_message_id: inserted?.id },
      actorType: 'user',
      actorId: authed.userId,
    })

    return res.json({ success: true, messageId: inserted?.id })
  } catch (err) {
    console.error('Send email error:', err)
    return res.status(500).json({ error: 'Failed to send email' })
  }
})
```

Note: The `crypto` import and additional lib imports should be added to the top of the file. The full import block becomes:

```typescript
import crypto from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { encryptToken, getValidToken } from '../lib/email-oauth.js'
import {
  buildMimeMessage,
  injectTrackingPixel,
  sendViaGmail,
  sendViaOutlook,
} from '../lib/email-send.js'
import { logActivity } from '../lib/activity.js'
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/routes/email-integrations.ts
git commit -m "feat(email): add send email endpoint with tracking pixel injection"
```

---

## Task 7: Email Open Tracking Endpoint

**Files:**

- Create: `apps/api/src/routes/email-tracking.ts`

- [ ] **Step 1: Create email-tracking.ts**

Create `apps/api/src/routes/email-tracking.ts`:

```typescript
import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { logActivity } from '../lib/activity.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
)

// GET /api/email-tracking/:token — PUBLIC, no auth
router.get('/:token', async (req: Request, res: Response) => {
  try {
    const token = req.params['token']

    // Validate UUID format loosely
    if (!token || token.length < 32) {
      return res
        .set('Content-Type', 'image/gif')
        .set('Cache-Control', 'no-cache, no-store, must-revalidate')
        .send(TRANSPARENT_GIF)
    }

    const supabase = getSupabase()

    const { data: message } = await supabase
      .from('email_messages')
      .select('id, contact_id, tenant_id, subject, open_count')
      .eq('tracking_token', token)
      .single()

    if (message) {
      const newCount = (message.open_count || 0) + 1
      await supabase
        .from('email_messages')
        .update({
          opened_at: new Date().toISOString(), // COALESCE handled by: first open sets it, subsequent opens overwrite (acceptable)
          open_count: newCount,
        })
        .eq('id', message.id)

      // Only log on first open to avoid timeline spam — but update open_count above always
      if (message.contact_id && message.open_count === 0) {
        await logActivity({
          tenantId: message.tenant_id,
          contactId: message.contact_id,
          type: 'email',
          body: `Opened email: ${message.subject || '(no subject)'}`,
          metadata: { email_message_id: message.id, open_count: newCount },
          actorType: 'contact',
        })
      }
    }

    return res
      .set('Content-Type', 'image/gif')
      .set('Cache-Control', 'no-cache, no-store, must-revalidate')
      .send(TRANSPARENT_GIF)
  } catch (err) {
    console.error('Email tracking error:', err)
    return res
      .set('Content-Type', 'image/gif')
      .set('Cache-Control', 'no-cache, no-store, must-revalidate')
      .send(TRANSPARENT_GIF)
  }
})

export default router
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/routes/email-tracking.ts
git commit -m "feat(email): add open tracking pixel endpoint"
```

---

## Task 8: BCC Logging

**Files:**

- Create: `apps/api/src/routes/email-inbound.ts`

- [ ] **Step 1: Create email-inbound.ts with BCC settings + webhook**

Create `apps/api/src/routes/email-inbound.ts`:

```typescript
import crypto from 'node:crypto'
import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { logActivity } from '../lib/activity.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// GET /api/settings/bcc-logging — get BCC address for tenant
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const { data: tenant } = await supabase
      .from('tenants')
      .select('bcc_logging_address')
      .eq('id', authed.tenantId)
      .single()

    return res.json({ bccAddress: tenant?.bcc_logging_address || null })
  } catch (err) {
    console.error('Get BCC address error:', err)
    return res.status(500).json({ error: 'Failed to get BCC address' })
  }
})

// POST /api/settings/bcc-logging/enable — generate BCC address
router.post('/enable', requireAuth, async (req: Request, res: Response) => {
  try {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    // Generate unique address using crypto.randomBytes (no nanoid dependency)
    const randomPart = crypto.randomBytes(5).toString('hex') // 10 hex chars
    const bccAddress = `log-${randomPart}@mail.nuatis.com`

    const { error } = await supabase
      .from('tenants')
      .update({ bcc_logging_address: bccAddress })
      .eq('id', authed.tenantId)

    if (error) return res.status(500).json({ error: error.message })
    return res.json({ bccAddress })
  } catch (err) {
    console.error('Enable BCC logging error:', err)
    return res.status(500).json({ error: 'Failed to enable BCC logging' })
  }
})

export default router

// Separate router for the public webhook — exported separately
export const emailInboundWebhookRouter = Router()

// POST /api/webhooks/email-inbound — PUBLIC, no auth
// Called by mail provider (SendGrid Inbound Parse, Mailgun, Postmark)
emailInboundWebhookRouter.post('/', async (req: Request, res: Response) => {
  try {
    const supabase = getSupabase()

    // Parse inbound email — support both SendGrid and generic JSON format
    let from: string
    let toAddresses: string[]
    let subject: string
    let html: string
    let text: string

    if (req.body.envelope) {
      // SendGrid Inbound Parse format
      const envelope =
        typeof req.body.envelope === 'string' ? JSON.parse(req.body.envelope) : req.body.envelope
      from = envelope.from || req.body.from || ''
      toAddresses = envelope.to || []
      subject = req.body.subject || ''
      html = req.body.html || ''
      text = req.body.text || ''
    } else {
      // Generic JSON format
      from = req.body.from || ''
      toAddresses = Array.isArray(req.body.to) ? req.body.to : [req.body.to || '']
      subject = req.body.subject || ''
      html = req.body.html || req.body.body_html || ''
      text = req.body.text || req.body.body_text || ''
    }

    // Extract email from "Name <email>" format if needed
    const fromEmail = from.includes('<') ? from.match(/<([^>]+)>/)?.[1] || from : from

    // Find tenant by matching BCC address
    const { data: tenants } = await supabase
      .from('tenants')
      .select('id, bcc_logging_address')
      .not('bcc_logging_address', 'is', null)

    const matchedTenant = tenants?.find((t) =>
      toAddresses.some((addr) => addr.includes(t.bcc_logging_address!))
    )

    if (!matchedTenant) {
      // No matching tenant — silently ignore
      return res.status(200).json({ ok: true })
    }

    // Match sender to contact
    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .eq('email', fromEmail)
      .eq('tenant_id', matchedTenant.id)
      .maybeSingle()

    // Determine direction: if from matches a user_email_accounts address → outbound
    const { data: userAccount } = await supabase
      .from('user_email_accounts')
      .select('id')
      .eq('email_address', fromEmail)
      .eq('tenant_id', matchedTenant.id)
      .maybeSingle()

    const direction = userAccount ? 'outbound' : 'inbound'

    // Determine to_address — use first non-BCC address, or BCC address itself
    const toAddress =
      toAddresses.find((a) => !a.includes(matchedTenant.bcc_logging_address!)) ||
      toAddresses[0] ||
      ''

    // Insert email message
    await supabase.from('email_messages').insert({
      tenant_id: matchedTenant.id,
      contact_id: contact?.id || null,
      direction,
      from_address: fromEmail,
      to_address: toAddress,
      subject,
      body_html: html || null,
      body_text: text || null,
      source: 'bcc',
    })

    // Log activity if contact found
    if (contact) {
      await logActivity({
        tenantId: matchedTenant.id,
        contactId: contact.id,
        type: 'email',
        body: `Email logged (BCC): ${subject || '(no subject)'}`,
        metadata: { direction, source: 'bcc' },
        actorType: direction === 'inbound' ? 'contact' : 'system',
      })
    }

    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('Email inbound webhook error:', err)
    return res.status(200).json({ ok: true }) // Always return 200 to prevent retries
  }
})
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/routes/email-inbound.ts
git commit -m "feat(email): add BCC logging settings and inbound webhook handler"
```

---

## Task 9: Email Templates API Routes

**Files:**

- Create: `apps/api/src/routes/email-templates.ts`

- [ ] **Step 1: Create email-templates.ts**

Create `apps/api/src/routes/email-templates.ts`:

```typescript
import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { resolveTemplate } from '../lib/email-templates.js'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// GET /api/email-templates — list templates
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    let query = supabase
      .from('email_templates')
      .select('id, name, subject, body, vertical, is_default, created_at, updated_at')
      .eq('tenant_id', authed.tenantId)
      .order('created_at', { ascending: false })

    const vertical = req.query['vertical'] as string | undefined
    if (vertical) {
      query = query.eq('vertical', vertical)
    }

    const { data, error } = await query
    if (error) return res.status(500).json({ error: error.message })
    return res.json(data || [])
  } catch (err) {
    console.error('List templates error:', err)
    return res.status(500).json({ error: 'Failed to list templates' })
  }
})

// GET /api/email-templates/:id — single template
router.get('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('email_templates')
      .select('id, name, subject, body, vertical, is_default, created_at, updated_at')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .single()

    if (error || !data) return res.status(404).json({ error: 'Template not found' })
    return res.json(data)
  } catch (err) {
    console.error('Get template error:', err)
    return res.status(500).json({ error: 'Failed to get template' })
  }
})

// GET /api/email-templates/:id/preview?contactId=xxx — preview with resolved merge tags
router.get('/:id/preview', requireAuth, async (req: Request, res: Response) => {
  try {
    const authed = req as AuthenticatedRequest
    const contactId = req.query['contactId'] as string
    if (!contactId) return res.status(400).json({ error: 'contactId query param required' })

    const supabase = getSupabase()

    const [templateRes, contactRes, tenantRes] = await Promise.all([
      supabase
        .from('email_templates')
        .select('subject, body')
        .eq('id', req.params['id'])
        .eq('tenant_id', authed.tenantId)
        .single(),
      supabase
        .from('contacts')
        .select('first_name, last_name, email, phone')
        .eq('id', contactId)
        .eq('tenant_id', authed.tenantId)
        .single(),
      supabase
        .from('tenants')
        .select('business_name, name, phone')
        .eq('id', authed.tenantId)
        .single(),
    ])

    if (!templateRes.data) return res.status(404).json({ error: 'Template not found' })
    if (!contactRes.data) return res.status(404).json({ error: 'Contact not found' })

    const resolved = resolveTemplate(templateRes.data, contactRes.data, tenantRes.data || {})
    return res.json(resolved)
  } catch (err) {
    console.error('Preview template error:', err)
    return res.status(500).json({ error: 'Failed to preview template' })
  }
})

// POST /api/email-templates — create template
router.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const authed = req as AuthenticatedRequest
    const { name, subject, body, vertical } = req.body

    if (!name || !subject || !body) {
      return res.status(400).json({ error: 'name, subject, and body are required' })
    }

    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('email_templates')
      .insert({
        tenant_id: authed.tenantId,
        name,
        subject,
        body,
        vertical: vertical || null,
      })
      .select('id, name, subject, body, vertical, is_default, created_at, updated_at')
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.status(201).json(data)
  } catch (err) {
    console.error('Create template error:', err)
    return res.status(500).json({ error: 'Failed to create template' })
  }
})

// PUT /api/email-templates/:id — update template
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authed = req as AuthenticatedRequest
    const { name, subject, body, vertical } = req.body

    if (!name || !subject || !body) {
      return res.status(400).json({ error: 'name, subject, and body are required' })
    }

    const supabase = getSupabase()

    // Verify belongs to tenant
    const { data: existing } = await supabase
      .from('email_templates')
      .select('id')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!existing) return res.status(404).json({ error: 'Template not found' })

    const { data, error } = await supabase
      .from('email_templates')
      .update({
        name,
        subject,
        body,
        vertical: vertical || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params['id'])
      .select('id, name, subject, body, vertical, is_default, created_at, updated_at')
      .single()

    if (error) return res.status(500).json({ error: error.message })
    return res.json(data)
  } catch (err) {
    console.error('Update template error:', err)
    return res.status(500).json({ error: 'Failed to update template' })
  }
})

// DELETE /api/email-templates/:id — delete template
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  try {
    const authed = req as AuthenticatedRequest
    const supabase = getSupabase()

    const { data: existing } = await supabase
      .from('email_templates')
      .select('id, is_default')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .single()

    if (!existing) return res.status(404).json({ error: 'Template not found' })
    if (existing.is_default)
      return res.status(400).json({ error: 'Cannot delete default template' })

    const { error } = await supabase.from('email_templates').delete().eq('id', req.params['id'])

    if (error) return res.status(500).json({ error: error.message })
    return res.json({ success: true })
  } catch (err) {
    console.error('Delete template error:', err)
    return res.status(500).json({ error: 'Failed to delete template' })
  }
})

export default router
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/routes/email-templates.ts
git commit -m "feat(email): add email templates CRUD and preview routes"
```

---

## Task 10: Template Seed Script

**Files:**

- Create: `apps/api/src/scripts/seed-email-templates.ts`

- [ ] **Step 1: Create seed-email-templates.ts**

Create `apps/api/src/scripts/seed-email-templates.ts`:

```typescript
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env['SUPABASE_URL'] || ''
const SUPABASE_SERVICE_ROLE_KEY = process.env['SUPABASE_SERVICE_ROLE_KEY'] || ''

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

interface Template {
  name: string
  subject: string
  body: string
}

const TEMPLATES: Record<string, Template[]> = {
  default: [
    {
      name: 'Welcome',
      subject: 'Welcome to {{business_name}}',
      body: "Hi {{first_name}},\n\nThank you for choosing {{business_name}}! We're excited to have you as a client.\n\nIf you have any questions, feel free to reach out to us at {{business_phone}}.\n\nBest regards,\n{{business_name}}",
    },
    {
      name: 'Appointment Reminder',
      subject: 'Your appointment tomorrow at {{business_name}}',
      body: 'Hi {{first_name}},\n\nThis is a friendly reminder about your appointment tomorrow at {{business_name}}.\n\nIf you need to reschedule, please call us at {{business_phone}}.\n\nSee you soon!\n{{business_name}}',
    },
    {
      name: 'Follow Up',
      subject: "We'd love to hear from you, {{first_name}}",
      body: "Hi {{first_name}},\n\nIt's been a while since your last visit to {{business_name}}. We'd love to see you again!\n\nFeel free to reach out at {{business_phone}} to schedule your next appointment.\n\nBest,\n{{business_name}}",
    },
  ],
  dental: [
    {
      name: 'Welcome',
      subject: 'Welcome to {{business_name}}',
      body: "Dear {{first_name}},\n\nThank you for choosing {{business_name}} for your dental care. We are committed to providing you with exceptional service and a comfortable experience.\n\nYour oral health is our priority. If you have any questions about your treatment plan, please don't hesitate to contact us at {{business_phone}}.\n\nWarm regards,\n{{business_name}}",
    },
    {
      name: 'Appointment Reminder',
      subject: 'Your dental appointment tomorrow at {{business_name}}',
      body: 'Dear {{first_name}},\n\nThis is a reminder about your dental appointment tomorrow at {{business_name}}.\n\nPlease remember to:\n- Arrive 10 minutes early\n- Bring your insurance card\n- Complete any pre-appointment forms\n\nNeed to reschedule? Call us at {{business_phone}}.\n\nSee you soon!\n{{business_name}}',
    },
    {
      name: 'Follow Up',
      subject: "We'd love to hear from you, {{first_name}}",
      body: "Dear {{first_name}},\n\nIt's been a while since your last visit to {{business_name}}. Regular dental check-ups are important for maintaining your oral health.\n\nWe'd love to schedule your next appointment. Please call us at {{business_phone}} or reply to this email.\n\nTo your health,\n{{business_name}}",
    },
  ],
  salon: [
    {
      name: 'Welcome',
      subject: 'Welcome to {{business_name}} ✨',
      body: "Hey {{first_name}}!\n\nSo glad you stopped by {{business_name}}! We loved having you and can't wait to see you again.\n\nHave questions? Just text or call us at {{business_phone}}.\n\nXO,\n{{business_name}}",
    },
    {
      name: 'Appointment Reminder',
      subject: 'See you tomorrow at {{business_name}}!',
      body: "Hey {{first_name}}!\n\nJust a reminder — you've got an appointment tomorrow at {{business_name}}. We can't wait to see you!\n\nNeed to change your time? Give us a call at {{business_phone}}.\n\nSee you soon!\n{{business_name}}",
    },
    {
      name: 'Follow Up',
      subject: 'We miss you, {{first_name}}! 💇',
      body: "Hey {{first_name}}!\n\nIt's been a minute! We'd love to get you back in the chair at {{business_name}}.\n\nReady to book? Call us at {{business_phone}} or just reply to this email.\n\nCan't wait to see you!\n{{business_name}}",
    },
  ],
  contractor: [
    {
      name: 'Welcome',
      subject: 'Welcome to {{business_name}}',
      body: "{{first_name}},\n\nThank you for choosing {{business_name}}. We appreciate your trust in our services.\n\nWe'll be in touch shortly regarding your project details. If you have any immediate questions, call us at {{business_phone}}.\n\nRegards,\n{{business_name}}",
    },
    {
      name: 'Appointment Reminder',
      subject: 'Your appointment tomorrow — {{business_name}}',
      body: '{{first_name}},\n\nReminder: we have an appointment scheduled for tomorrow.\n\nPlease ensure the work area is accessible. If you need to reschedule, contact us at {{business_phone}} as soon as possible.\n\nThanks,\n{{business_name}}',
    },
    {
      name: 'Follow Up',
      subject: 'Following up — {{business_name}}',
      body: "{{first_name}},\n\nWe wanted to follow up on our recent work together. If you have any additional projects or need further assistance, we're here to help.\n\nReach us at {{business_phone}}.\n\nBest,\n{{business_name}}",
    },
  ],
}

async function main() {
  const tenantId = process.argv[2]
  const vertical = process.argv[3] || 'default'

  if (!tenantId) {
    console.error(
      'Usage: npx tsx apps/api/src/scripts/seed-email-templates.ts <tenant_id> [vertical]'
    )
    process.exit(1)
  }

  const templates = TEMPLATES[vertical] || TEMPLATES['default']!

  for (const template of templates) {
    // Check if template with same name already exists (idempotent)
    const { data: existing } = await supabase
      .from('email_templates')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('name', template.name)
      .maybeSingle()

    if (existing) {
      console.log(`Skipping "${template.name}" — already exists`)
      continue
    }

    const { error } = await supabase.from('email_templates').insert({
      tenant_id: tenantId,
      name: template.name,
      subject: template.subject,
      body: template.body,
      vertical: vertical === 'default' ? null : vertical,
      is_default: true,
    })

    if (error) {
      console.error(`Failed to insert "${template.name}":`, error.message)
    } else {
      console.log(`Created template: "${template.name}"`)
    }
  }

  console.log('Done.')
}

main()
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/scripts/seed-email-templates.ts
git commit -m "feat(email): add email template seed script for default templates"
```

---

## Task 11: Wire Routes in Express App

**Files:**

- Modify: `apps/api/src/index.ts` (around line 59-102 where routes are mounted)

- [ ] **Step 1: Add route imports and mounting**

In `apps/api/src/index.ts`, add these imports near the top with the other route imports:

```typescript
import emailIntegrationsRouter from './routes/email-integrations.js'
import emailTemplatesRouter from './routes/email-templates.js'
import emailTrackingRouter from './routes/email-tracking.js'
import bccLoggingRouter, { emailInboundWebhookRouter } from './routes/email-inbound.js'
```

Add these route mounts after the existing `app.use(...)` lines (around line 102):

```typescript
app.use('/api/email-integrations', emailIntegrationsRouter)
app.use('/api/email-templates', emailTemplatesRouter)
app.use('/api/email-tracking', emailTrackingRouter) // PUBLIC — no auth on routes
app.use('/api/settings/bcc-logging', bccLoggingRouter)
app.use('/api/webhooks/email-inbound', emailInboundWebhookRouter) // PUBLIC — no auth
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(email): wire email routes into Express app"
```

---

## Task 12: Frontend — Settings → Integrations Page

**Files:**

- Create: `apps/web/src/app/(dashboard)/settings/integrations/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/Sidebar.tsx`

- [ ] **Step 1: Create integrations settings page**

Create `apps/web/src/app/(dashboard)/settings/integrations/page.tsx`:

```tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'

interface EmailAccount {
  id: string
  provider: 'gmail' | 'outlook'
  email_address: string
  is_default: boolean
  created_at: string
}

export default function IntegrationsPage() {
  const { data: session } = useSession()
  const searchParams = useSearchParams()
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [bccAddress, setBccAddress] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [toastMsg, setToastMsg] = useState('')
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const [generatingBcc, setGeneratingBcc] = useState(false)

  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001'

  const fetchData = useCallback(async () => {
    if (!session?.accessToken) return
    try {
      const [accountsRes, bccRes] = await Promise.all([
        fetch(`${apiUrl}/api/email-integrations`, {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        }),
        fetch(`${apiUrl}/api/settings/bcc-logging`, {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        }),
      ])
      if (accountsRes.ok) setAccounts(await accountsRes.json())
      if (bccRes.ok) {
        const bccData = await bccRes.json()
        setBccAddress(bccData.bccAddress)
      }
    } catch (err) {
      console.error('Failed to fetch integrations:', err)
    } finally {
      setLoading(false)
    }
  }, [session?.accessToken, apiUrl])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    if (searchParams.get('email') === 'connected') {
      setToastMsg('Email account connected successfully!')
      setTimeout(() => setToastMsg(''), 4000)
    } else if (searchParams.get('email') === 'error') {
      setToastMsg('Failed to connect email account. Please try again.')
      setTimeout(() => setToastMsg(''), 4000)
    }
  }, [searchParams])

  async function connectProvider(provider: 'gmail' | 'outlook') {
    if (!session?.accessToken) return
    try {
      const res = await fetch(`${apiUrl}/api/email-integrations/${provider}/auth-url`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      })
      if (!res.ok) throw new Error('Failed to get auth URL')
      const { url } = await res.json()
      window.location.href = url
    } catch (err) {
      console.error(`Failed to start ${provider} OAuth:`, err)
      setToastMsg(`Failed to connect ${provider}. Please try again.`)
      setTimeout(() => setToastMsg(''), 4000)
    }
  }

  async function disconnectAccount(id: string) {
    if (!session?.accessToken || !confirm('Disconnect this email account?')) return
    setDisconnecting(id)
    try {
      const res = await fetch(`${apiUrl}/api/email-integrations/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.accessToken}` },
      })
      if (res.ok) {
        setAccounts((prev) => prev.filter((a) => a.id !== id))
        setToastMsg('Account disconnected.')
        setTimeout(() => setToastMsg(''), 3000)
      }
    } catch (err) {
      console.error('Disconnect error:', err)
    } finally {
      setDisconnecting(null)
    }
  }

  async function enableBcc() {
    if (!session?.accessToken) return
    setGeneratingBcc(true)
    try {
      const res = await fetch(`${apiUrl}/api/settings/bcc-logging/enable`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.accessToken}` },
      })
      if (res.ok) {
        const data = await res.json()
        setBccAddress(data.bccAddress)
      }
    } catch (err) {
      console.error('Enable BCC error:', err)
    } finally {
      setGeneratingBcc(false)
    }
  }

  function copyBcc() {
    if (bccAddress) {
      navigator.clipboard.writeText(bccAddress)
      setToastMsg('BCC address copied!')
      setTimeout(() => setToastMsg(''), 2000)
    }
  }

  if (loading) {
    return (
      <div className="px-8 py-8">
        <p className="text-gray-500">Loading...</p>
      </div>
    )
  }

  return (
    <div className="px-8 py-8 max-w-2xl space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Integrations</h1>

      {toastMsg && (
        <div className="rounded-lg bg-teal-50 border border-teal-200 px-4 py-3 text-sm text-teal-800">
          {toastMsg}
        </div>
      )}

      {/* Email Accounts Section */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-800">Email Accounts</h2>
        <p className="text-sm text-gray-500">
          Connect your email to send messages directly from contact profiles.
        </p>

        <div className="flex gap-3">
          <button
            onClick={() => connectProvider('gmail')}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path
                fill="#EA4335"
                d="M5.266 9.765A7.077 7.077 0 0 1 12 4.909c1.69 0 3.218.6 4.418 1.582L19.91 3C17.782 1.145 15.055 0 12 0 7.27 0 3.198 2.698 1.24 6.65l4.026 3.115Z"
              />
              <path
                fill="#34A853"
                d="M16.04 18.013C14.95 18.717 13.56 19.091 12 19.091c-3.062 0-5.665-2.067-6.591-4.856L1.24 17.35C3.198 21.302 7.27 24 12 24c2.933 0 5.735-1.043 7.834-3l-3.793-2.987Z"
              />
              <path
                fill="#4A90D9"
                d="M19.834 21c2.195-2.048 3.62-5.096 3.62-9 0-.71-.109-1.473-.272-2.182H12v4.637h6.436c-.317 1.559-1.17 2.766-2.395 3.558L19.834 21Z"
              />
              <path
                fill="#FBBC05"
                d="M5.409 14.235A7.13 7.13 0 0 1 4.964 12c0-.778.148-1.533.405-2.235L1.24 6.65A11.96 11.96 0 0 0 0 12c0 1.936.465 3.77 1.24 5.35l4.17-3.115Z"
              />
            </svg>
            Connect Gmail
          </button>
          <button
            onClick={() => connectProvider('outlook')}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path
                fill="#0078D4"
                d="M24 7.387v10.478c0 .23-.08.424-.238.583a.793.793 0 0 1-.583.239h-9.142V7.09l1.166.917 8.56-3.69c.137.052.247.143.237.07Zm-10.813 0v11.3H.82a.793.793 0 0 1-.582-.239A.793.793 0 0 1 0 17.865V7.387L6.594 11.5l6.593-4.113ZM24 5.304 13.187 9.957 6.594 5.844 0 9.957V5.304c0-.23.08-.424.238-.583A.793.793 0 0 1 .82 4.48h22.36c.23 0 .424.08.583.24.158.159.237.353.237.584Z"
              />
            </svg>
            Connect Outlook
          </button>
        </div>

        {accounts.length > 0 && (
          <div className="space-y-2">
            {accounts.map((account) => (
              <div
                key={account.id}
                className="flex items-center justify-between rounded-lg border border-gray-100 bg-white px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium uppercase text-gray-400">
                    {account.provider}
                  </span>
                  <span className="text-sm text-gray-900">{account.email_address}</span>
                  {account.is_default && (
                    <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">
                      Default
                    </span>
                  )}
                </div>
                <button
                  onClick={() => disconnectAccount(account.id)}
                  disabled={disconnecting === account.id}
                  className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                >
                  {disconnecting === account.id ? 'Disconnecting...' : 'Disconnect'}
                </button>
              </div>
            ))}
          </div>
        )}

        {accounts.length === 0 && (
          <p className="text-sm text-gray-400">No email accounts connected yet.</p>
        )}
      </section>

      {/* BCC Email Logging Section */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-800">BCC Email Logging</h2>
        <p className="text-sm text-gray-500">
          Add this address to BCC when sending emails from any email client to automatically log
          them in your CRM timeline.
        </p>

        {bccAddress ? (
          <div className="flex items-center gap-3">
            <code className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-mono text-gray-800">
              {bccAddress}
            </code>
            <button
              onClick={copyBcc}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
            >
              Copy
            </button>
          </div>
        ) : (
          <button
            onClick={enableBcc}
            disabled={generatingBcc}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {generatingBcc ? 'Generating...' : 'Generate BCC Address'}
          </button>
        )}
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Add Integrations + Email Templates to sidebar nav**

In `apps/web/src/app/(dashboard)/Sidebar.tsx`, add two entries to the `NAV` array (around line 67, before the final `'/settings'` entry):

```typescript
{ href: '/settings/integrations', label: 'Integrations', icon: '🔗', suiteOnly: true },
{ href: '/settings/email-templates', label: 'Email Templates', icon: '📧', suiteOnly: true },
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/(dashboard)/settings/integrations/page.tsx apps/web/src/app/(dashboard)/Sidebar.tsx
git commit -m "feat(email): add Settings → Integrations page and sidebar nav items"
```

---

## Task 13: Frontend — Email Templates Settings Page

**Files:**

- Create: `apps/web/src/app/(dashboard)/settings/email-templates/page.tsx`

- [ ] **Step 1: Create email templates settings page**

Create `apps/web/src/app/(dashboard)/settings/email-templates/page.tsx`:

```tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'

interface Template {
  id: string
  name: string
  subject: string
  body: string
  vertical: string | null
  is_default: boolean
  created_at: string
}

const VERTICALS = ['dental', 'salon', 'contractor', 'medspa', 'fitness', 'auto', 'hvac']
const MERGE_TAGS = [
  '{{first_name}}',
  '{{last_name}}',
  '{{full_name}}',
  '{{email}}',
  '{{phone}}',
  '{{business_name}}',
  '{{business_phone}}',
]

export default function EmailTemplatesPage() {
  const { data: session } = useSession()
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Template | null>(null)
  const [form, setForm] = useState({ name: '', subject: '', body: '', vertical: '' })
  const [saving, setSaving] = useState(false)
  const [toastMsg, setToastMsg] = useState('')

  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001'

  const fetchTemplates = useCallback(async () => {
    if (!session?.accessToken) return
    try {
      const res = await fetch(`${apiUrl}/api/email-templates`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      })
      if (res.ok) setTemplates(await res.json())
    } catch (err) {
      console.error('Fetch templates error:', err)
    } finally {
      setLoading(false)
    }
  }, [session?.accessToken, apiUrl])

  useEffect(() => {
    fetchTemplates()
  }, [fetchTemplates])

  function openCreate() {
    setEditing(null)
    setForm({ name: '', subject: '', body: '', vertical: '' })
    setShowModal(true)
  }

  function openEdit(t: Template) {
    setEditing(t)
    setForm({ name: t.name, subject: t.subject, body: t.body, vertical: t.vertical || '' })
    setShowModal(true)
  }

  async function handleSave() {
    if (!session?.accessToken || !form.name || !form.subject || !form.body) return
    setSaving(true)
    try {
      const url = editing
        ? `${apiUrl}/api/email-templates/${editing.id}`
        : `${apiUrl}/api/email-templates`
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(form),
      })
      if (res.ok) {
        setShowModal(false)
        setToastMsg(editing ? 'Template updated!' : 'Template created!')
        setTimeout(() => setToastMsg(''), 3000)
        fetchTemplates()
      }
    } catch (err) {
      console.error('Save template error:', err)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(t: Template) {
    if (!session?.accessToken || !confirm(`Delete template "${t.name}"?`)) return
    try {
      const res = await fetch(`${apiUrl}/api/email-templates/${t.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.accessToken}` },
      })
      if (res.ok) {
        setTemplates((prev) => prev.filter((x) => x.id !== t.id))
        setToastMsg('Template deleted.')
        setTimeout(() => setToastMsg(''), 3000)
      } else {
        const err = await res.json()
        setToastMsg(err.error || 'Failed to delete')
        setTimeout(() => setToastMsg(''), 3000)
      }
    } catch (err) {
      console.error('Delete template error:', err)
    }
  }

  function insertTag(tag: string) {
    setForm((prev) => ({ ...prev, body: prev.body + tag }))
  }

  if (loading)
    return (
      <div className="px-8 py-8">
        <p className="text-gray-500">Loading...</p>
      </div>
    )

  return (
    <div className="px-8 py-8 max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Email Templates</h1>
        <button
          onClick={openCreate}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Create Template
        </button>
      </div>

      {toastMsg && (
        <div className="rounded-lg bg-teal-50 border border-teal-200 px-4 py-3 text-sm text-teal-800">
          {toastMsg}
        </div>
      )}

      {templates.length === 0 ? (
        <p className="text-sm text-gray-400">No templates yet. Create your first email template.</p>
      ) : (
        <div className="space-y-3">
          {templates.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between rounded-xl border border-gray-100 bg-white px-5 py-4"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">{t.name}</span>
                  {t.vertical && (
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                      {t.vertical}
                    </span>
                  )}
                  {t.is_default && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                      Default
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-500">{t.subject}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => openEdit(t)}
                  className="text-xs text-gray-600 hover:text-gray-900"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(t)}
                  disabled={t.is_default}
                  className="text-xs text-red-600 hover:text-red-800 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">
              {editing ? 'Edit Template' : 'Create Template'}
            </h2>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder="e.g. Welcome Email"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
              <input
                type="text"
                value={form.subject}
                onChange={(e) => setForm((prev) => ({ ...prev, subject: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder="e.g. Welcome to {{business_name}}"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Vertical (optional)
              </label>
              <select
                value={form.vertical}
                onChange={(e) => setForm((prev) => ({ ...prev, vertical: e.target.value }))}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                <option value="">All verticals</option>
                {VERTICALS.map((v) => (
                  <option key={v} value={v}>
                    {v.charAt(0).toUpperCase() + v.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Body</label>
              <div className="flex flex-wrap gap-1 mb-2">
                {MERGE_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => insertTag(tag)}
                    className="rounded border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-100"
                  >
                    {tag}
                  </button>
                ))}
              </div>
              <textarea
                value={form.body}
                onChange={(e) => setForm((prev) => ({ ...prev, body: e.target.value }))}
                rows={8}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder="Type your email body here..."
              />
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name || !form.subject || !form.body}
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {saving ? 'Saving...' : editing ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/(dashboard)/settings/email-templates/page.tsx
git commit -m "feat(email): add Settings → Email Templates page with CRUD and merge tag buttons"
```

---

## Task 14: Frontend — Email Compose Modal

**Files:**

- Create: `apps/web/src/components/contacts/EmailComposeModal.tsx`
- Modify: `apps/web/src/app/(dashboard)/contacts/[id]/ContactDetailClient.tsx`

- [ ] **Step 1: Create EmailComposeModal.tsx**

Create `apps/web/src/components/contacts/EmailComposeModal.tsx`:

```tsx
'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'

interface EmailAccount {
  id: string
  provider: 'gmail' | 'outlook'
  email_address: string
  is_default: boolean
}

interface Template {
  id: string
  name: string
  subject: string
}

interface Props {
  contactId: string
  contactEmail: string
  contactName: string
  onClose: () => void
  onSent: () => void
}

export default function EmailComposeModal({
  contactId,
  contactEmail,
  contactName,
  onClose,
  onSent,
}: Props) {
  const { data: session } = useSession()
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [subject, setSubject] = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [loadingAccounts, setLoadingAccounts] = useState(true)

  const apiUrl = process.env['NEXT_PUBLIC_API_URL'] || 'http://localhost:3001'

  useEffect(() => {
    if (!session?.accessToken) return

    async function load() {
      try {
        const [accRes, tplRes] = await Promise.all([
          fetch(`${apiUrl}/api/email-integrations`, {
            headers: { Authorization: `Bearer ${session!.accessToken}` },
          }),
          fetch(`${apiUrl}/api/email-templates`, {
            headers: { Authorization: `Bearer ${session!.accessToken}` },
          }),
        ])
        if (accRes.ok) {
          const data = await accRes.json()
          setAccounts(data)
          const def = data.find((a: EmailAccount) => a.is_default)
          if (def) setSelectedAccountId(def.id)
          else if (data.length > 0) setSelectedAccountId(data[0].id)
        }
        if (tplRes.ok) setTemplates(await tplRes.json())
      } catch (err) {
        console.error('Load compose data error:', err)
      } finally {
        setLoadingAccounts(false)
      }
    }
    load()
  }, [session?.accessToken, apiUrl])

  async function handleTemplateSelect(templateId: string) {
    setSelectedTemplateId(templateId)
    if (!templateId || !session?.accessToken) {
      // Clear template clears fields
      if (!templateId) {
        setSubject('')
        setBodyHtml('')
      }
      return
    }
    try {
      const res = await fetch(
        `${apiUrl}/api/email-templates/${templateId}/preview?contactId=${contactId}`,
        {
          headers: { Authorization: `Bearer ${session.accessToken}` },
        }
      )
      if (res.ok) {
        const { subject: s, body: b } = await res.json()
        setSubject(s)
        setBodyHtml(b)
      }
    } catch (err) {
      console.error('Template preview error:', err)
    }
  }

  async function handleSend() {
    if (!session?.accessToken || !selectedAccountId || !subject || !bodyHtml) return
    setSending(true)
    setError('')
    try {
      const res = await fetch(`${apiUrl}/api/email-integrations/send/${contactId}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subject,
          bodyHtml,
          bodyText: bodyHtml.replace(/<[^>]*>/g, ''), // basic strip tags for text fallback
          emailAccountId: selectedAccountId,
          templateId: selectedTemplateId || undefined,
        }),
      })
      if (res.ok) {
        onSent()
        onClose()
      } else {
        const data = await res.json()
        setError(data.error || 'Failed to send email')
      }
    } catch (err) {
      console.error('Send email error:', err)
      setError('Failed to send email')
    } finally {
      setSending(false)
    }
  }

  if (loadingAccounts) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    )
  }

  if (accounts.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Send Email</h2>
          <p className="text-sm text-gray-600">
            No email accounts connected. Connect Gmail or Outlook in{' '}
            <a href="/settings/integrations" className="text-teal-600 hover:underline">
              Settings → Integrations
            </a>
            .
          </p>
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Send Email to {contactName}</h2>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        {/* Template Picker */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Use Template</label>
          <select
            value={selectedTemplateId}
            onChange={(e) => handleTemplateSelect(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            <option value="">No template</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {/* From */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">From</label>
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.email_address} ({a.provider})
              </option>
            ))}
          </select>
        </div>

        {/* To */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">To</label>
          <input
            type="text"
            value={contactEmail}
            readOnly
            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500"
          />
        </div>

        {/* Subject */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            placeholder="Email subject"
          />
        </div>

        {/* Body */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Body</label>
          <textarea
            value={bodyHtml}
            onChange={(e) => setBodyHtml(e.target.value)}
            rows={8}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            placeholder="Email body..."
          />
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSend}
            disabled={sending || !subject || !bodyHtml || !selectedAccountId}
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {sending ? 'Sending...' : 'Send Email'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add Send Email button to ContactDetailClient**

In `apps/web/src/app/(dashboard)/contacts/[id]/ContactDetailClient.tsx`:

Add import at the top:

```typescript
import EmailComposeModal from '../../../../components/contacts/EmailComposeModal'
```

Add state variables (near the existing state declarations, around line 19-33):

```typescript
const [showEmailModal, setShowEmailModal] = useState(false)
const [contactEmail, setContactEmail] = useState('')
```

In the existing `useEffect` that fetches contact data (around line 35-67), after fetching contact, also capture the email:

```typescript
// Inside the fetch contact effect, after getting contact data:
setContactEmail(data.email || '')
```

Add the Send Email button in the component's JSX, just before the referral section (around line 107). Look for a good spot in the header area or the action buttons area — add it as a button:

```tsx
<button
  onClick={() => setShowEmailModal(true)}
  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
>
  ✉️ Send Email
</button>
```

At the bottom of the component's return JSX, before the closing `</div>`, add the modal:

```tsx
{
  showEmailModal && (
    <EmailComposeModal
      contactId={contactId}
      contactEmail={contactEmail}
      contactName={contactName}
      onClose={() => setShowEmailModal(false)}
      onSent={() => setRefreshKey((k) => k + 1)}
    />
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/contacts/EmailComposeModal.tsx apps/web/src/app/(dashboard)/contacts/[id]/ContactDetailClient.tsx
git commit -m "feat(email): add email compose modal with template picker on contact detail"
```

---

## Task 15: Enhanced Email Activity in Timeline

**Files:**

- Modify: `apps/web/src/components/contacts/ActivityTimeline.tsx`

The `email` type already exists in TYPE_CONFIG with blue-600 styling. We need to enhance the rendering to distinguish sent vs opened vs BCC.

- [ ] **Step 1: Update activity item rendering for email types**

In `apps/web/src/components/contacts/ActivityTimeline.tsx`, enhance the `renderItem` function (around lines 103-143) to handle email metadata.

Inside the `renderItem` function, after the body text rendering, add a metadata line for email types:

```tsx
{
  /* After the body text span, add: */
}
{
  item.type === 'email' && item.metadata && (
    <span className="text-xs text-gray-400">
      {item.metadata.direction === 'outbound' &&
        item.metadata.source !== 'bcc' &&
        !item.body?.startsWith('Opened') &&
        '📤 Sent'}
      {item.body?.startsWith('Opened') &&
        item.metadata.open_count > 1 &&
        ` — Opened ${item.metadata.open_count} times`}
      {item.metadata.source === 'bcc' &&
        `📋 ${item.metadata.direction === 'inbound' ? 'Received' : 'Sent'} (via BCC)`}
    </span>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/contacts/ActivityTimeline.tsx
git commit -m "feat(email): enhance activity timeline rendering for email events"
```

---

## Task 16: Run Tests & Verify

- [ ] **Step 1: Run the test suite**

```bash
cd /Users/sidyennamaneni/Documents/Nuatis/nuatis && npm test
```

Expected: 52/52 passing (1 EADDRINUSE is pre-existing, not a regression).

- [ ] **Step 2: Verify TypeScript compilation**

```bash
cd apps/api && npx tsc --noEmit
cd ../web && npx tsc --noEmit
```

Fix any type errors found.

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix(email): address type errors and test issues"
```

---

## Summary of All Route Registrations

| Route                                          | Auth        | File                  |
| ---------------------------------------------- | ----------- | --------------------- |
| `GET /api/email-integrations`                  | requireAuth | email-integrations.ts |
| `GET /api/email-integrations/gmail/auth-url`   | requireAuth | email-integrations.ts |
| `GET /api/email-integrations/gmail/callback`   | **PUBLIC**  | email-integrations.ts |
| `GET /api/email-integrations/outlook/auth-url` | requireAuth | email-integrations.ts |
| `GET /api/email-integrations/outlook/callback` | **PUBLIC**  | email-integrations.ts |
| `DELETE /api/email-integrations/:id`           | requireAuth | email-integrations.ts |
| `POST /api/email-integrations/send/:contactId` | requireAuth | email-integrations.ts |
| `GET /api/email-templates`                     | requireAuth | email-templates.ts    |
| `GET /api/email-templates/:id`                 | requireAuth | email-templates.ts    |
| `GET /api/email-templates/:id/preview`         | requireAuth | email-templates.ts    |
| `POST /api/email-templates`                    | requireAuth | email-templates.ts    |
| `PUT /api/email-templates/:id`                 | requireAuth | email-templates.ts    |
| `DELETE /api/email-templates/:id`              | requireAuth | email-templates.ts    |
| `GET /api/email-tracking/:token`               | **PUBLIC**  | email-tracking.ts     |
| `GET /api/settings/bcc-logging`                | requireAuth | email-inbound.ts      |
| `POST /api/settings/bcc-logging/enable`        | requireAuth | email-inbound.ts      |
| `POST /api/webhooks/email-inbound`             | **PUBLIC**  | email-inbound.ts      |
