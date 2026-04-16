# Web Chat Widget + Contact Auto-Enrichment + Data Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an embeddable web chat widget for customer websites, phone/email-based contact auto-enrichment, and full CRM data export with async ZIP generation.

**Architecture:** Chat uses public API endpoints with session-based trust (UUID). Visitor messages poll for replies; agent replies go through authenticated endpoints. The widget is vanilla JS served as a static file. Auto-enrichment uses a local area code lookup table (no external APIs). Data export uses a BullMQ worker to generate CSVs, compress with Node.js built-in zlib, upload to Supabase Storage with signed download URLs.

**Tech Stack:** Express routes, Supabase PostgreSQL, BullMQ workers, Next.js 14 App Router, Tailwind v3, vanilla JS (widget), Node.js zlib (compression).

**Key Codebase Facts:**

- Latest migration: `0038_multiple_pipelines.sql` → new migration is `0039`
- Workers: 15 current, factory pattern in workers/index.ts
- No CSV/ZIP libraries installed — use manual CSV generation + Node.js built-in `zlib` for gzip
- No Supabase Realtime in web app — chat uses polling (3s interval)
- SMS inbox: InboxList.tsx component, polling-based, lists threads by contact
- Supabase Storage: 'contact-attachments' bucket already configured
- CORS: currently `http://localhost:3000` dev / `https://nuatis.com` prod — chat needs permissive CORS
- Sidebar NAV: ~31 entries, last is '/settings'

---

## File Structure

### New Files — API

| File                                           | Responsibility                                  |
| ---------------------------------------------- | ----------------------------------------------- |
| `supabase/migrations/0039_chat_and_export.sql` | Chat tables, widget settings, export_jobs table |
| `apps/api/src/routes/chat-public.ts`           | Public chat endpoints (no auth)                 |
| `apps/api/src/routes/chat-agent.ts`            | Agent chat endpoints (auth)                     |
| `apps/api/src/routes/chat-settings.ts`         | Widget settings CRUD                            |
| `apps/api/src/routes/data-export.ts`           | Export job CRUD + download                      |
| `apps/api/src/lib/contact-enrichment.ts`       | Area code lookup + email domain extraction      |
| `apps/api/src/workers/export-worker.ts`        | BullMQ export job processor                     |

### New Files — Web

| File                                                         | Responsibility                      |
| ------------------------------------------------------------ | ----------------------------------- |
| `apps/web/public/widget/chat.js`                             | Embeddable chat widget (vanilla JS) |
| `apps/web/src/app/(dashboard)/settings/chat-widget/page.tsx` | Widget settings page                |
| `apps/web/src/app/(dashboard)/settings/data-export/page.tsx` | Data export page                    |

### Modified Files

| File                                                                 | Change                                      |
| -------------------------------------------------------------------- | ------------------------------------------- |
| `apps/api/src/routes/contacts.ts`                                    | Wire auto-enrichment on create/update       |
| `apps/api/src/routes/booking-public.ts`                              | Wire enrichment on booking contact creation |
| `apps/api/src/routes/chat-public.ts`                                 | Wire enrichment on chat contact creation    |
| `apps/api/src/workers/index.ts`                                      | Register export worker                      |
| `apps/api/src/index.ts`                                              | Mount chat + export routes, add chat CORS   |
| `apps/web/src/app/(dashboard)/Sidebar.tsx`                           | Add nav items                               |
| `apps/web/src/components/inbox/InboxList.tsx`                        | Add chat tab alongside SMS                  |
| `apps/web/src/app/(dashboard)/contacts/[id]/ContactDetailClient.tsx` | Add enrichment suggestion UI                |

---

## Task 1: Database Migration

**Files:**

- Create: `supabase/migrations/0039_chat_and_export.sql`

- [ ] **Step 1: Create migration** with chat_sessions, chat_messages (with Realtime publication), widget settings on tenants, export_jobs table.

- [ ] **Step 2: Commit**

---

## Task 2: Contact Auto-Enrichment Helper

**Files:**

- Create: `apps/api/src/lib/contact-enrichment.ts`

- [ ] **Step 1: Create enrichment helper** with:
- `enrichByPhone(phone)` → `{ city?, state?, timezone? }` using area code lookup (50+ US codes)
- `enrichByEmail(email)` → `{ suggestedCompany? }` from business domain extraction
- `autoEnrichContact(contact)` → combined enrichment, returns fields to update
- Area code lookup table as const object
- Skip common email providers (gmail, yahoo, outlook, etc.)

- [ ] **Step 2: Commit**

---

## Task 3: Wire Enrichment Into Contact CRUD

**Files:**

- Modify: `apps/api/src/routes/contacts.ts`
- Modify: `apps/api/src/routes/booking-public.ts`

- [ ] **Step 1: Wire enrichment** into contacts.ts POST (create) and PUT (update) handlers:
- After contact insert/update, if phone provided and city/state empty: run enrichByPhone, update contact
- If email provided and no company: run enrichByEmail, store suggestedCompany in custom_fields
- Also wire into booking-public.ts after contact creation

- [ ] **Step 2: Commit**

---

## Task 4: Public Chat API

**Files:**

- Create: `apps/api/src/routes/chat-public.ts`

- [ ] **Step 1: Create public chat routes** (NO requireAuth):
- POST /api/chat/init — create session, return greeting + settings
- POST /api/chat/message — visitor sends message, find-or-create contact, notify owner
- GET /api/chat/messages/:sessionId?after=timestamp — poll for messages
- POST /api/chat/end — close session

All use getSupabase() service role. Session UUID is the trust mechanism.

- [ ] **Step 2: Commit**

---

## Task 5: Agent Chat API

**Files:**

- Create: `apps/api/src/routes/chat-agent.ts`

- [ ] **Step 1: Create agent chat routes** (requireAuth):
- GET /api/chat/sessions — list sessions with unread counts
- GET /api/chat/sessions/:id — session detail with messages
- POST /api/chat/sessions/:id/reply — agent reply
- POST /api/chat/sessions/:id/close — close session
- POST /api/chat/sessions/:id/archive — archive session

- [ ] **Step 2: Commit**

---

## Task 6: Chat Widget Settings API

**Files:**

- Create: `apps/api/src/routes/chat-settings.ts`

- [ ] **Step 1: Create settings routes** (requireAuth):
- GET /api/settings/chat-widget — return enabled, color, greeting, position
- PUT /api/settings/chat-widget — update settings

- [ ] **Step 2: Commit**

---

## Task 7: Data Export Worker

**Files:**

- Create: `apps/api/src/workers/export-worker.ts`
- Create: `apps/api/src/routes/data-export.ts`

- [ ] **Step 1: Create export worker** — BullMQ job processor:
- Query each requested table for tenant data
- Generate CSV strings manually (header row + data rows, proper escaping)
- Combine CSVs into a single .tar.gz using Node.js built-in zlib + tar-stream approach (or just create individual CSV files and gzip a concatenated archive)
- Actually simpler: create individual CSVs, gzip each, upload to Supabase Storage
- Upload to Supabase Storage in `exports/{tenantId}/` path
- Generate signed download URL (48h)
- Update export_jobs with status, file_path, download_url

- [ ] **Step 2: Create export routes** (requireAuth, owner/admin):
- POST /api/settings/data-export — start export
- GET /api/settings/data-export — list export jobs
- GET /api/settings/data-export/:id/download — redirect to signed URL

- [ ] **Step 3: Commit**

---

## Task 8: Wire Routes + Register Worker

**Files:**

- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/src/workers/index.ts`

- [ ] **Step 1: Mount routes and add chat CORS**

Mount all new routes. For chat-public routes, add permissive CORS:

```typescript
import cors from 'cors'
// Before mounting chat routes:
app.use('/api/chat', cors({ origin: '*' }), chatPublicRouter)
app.use('/api/chat/sessions', chatAgentRouter) // auth routes
app.use('/api/settings/chat-widget', chatSettingsRouter)
app.use('/api/settings/data-export', dataExportRouter)
```

Wait — the chat public and agent routes overlap at /api/chat. Better approach:

- Public: `/api/chat` (init, message, messages, end) — with permissive CORS
- Agent: `/api/chat/sessions` (list, detail, reply, close, archive) — with standard CORS + auth

Register export worker in workers/index.ts.

- [ ] **Step 2: Commit**

---

## Task 9: Embeddable Chat Widget (Vanilla JS)

**Files:**

- Create: `apps/web/public/widget/chat.js`

- [ ] **Step 1: Create self-contained widget script**

Vanilla JS, no dependencies, < 15KB. Customer embeds:

```html
<script src="https://nuatis.com/widget/chat.js" data-tenant-id="xxx"></script>
```

Widget creates:

- Floating button (circular, positioned per tenant config)
- Expandable chat panel (350×500px)
- Pre-chat form (name, email, phone)
- Message thread (visitor right, agent left)
- Input + send button
- Polling every 3s for new messages
- Session persistence via localStorage
- Scoped styles (inline or shadow DOM)
- Mobile responsive (full-width < 480px)

- [ ] **Step 2: Commit**

---

## Task 10: Chat Widget Settings Page (Frontend)

**Files:**

- Create: `apps/web/src/app/(dashboard)/settings/chat-widget/page.tsx`

- [ ] **Step 1: Create settings page** with:
- Enable/disable toggle
- Color picker
- Greeting textarea
- Position radio (bottom-right/bottom-left)
- Embed code section with copy button
- Save button

- [ ] **Step 2: Commit**

---

## Task 11: Data Export Page (Frontend)

**Files:**

- Create: `apps/web/src/app/(dashboard)/settings/data-export/page.tsx`

- [ ] **Step 1: Create export page** with:
- Table checkboxes (contacts, activity_log, appointments, deals, quotes, tasks)
- Export button → POST
- Export history table with status badges, download buttons
- GDPR note

- [ ] **Step 2: Commit**

---

## Task 12: Chat in Inbox + Sidebar Nav

**Files:**

- Modify: `apps/web/src/components/inbox/InboxList.tsx`
- Modify: `apps/web/src/app/(dashboard)/Sidebar.tsx`

- [ ] **Step 1: Add chat tab to inbox**

Add "SMS" / "Chat" / "All" tabs at top of inbox. Chat tab fetches GET /api/chat/sessions and renders chat threads in same list format. Click opens chat thread with reply input.

- [ ] **Step 2: Add sidebar nav items**

Add before '/settings':

```typescript
{ href: '/settings/chat-widget', label: 'Chat Widget', icon: '💬', suiteOnly: true },
{ href: '/settings/data-export', label: 'Data Export', icon: '📥', suiteOnly: true },
```

- [ ] **Step 3: Commit**

---

## Task 13: Enrichment Suggestion UI on Contact Detail

**Files:**

- Modify: `apps/web/src/app/(dashboard)/contacts/[id]/ContactDetailClient.tsx`

- [ ] **Step 1: Add enrichment suggestion banner**

If contact has `enrichment_suggested_company` in custom_fields, show banner below company field:

- "Suggested company: {name} (from email domain)"
- "Link" button → creates/finds company, links contact
- "Dismiss" button → removes suggestion from custom_fields

- [ ] **Step 2: Commit**

---

## Task 14: Run Tests & Verify

- [ ] **Step 1: Run tests** — `npm test` — expect 52/52 passing
- [ ] **Step 2: Report** — `git log --oneline -3`

---

## Summary of All Route Registrations

| Route                                        | Auth        | File             |
| -------------------------------------------- | ----------- | ---------------- |
| `POST /api/chat/init`                        | **PUBLIC**  | chat-public.ts   |
| `POST /api/chat/message`                     | **PUBLIC**  | chat-public.ts   |
| `GET /api/chat/messages/:sessionId`          | **PUBLIC**  | chat-public.ts   |
| `POST /api/chat/end`                         | **PUBLIC**  | chat-public.ts   |
| `GET /api/chat/sessions`                     | requireAuth | chat-agent.ts    |
| `GET /api/chat/sessions/:id`                 | requireAuth | chat-agent.ts    |
| `POST /api/chat/sessions/:id/reply`          | requireAuth | chat-agent.ts    |
| `POST /api/chat/sessions/:id/close`          | requireAuth | chat-agent.ts    |
| `POST /api/chat/sessions/:id/archive`        | requireAuth | chat-agent.ts    |
| `GET /api/settings/chat-widget`              | requireAuth | chat-settings.ts |
| `PUT /api/settings/chat-widget`              | requireAuth | chat-settings.ts |
| `POST /api/settings/data-export`             | requireAuth | data-export.ts   |
| `GET /api/settings/data-export`              | requireAuth | data-export.ts   |
| `GET /api/settings/data-export/:id/download` | requireAuth | data-export.ts   |
