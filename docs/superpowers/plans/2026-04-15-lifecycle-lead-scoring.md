# Contact Lifecycle Stages + Lead Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add lifecycle stage tracking and automated lead scoring to Nuatis CRM — contacts progress through lifecycle stages, accumulate scores based on engagement/profile/behavior rules computed asynchronously via BullMQ, with configurable scoring rules and visual indicators throughout the UI.

**Architecture:** New columns on contacts (lifecycle_stage enum, lead_score, lead_grade) plus a lead_scoring_rules table for tenant-configurable weights. A BullMQ worker computes scores asynchronously triggered by engagement events (calls, appointments, emails, SMS, quotes, forms). A decay scanner runs daily to penalize inactive contacts. Lifecycle transitions auto-advance forward based on key events. Frontend displays lifecycle badges and score indicators on contact list, detail, and pipeline views.

**Tech Stack:** Express routes, Supabase PostgreSQL, BullMQ workers, Next.js 14 App Router, Tailwind v3, recharts (already installed).

**Key Codebase Facts:**

- Latest migration: `0035_intake_submissions.sql` → new migrations start at `0036`
- Import pattern: `.js` extensions in apps/api
- Auth: `requireAuth` → `AuthenticatedRequest` → `.tenantId`, `.userId`
- activity_log type: TEXT NOT NULL, no CHECK constraint — just add new type values to the ActivityType union in `apps/api/src/lib/activity.ts`
- Workers: 11 current, factory pattern `createXxx()` → `{ queue, worker }`, registered in `apps/api/src/workers/index.ts`
- BullMQ connection: `import { createBullMQConnection } from '../lib/bullmq-connection.js'`
- Contacts select: `id, full_name, email, phone, pipeline_stage, source, tags, notes, vertical_data, is_archived, last_contacted, created_at`
- Contacts filters: `q, pipeline_stage_id, source, tags, sort_by, sort_dir, created_from/to, last_contacted_from/to, has_open_quote, referral_source`
- Pipeline cards: rendered inline in pipeline/page.tsx (lines 100-137)
- Contact detail: sections at lines 119-255 in ContactDetailClient.tsx — add new sections around line 200
- Email send: POST handler at email-integrations.ts:377-498, add trigger after logActivity (~line 491)
- SMS inbound: handler at index.ts:347-464, add trigger after logActivity (~line 453)
- Quote accept/decline: quotes.ts POST /view/:token/accept (~line 845), /decline (~line 945)
- Sidebar NAV array in Sidebar.tsx

---

## File Structure

### New Files — API

| File                                                 | Responsibility                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| `supabase/migrations/0036_lifecycle_and_scoring.sql` | lifecycle_stage enum, lead_score columns, lead_scoring_rules table |
| `apps/api/src/lib/lead-scoring.ts`                   | computeLeadScore function                                          |
| `apps/api/src/lib/lifecycle.ts`                      | maybeAdvanceLifecycle function                                     |
| `apps/api/src/lib/lead-score-queue.ts`               | Shared BullMQ queue instance for lead scoring                      |
| `apps/api/src/workers/lead-score-worker.ts`          | Score compute + bulk + decay workers                               |
| `apps/api/src/routes/lead-scoring.ts`                | Scoring settings API routes                                        |
| `apps/api/src/scripts/seed-lead-scoring-rules.ts`    | Default rules seeder                                               |

### New Files — Web

| File                                                          | Responsibility                              |
| ------------------------------------------------------------- | ------------------------------------------- |
| `apps/web/src/app/(dashboard)/settings/lead-scoring/page.tsx` | Scoring rules settings + distribution chart |

### Modified Files

| File                                                                 | Change                                                                              |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `apps/api/src/lib/activity.ts`                                       | Add 'lead_score' and 'lifecycle_change' to ActivityType                             |
| `apps/api/src/routes/contacts.ts`                                    | Add lifecycle_stage/lead_score to SELECT, add filters, add PATCH lifecycle endpoint |
| `apps/api/src/routes/email-integrations.ts`                          | Add score trigger after email sent                                                  |
| `apps/api/src/routes/quotes.ts`                                      | Add score trigger after accept/decline, lifecycle advancement                       |
| `apps/api/src/routes/booking-public.ts`                              | Add score trigger after booking confirmed                                           |
| `apps/api/src/index.ts`                                              | Add score trigger after inbound SMS, mount new routes, register workers             |
| `apps/api/src/workers/index.ts`                                      | Register 3 new workers                                                              |
| `apps/web/src/app/(dashboard)/Sidebar.tsx`                           | Add Lead Scoring nav item                                                           |
| `apps/web/src/app/(dashboard)/contacts/[id]/ContactDetailClient.tsx` | Add lifecycle + lead score sections                                                 |
| `apps/web/src/components/contacts/ContactsList.tsx`                  | Add lifecycle badge + score columns + filters                                       |
| `apps/web/src/app/(dashboard)/pipeline/page.tsx`                     | Add score + lifecycle badge on cards                                                |

---

## Task 1: Database Migration

**Files:**

- Create: `supabase/migrations/0036_lifecycle_and_scoring.sql`

- [ ] **Step 1: Create migration**

Create `supabase/migrations/0036_lifecycle_and_scoring.sql`:

```sql
-- Lifecycle stage enum
DO $$ BEGIN
  CREATE TYPE lifecycle_stage AS ENUM (
    'subscriber', 'lead', 'marketing_qualified', 'sales_qualified',
    'opportunity', 'customer', 'evangelist', 'other'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add lifecycle + scoring columns to contacts
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lifecycle_stage lifecycle_stage DEFAULT 'lead';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_score INTEGER DEFAULT 0;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_score_updated_at TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_grade TEXT CHECK (lead_grade IN ('A', 'B', 'C', 'D', 'F'));

-- Add check constraint for lead_score range
ALTER TABLE contacts ADD CONSTRAINT chk_lead_score_range CHECK (lead_score >= 0 AND lead_score <= 100);

CREATE INDEX IF NOT EXISTS idx_contacts_lifecycle ON contacts(tenant_id, lifecycle_stage);
CREATE INDEX IF NOT EXISTS idx_contacts_lead_score ON contacts(tenant_id, lead_score DESC);

-- Lead scoring rules table
CREATE TABLE lead_scoring_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  category TEXT NOT NULL CHECK (category IN ('engagement', 'profile', 'behavior', 'decay')),
  rule_key TEXT NOT NULL,
  label TEXT NOT NULL,
  points INTEGER NOT NULL,
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, rule_key)
);

ALTER TABLE lead_scoring_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON lead_scoring_rules
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE authjs_user_id = auth.uid()));
CREATE INDEX idx_lead_scoring_rules_tenant ON lead_scoring_rules(tenant_id);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0036_lifecycle_and_scoring.sql
git commit -m "feat(scoring): add lifecycle stage enum, lead scoring columns, and rules table"
```

---

## Task 2: Lead Scoring Engine + Queue

**Files:**

- Create: `apps/api/src/lib/lead-scoring.ts`
- Create: `apps/api/src/lib/lead-score-queue.ts`
- Create: `apps/api/src/lib/lifecycle.ts`
- Modify: `apps/api/src/lib/activity.ts` (add new types to ActivityType)

- [ ] **Step 1: Create lead-score-queue.ts** — shared queue instance

Create `apps/api/src/lib/lead-score-queue.ts`:

```typescript
import { Queue } from 'bullmq'
import { createBullMQConnection } from './bullmq-connection.js'

let _queue: Queue | null = null

export function getLeadScoreQueue(): Queue {
  if (!_queue) {
    _queue = new Queue('lead-score-compute', { connection: createBullMQConnection() })
  }
  return _queue
}

let _bulkQueue: Queue | null = null

export function getLeadScoreBulkQueue(): Queue {
  if (!_bulkQueue) {
    _bulkQueue = new Queue('lead-score-bulk', { connection: createBullMQConnection() })
  }
  return _bulkQueue
}

/**
 * Fire-and-forget: enqueue a score recompute for a contact.
 * Safe to call from any request handler — never blocks the response.
 */
export function enqueueScoreCompute(tenantId: string, contactId: string, trigger: string): void {
  getLeadScoreQueue()
    .add(
      'compute',
      { tenantId, contactId, trigger },
      { attempts: 2, backoff: { type: 'fixed', delay: 5000 } }
    )
    .catch((err) => console.error('[lead-score-queue] Failed to enqueue:', err))
}
```

- [ ] **Step 2: Create lead-scoring.ts** — score computation

Create `apps/api/src/lib/lead-scoring.ts`:

```typescript
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

interface ScoringRule {
  rule_key: string
  category: string
  points: number
  is_active: boolean
}

interface ScoreResult {
  score: number
  grade: string
  breakdown: Record<string, number>
}

function computeGrade(score: number): string {
  if (score >= 80) return 'A'
  if (score >= 60) return 'B'
  if (score >= 40) return 'C'
  if (score >= 20) return 'D'
  return 'F'
}

export async function computeLeadScore(tenantId: string, contactId: string): Promise<ScoreResult> {
  const supabase = getSupabase()

  // Fetch active rules for tenant
  const { data: rules } = await supabase
    .from('lead_scoring_rules')
    .select('rule_key, category, points, is_active')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)

  if (!rules || rules.length === 0) {
    return { score: 0, grade: 'F', breakdown: {} }
  }

  const ruleMap = new Map<string, ScoringRule>()
  for (const r of rules) ruleMap.set(r.rule_key, r)

  // Fetch contact data
  const { data: contact } = await supabase
    .from('contacts')
    .select('id, email, phone, address, city, referred_by_contact_id')
    .eq('id', contactId)
    .eq('tenant_id', tenantId)
    .single()

  if (!contact) return { score: 0, grade: 'F', breakdown: {} }

  // Fetch activity counts
  const { data: activities } = await supabase
    .from('activity_log')
    .select('type, body, metadata, created_at')
    .eq('contact_id', contactId)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  const allActivities = activities || []

  // Fetch appointments
  const { data: appointments } = await supabase
    .from('appointments')
    .select('id, status')
    .eq('contact_id', contactId)
    .eq('tenant_id', tenantId)

  // Fetch quotes
  const { data: quotes } = await supabase
    .from('quotes')
    .select('id, status')
    .eq('contact_id', contactId)
    .eq('tenant_id', tenantId)

  const breakdown: Record<string, number> = {}

  function applyRule(key: string, count: number = 1): void {
    const rule = ruleMap.get(key)
    if (rule) {
      breakdown[key] = rule.points * count
    }
  }

  // --- Engagement signals ---
  const callCount = allActivities.filter((a) => a.type === 'call').length
  if (callCount > 0) applyRule('call_completed', Math.min(callCount, 5)) // Cap at 5 occurrences

  const apptBooked = (appointments || []).length
  if (apptBooked > 0) applyRule('appointment_booked', Math.min(apptBooked, 3))

  const apptAttended = (appointments || []).filter((a) => a.status === 'completed').length
  if (apptAttended > 0) applyRule('appointment_attended', Math.min(apptAttended, 3))

  const emailOpened = allActivities.filter(
    (a) => a.type === 'email' && a.body?.startsWith('Opened')
  ).length
  if (emailOpened > 0) applyRule('email_opened', Math.min(emailOpened, 5))

  const emailReplied = allActivities.filter(
    (a) => a.type === 'email' && a.metadata?.direction === 'inbound'
  ).length
  if (emailReplied > 0) applyRule('email_replied', Math.min(emailReplied, 3))

  const smsReplied = allActivities.filter(
    (a) => a.type === 'sms' && a.metadata?.direction === 'inbound'
  ).length
  if (smsReplied > 0) applyRule('sms_replied', Math.min(smsReplied, 3))

  const formSubmitted = allActivities.filter(
    (a) => a.type === 'system' && a.body?.includes('Intake form')
  ).length
  if (formSubmitted > 0) applyRule('form_submitted', Math.min(formSubmitted, 2))

  const quoteViewed = allActivities.filter(
    (a) => a.type === 'quote' && a.body?.includes('viewed')
  ).length
  if (quoteViewed > 0) applyRule('quote_viewed', Math.min(quoteViewed, 3))

  const quoteAccepted = (quotes || []).filter((q) => q.status === 'accepted').length
  if (quoteAccepted > 0) applyRule('quote_accepted', Math.min(quoteAccepted, 2))

  // --- Profile completeness ---
  if (contact.email) applyRule('has_email')
  if (contact.phone) applyRule('has_phone')
  if (contact.address || contact.city) applyRule('has_address')
  if (contact.referred_by_contact_id) applyRule('referred_contact')

  // --- Negative / Behavior ---
  const noShows = (appointments || []).filter((a) => a.status === 'no_show').length
  if (noShows > 0) applyRule('appointment_no_show', Math.min(noShows, 3))

  const quoteDeclined = (quotes || []).filter((q) => q.status === 'declined').length
  if (quoteDeclined > 0) applyRule('quote_declined', Math.min(quoteDeclined, 2))

  // --- Decay ---
  const lastActivityDate = allActivities.length > 0 ? new Date(allActivities[0]!.created_at) : null
  if (lastActivityDate) {
    const daysSince = Math.floor((Date.now() - lastActivityDate.getTime()) / (1000 * 60 * 60 * 24))
    if (daysSince >= 90) applyRule('inactive_90d')
    else if (daysSince >= 60) applyRule('inactive_60d')
    else if (daysSince >= 30) applyRule('inactive_30d')
  } else {
    // No activity at all — apply max decay
    applyRule('inactive_90d')
  }

  // Sum and clamp
  const rawScore = Object.values(breakdown).reduce((sum, pts) => sum + pts, 0)
  const score = Math.max(0, Math.min(100, rawScore))
  const grade = computeGrade(score)

  return { score, grade, breakdown }
}
```

- [ ] **Step 3: Create lifecycle.ts** — auto-advance helper

Create `apps/api/src/lib/lifecycle.ts`:

```typescript
import { createClient } from '@supabase/supabase-js'
import { logActivity } from './activity.js'

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

// Lifecycle stages in order — only advance forward
const STAGE_ORDER = [
  'subscriber',
  'lead',
  'marketing_qualified',
  'sales_qualified',
  'opportunity',
  'customer',
  'evangelist',
]

/**
 * Attempt to advance a contact's lifecycle stage. Only moves forward, never backward.
 * Returns the new stage if changed, null if no change.
 */
export async function maybeAdvanceLifecycle(
  tenantId: string,
  contactId: string,
  targetStage: string,
  actorId?: string
): Promise<string | null> {
  const supabase = getSupabase()

  const { data: contact } = await supabase
    .from('contacts')
    .select('lifecycle_stage')
    .eq('id', contactId)
    .eq('tenant_id', tenantId)
    .single()

  if (!contact) return null

  const currentIndex = STAGE_ORDER.indexOf(contact.lifecycle_stage || 'lead')
  const targetIndex = STAGE_ORDER.indexOf(targetStage)

  // Only advance forward (higher index)
  if (targetIndex <= currentIndex) return null

  const { error } = await supabase
    .from('contacts')
    .update({ lifecycle_stage: targetStage, updated_at: new Date().toISOString() })
    .eq('id', contactId)
    .eq('tenant_id', tenantId)

  if (error) {
    console.error('[lifecycle] Failed to advance:', error)
    return null
  }

  await logActivity({
    tenantId,
    contactId,
    type: 'lifecycle_change',
    body: `Lifecycle stage changed: ${contact.lifecycle_stage} → ${targetStage}`,
    metadata: { old_stage: contact.lifecycle_stage, new_stage: targetStage, auto: true },
    actorType: 'system',
    actorId,
  })

  return targetStage
}
```

- [ ] **Step 4: Update activity.ts** — add new type values

In `apps/api/src/lib/activity.ts`, add `'lead_score'` and `'lifecycle_change'` to the ActivityType union type.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/lead-scoring.ts apps/api/src/lib/lead-score-queue.ts apps/api/src/lib/lifecycle.ts apps/api/src/lib/activity.ts
git commit -m "feat(scoring): add lead scoring engine, lifecycle helper, and score queue"
```

---

## Task 3: BullMQ Workers

**Files:**

- Create: `apps/api/src/workers/lead-score-worker.ts`
- Modify: `apps/api/src/workers/index.ts`

- [ ] **Step 1: Create lead-score-worker.ts**

Create `apps/api/src/workers/lead-score-worker.ts` with 3 workers:

1. **lead-score-compute**: processes individual score jobs, calls computeLeadScore, updates contacts table, logs activity if score changed significantly (±10 or grade changed)
2. **lead-score-bulk**: receives { tenantId }, fetches all non-archived contacts, enqueues individual compute jobs with small delay
3. **lead-score-decay**: repeatable every 24 hours, scans all tenants for contacts with stale activity, enqueues compute jobs

Factory export: `createLeadScoreWorkers()` → `{ queues: Queue[], workers: Worker[] }`

Follow the existing worker pattern from `lead-stalled-scanner.ts`:

```typescript
import { Queue, Worker } from 'bullmq'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { computeLeadScore } from '../lib/lead-scoring.js'
import { logActivity } from '../lib/activity.js'
import { createClient } from '@supabase/supabase-js'
```

- [ ] **Step 2: Register in workers/index.ts**

Add import and registration in `startWorkers()` — the factory returns multiple queues/workers, add them all to the `managed` array.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/workers/lead-score-worker.ts apps/api/src/workers/index.ts
git commit -m "feat(scoring): add lead score compute, bulk, and decay BullMQ workers"
```

---

## Task 4: Score Triggers — Wire Into Existing Handlers

**Files to modify:**

- `apps/api/src/routes/email-integrations.ts` — after email sent (~line 491)
- `apps/api/src/routes/quotes.ts` — after accept (~line 939) and decline (~line 1015)
- `apps/api/src/routes/booking-public.ts` — after booking confirmed
- `apps/api/src/routes/contacts.ts` — after contact create/update
- `apps/api/src/routes/email-tracking.ts` — after email opened
- `apps/api/src/index.ts` — after inbound SMS (~line 453)

- [ ] **Step 1: Add score triggers**

In each file, add:

```typescript
import { enqueueScoreCompute } from '../lib/lead-score-queue.js'
```

Then after the relevant event, add a fire-and-forget call:

```typescript
enqueueScoreCompute(tenantId, contactId, 'trigger_name')
```

Trigger points:

- **email-integrations.ts**: after `logActivity` in send handler → `enqueueScoreCompute(authed.tenantId, contactId, 'email_sent')`
- **email-tracking.ts**: after open count update → `enqueueScoreCompute(message.tenant_id, message.contact_id, 'email_opened')`
- **quotes.ts**: after accept → `enqueueScoreCompute(tenantId, contactId, 'quote_accepted')` + call `maybeAdvanceLifecycle(tenantId, contactId, 'opportunity')`
- **quotes.ts**: after decline → `enqueueScoreCompute(tenantId, contactId, 'quote_declined')`
- **booking-public.ts**: after appointment created → `enqueueScoreCompute(tenant.id, contactId, 'appointment_booked')`
- **contacts.ts**: after contact create → `enqueueScoreCompute(authed.tenantId, newContact.id, 'contact_created')`
- **contacts.ts**: after contact update → `enqueueScoreCompute(authed.tenantId, contactId, 'contact_updated')`
- **index.ts**: after inbound SMS logged → `enqueueScoreCompute(tenantId, contact.id, 'sms_inbound')` (only if contact matched)

Also add lifecycle advancement:

- **quotes.ts** accept handler: `maybeAdvanceLifecycle(tenantId, contactId, 'opportunity')`
- **booking-public.ts**: contacts created with source='booking_page' already default to 'lead'

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/routes/email-integrations.ts apps/api/src/routes/quotes.ts apps/api/src/routes/booking-public.ts apps/api/src/routes/contacts.ts apps/api/src/routes/email-tracking.ts apps/api/src/index.ts
git commit -m "feat(scoring): wire score triggers into email, quotes, booking, SMS, contacts"
```

---

## Task 5: Lead Scoring API Routes + Contacts Enhancements

**Files:**

- Create: `apps/api/src/routes/lead-scoring.ts`
- Modify: `apps/api/src/routes/contacts.ts` — add lifecycle/score to SELECT, add filters, add PATCH endpoint

- [ ] **Step 1: Create lead-scoring.ts** — settings routes

All routes use requireAuth:

- `GET /api/settings/lead-scoring` — rules grouped by category
- `PUT /api/settings/lead-scoring/rules/:id` — update rule (points, is_active, label)
- `POST /api/settings/lead-scoring/rules` — add custom rule
- `DELETE /api/settings/lead-scoring/rules/:id` — delete custom rule
- `POST /api/settings/lead-scoring/rescore-all` — enqueue bulk re-score
- `GET /api/settings/lead-scoring/distribution` — score distribution (count per grade, avg, median)

- [ ] **Step 2: Modify contacts.ts** — add lifecycle/score to responses + filters + PATCH lifecycle

In GET /api/contacts: add `lifecycle_stage, lead_score, lead_grade` to the SELECT string.

Add query param filters:

- `lifecycle_stage` (comma-separated) → `.in('lifecycle_stage', stages)`
- `min_score` / `max_score` → `.gte('lead_score', min)` / `.lte('lead_score', max)`
- `grade` (comma-separated) → `.in('lead_grade', grades)`

Add sort option: `lead_score` as valid sort_by value.

Add `PATCH /api/contacts/:id/lifecycle` route:

- Body: { lifecycle_stage }
- Validate enum value
- UPDATE + logActivity type='lifecycle_change'

Add `PATCH /api/contacts/bulk/lifecycle` route:

- Body: { contactIds, lifecycle_stage }
- UPDATE all + logActivity each

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/lead-scoring.ts apps/api/src/routes/contacts.ts
git commit -m "feat(scoring): add lead scoring settings API and contacts lifecycle/score endpoints"
```

---

## Task 6: Seed Script + Wire Routes

**Files:**

- Create: `apps/api/src/scripts/seed-lead-scoring-rules.ts`
- Modify: `apps/api/src/index.ts` — mount lead-scoring routes

- [ ] **Step 1: Create seed script**

Seeds all default rules from the spec (engagement, profile, behavior, decay categories). Idempotent via tenant_id + rule_key unique constraint.

Usage: `npx tsx apps/api/src/scripts/seed-lead-scoring-rules.ts <tenant_id>`

- [ ] **Step 2: Mount routes in index.ts**

```typescript
import leadScoringRouter from './routes/lead-scoring.js'
app.use('/api/settings/lead-scoring', leadScoringRouter)
```

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/scripts/seed-lead-scoring-rules.ts apps/api/src/index.ts
git commit -m "feat(scoring): add scoring rules seed script and wire routes"
```

---

## Task 7: Frontend — Contact List Enhancements

**Files:**

- Modify: `apps/web/src/components/contacts/ContactsList.tsx`

- [ ] **Step 1: Add lifecycle badge + lead score columns to contact table**

Add two new columns after the Stage column:

- **Lifecycle**: colored badge (subscriber=gray, lead=blue, marketing_qualified=purple, sales_qualified=orange, opportunity=yellow, customer=green, evangelist=emerald)
- **Score**: number + grade badge (A=green, B=blue, C=yellow, D=orange, F=red)

- [ ] **Step 2: Add filters**

Add to FilterState and filter UI:

- `lifecycle_stage` — multi-select checkboxes (8 values)
- `lead_grade` — multi-select checkboxes (A/B/C/D/F)

Add sort option: "Lead Score" in sort dropdown.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/contacts/ContactsList.tsx
git commit -m "feat(scoring): add lifecycle badge, lead score column, and filters to contact list"
```

---

## Task 8: Frontend — Contact Detail Enhancements

**Files:**

- Modify: `apps/web/src/app/(dashboard)/contacts/[id]/ContactDetailClient.tsx`

- [ ] **Step 1: Add Lifecycle Stage section**

After the referral info section (~line 200), add:

- Lifecycle stage displayed as large colored badge
- Dropdown to change manually → PATCH /api/contacts/:id/lifecycle
- Stage change refreshes timeline

- [ ] **Step 2: Add Lead Score section**

Below lifecycle:

- Large score number + grade badge
- Last updated timestamp
- "Recalculate" button → enqueues score compute (POST to a simple endpoint or call /rescore-all for one contact)
- Expandable breakdown section showing rules that contributed points

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(dashboard)/contacts/[id]/ContactDetailClient.tsx"
git commit -m "feat(scoring): add lifecycle dropdown and lead score display to contact detail"
```

---

## Task 9: Frontend — Pipeline Card Enhancements

**Files:**

- Modify: `apps/web/src/app/(dashboard)/pipeline/page.tsx`

- [ ] **Step 1: Add score + lifecycle to pipeline cards**

On each pipeline card (lines 100-137):

- Add lead score number + grade badge (small, right-aligned)
- Add lifecycle stage as a small badge below the contact name
- Both with appropriate color coding

Need to add `lifecycle_stage, lead_score, lead_grade` to the data fetch for pipeline contacts.

- [ ] **Step 2: Commit**

```bash
git add "apps/web/src/app/(dashboard)/pipeline/page.tsx"
git commit -m "feat(scoring): add lead score and lifecycle badge to pipeline cards"
```

---

## Task 10: Frontend — Lead Scoring Settings Page

**Files:**

- Create: `apps/web/src/app/(dashboard)/settings/lead-scoring/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/Sidebar.tsx`

- [ ] **Step 1: Create settings page**

- Distribution chart at top: bar chart showing contacts per grade (A/B/C/D/F) using recharts BarChart
- Rules editor with category tabs: Engagement, Profile, Behavior, Decay
- Each rule: label, description, points input (editable), active toggle
- "Add Custom Rule" button with modal
- "Re-score All Contacts" button with confirmation

- [ ] **Step 2: Add sidebar nav**

Add to NAV array before '/settings':

```typescript
{ href: '/settings/lead-scoring', label: 'Lead Scoring', icon: '📊', suiteOnly: true },
```

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(dashboard)/settings/lead-scoring/page.tsx" "apps/web/src/app/(dashboard)/Sidebar.tsx"
git commit -m "feat(scoring): add lead scoring settings page with distribution chart and rules editor"
```

---

## Task 11: Run Tests & Verify

- [ ] **Step 1: Run tests**

```bash
npm test
```

Expected: 52/52 passing.

- [ ] **Step 2: Report**

```bash
git log --oneline -5
```

---

## Summary of All Route Registrations

| Route                                         | Auth        | File            |
| --------------------------------------------- | ----------- | --------------- |
| `GET /api/settings/lead-scoring`              | requireAuth | lead-scoring.ts |
| `PUT /api/settings/lead-scoring/rules/:id`    | requireAuth | lead-scoring.ts |
| `POST /api/settings/lead-scoring/rules`       | requireAuth | lead-scoring.ts |
| `DELETE /api/settings/lead-scoring/rules/:id` | requireAuth | lead-scoring.ts |
| `POST /api/settings/lead-scoring/rescore-all` | requireAuth | lead-scoring.ts |
| `GET /api/settings/lead-scoring/distribution` | requireAuth | lead-scoring.ts |
| `PATCH /api/contacts/:id/lifecycle`           | requireAuth | contacts.ts     |
| `PATCH /api/contacts/bulk/lifecycle`          | requireAuth | contacts.ts     |
