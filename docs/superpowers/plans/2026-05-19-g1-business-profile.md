# G1 Business Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `business_profile` JSONB column to `locations`, expose GET/PUT API routes, render a 4-section settings page, and auto-inject structured business data into Maya's system prompt.

**Architecture:** A JSONB column on `locations` holds hours/services/staff/FAQs. An Express route reads/writes it. The settings page (Next.js App Router server + client) lets users populate the four sections with per-section saves. At call time, `getLocationConfig` in `telnyx-handler.ts` fetches the profile, `buildBusinessKnowledgeBlock` formats it, and `createGeminiLiveSession` injects it into the system prompt after the knowledge base section and before BOOKING_CONTRACT.

**Tech Stack:** PostgreSQL/Supabase (JSONB), Express + TypeScript, Next.js 14 App Router, Tailwind CSS, Jest

---

## File Map

| Action | Path                                                                             | Responsibility                                                                               |
| ------ | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Create | `supabase/migrations/0082_business_profile.sql`                                  | Add `business_profile` JSONB column to `locations`                                           |
| Modify | `packages/shared/src/types/index.ts`                                             | Add `DayHours`, `BusinessHours`, `ServiceEntry`, `StaffEntry`, `FaqEntry`, `BusinessProfile` |
| Create | `apps/api/src/routes/business-profile.ts`                                        | GET + PUT `/api/business-profile`, GET `/api/business-profile/catalog-services`              |
| Modify | `apps/api/src/index.ts`                                                          | Register `/api/business-profile` router                                                      |
| Create | `apps/api/src/voice/business-knowledge.ts`                                       | Pure `buildBusinessKnowledgeBlock(profile)` → formatted string                               |
| Create | `apps/api/src/voice/business-knowledge.test.ts`                                  | Unit tests for `buildBusinessKnowledgeBlock`                                                 |
| Modify | `apps/api/src/voice/gemini-live.ts`                                              | Accept optional `businessProfile` param, inject block                                        |
| Modify | `apps/api/src/voice/telnyx-handler.ts`                                           | `getLocationAfterHoursConfig` → `getLocationConfig`, pass profile                            |
| Create | `apps/web/src/app/(dashboard)/settings/business-profile/page.tsx`                | Server component: fetch profile + pass to form                                               |
| Create | `apps/web/src/app/(dashboard)/settings/business-profile/BusinessProfileForm.tsx` | Client form: 4 sections with per-section saves                                               |
| Modify | `apps/web/src/app/(dashboard)/Sidebar.tsx`                                       | Add Business Profile nav item                                                                |

---

## Task 1: Shared TypeScript Types

**Files:**

- Modify: `packages/shared/src/types/index.ts`

- [ ] **Step 1.1: Add BusinessProfile types to shared index**

Open `packages/shared/src/types/index.ts`. Append after the `PaginatedResponse` interface at the end of the file:

```typescript
// ── Business Profile ─────────────────────────────────────────

export interface DayHours {
  open: string // "09:00"
  close: string // "17:00"
  closed: boolean
}

export interface BusinessHours {
  monday: DayHours
  tuesday: DayHours
  wednesday: DayHours
  thursday: DayHours
  friday: DayHours
  saturday: DayHours
  sunday: DayHours
}

export interface ServiceEntry {
  name: string
  duration_min: number
  price: number
  description: string
}

export interface StaffEntry {
  name: string
  role: string
}

export interface FaqEntry {
  question: string
  answer: string
}

export interface BusinessProfile {
  hours?: Partial<BusinessHours>
  services?: ServiceEntry[]
  staff?: StaffEntry[]
  faqs?: FaqEntry[]
  notes?: string
}
```

- [ ] **Step 1.2: Verify TypeScript compiles**

```bash
cd ~/Documents/Nuatis/nuatis && npx tsc --noEmit -p packages/shared/tsconfig.json 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 1.3: Commit**

```bash
git add packages/shared/src/types/index.ts
git commit -m "feat(types): add BusinessProfile, DayHours, ServiceEntry, StaffEntry, FaqEntry"
```

---

## Task 2: Database Migration

**Files:**

- Create: `supabase/migrations/0082_business_profile.sql`

- [ ] **Step 2.1: Create migration file**

Create `supabase/migrations/0082_business_profile.sql`:

```sql
-- G1: add structured business profile to locations
ALTER TABLE locations ADD COLUMN IF NOT EXISTS business_profile JSONB DEFAULT '{}'::jsonb;
```

- [ ] **Step 2.2: Apply migration**

```bash
cd ~/Documents/Nuatis/nuatis && npx supabase db push
```

Expected output: migration applied, no errors.

- [ ] **Step 2.3: Verify column exists**

```bash
cd ~/Documents/Nuatis/nuatis && npx supabase db diff 2>&1 | grep business_profile || echo "column applied"
```

- [ ] **Step 2.4: Commit**

```bash
git add supabase/migrations/0082_business_profile.sql
git commit -m "feat(db): add business_profile JSONB column to locations (migration 0082)"
```

---

## Task 3: API Route — business-profile.ts

**Files:**

- Create: `apps/api/src/routes/business-profile.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 3.1: Create the route file**

Create `apps/api/src/routes/business-profile.ts`:

```typescript
import { Router, type Request, type Response } from 'express'
import { createClient } from '@supabase/supabase-js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import type { BusinessProfile } from '@nuatis/shared'

const router = Router()

function getSupabase() {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('Supabase env vars not set')
  return createClient(url, key)
}

async function resolveLocationId(tenantId: string): Promise<string | null> {
  const supabase = getSupabase()
  const { data: primary } = await supabase
    .from('locations')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('is_primary', true)
    .maybeSingle<{ id: string }>()

  if (primary?.id) return primary.id

  const { data: fallback } = await supabase
    .from('locations')
    .select('id')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle<{ id: string }>()

  return fallback?.id ?? null
}

// ── GET /api/business-profile ─────────────────────────────────────────────────
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  try {
    const locationId = await resolveLocationId(authed.tenantId)
    if (!locationId) {
      res.json({ business_profile: {} })
      return
    }

    const { data, error } = await supabase
      .from('locations')
      .select('business_profile')
      .eq('id', locationId)
      .single<{ business_profile: BusinessProfile | null }>()

    if (error) {
      console.error(`[business-profile] GET error: ${error.message}`)
      res.status(500).json({ error: 'Failed to fetch business profile' })
      return
    }

    res.json({ business_profile: data?.business_profile ?? {} })
  } catch (err) {
    console.error('[business-profile] GET error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── PUT /api/business-profile ─────────────────────────────────────────────────
router.put('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()
  const body = req.body as { business_profile?: unknown }

  if (!body.business_profile || typeof body.business_profile !== 'object') {
    res.status(400).json({ error: 'business_profile must be an object' })
    return
  }

  const profile = body.business_profile as BusinessProfile

  // Validate services array
  if (profile.services !== undefined) {
    if (!Array.isArray(profile.services)) {
      res.status(400).json({ error: 'services must be an array' })
      return
    }
    for (const s of profile.services) {
      if (typeof s.name !== 'string' || !s.name.trim()) {
        res.status(400).json({ error: 'Each service must have a non-empty name' })
        return
      }
    }
  }

  // Validate staff array
  if (profile.staff !== undefined) {
    if (!Array.isArray(profile.staff)) {
      res.status(400).json({ error: 'staff must be an array' })
      return
    }
  }

  // Validate faqs array (max 10)
  if (profile.faqs !== undefined) {
    if (!Array.isArray(profile.faqs)) {
      res.status(400).json({ error: 'faqs must be an array' })
      return
    }
    if (profile.faqs.length > 10) {
      res.status(400).json({ error: 'Maximum 10 FAQs allowed' })
      return
    }
  }

  // Truncate notes to 2000 chars
  if (typeof profile.notes === 'string') {
    profile.notes = profile.notes.slice(0, 2000)
  }

  try {
    const locationId = await resolveLocationId(authed.tenantId)
    if (!locationId) {
      res.status(404).json({ error: 'No location found for this tenant' })
      return
    }

    const { error } = await supabase
      .from('locations')
      .update({ business_profile: profile })
      .eq('id', locationId)

    if (error) {
      console.error(`[business-profile] PUT error: ${error.message}`)
      res.status(500).json({ error: 'Failed to update business profile' })
      return
    }

    console.info(`[business-profile] updated for tenant=${authed.tenantId}`)
    res.json({ business_profile: profile })
  } catch (err) {
    console.error('[business-profile] PUT error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ── GET /api/business-profile/catalog-services ───────────────────────────────
router.get('/catalog-services', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getSupabase()

  try {
    const { data, error } = await supabase
      .from('services')
      .select('id, name, unit_price, duration_minutes')
      .eq('tenant_id', authed.tenantId)
      .order('name', { ascending: true })

    if (error) {
      console.error(`[business-profile] catalog-services error: ${error.message}`)
      res.status(500).json({ error: 'Failed to fetch catalog services' })
      return
    }

    res.json({ services: data ?? [] })
  } catch (err) {
    console.error('[business-profile] catalog-services error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
```

- [ ] **Step 3.2: Register router in apps/api/src/index.ts**

In `apps/api/src/index.ts`, add the import after the existing imports (around line 68, before the `const app = express()` line):

```typescript
import businessProfileRouter from './routes/business-profile.js'
```

Then add the route registration. Find the block where `mayaSettingsRouter` is registered (around line 115):

```typescript
app.use('/api/maya-settings', mayaSettingsRouter)
```

Add immediately after:

```typescript
app.use('/api/business-profile', businessProfileRouter)
```

- [ ] **Step 3.3: TypeScript check**

```bash
cd ~/Documents/Nuatis/nuatis && npx tsc --noEmit -p apps/api/tsconfig.json 2>&1 | grep -v "^$" | head -30
```

Expected: no errors in business-profile.ts.

- [ ] **Step 3.4: Commit**

```bash
git add apps/api/src/routes/business-profile.ts apps/api/src/index.ts
git commit -m "feat(api): add GET/PUT /api/business-profile and /catalog-services routes"
```

---

## Task 4: Business Knowledge Helper + Tests

**Files:**

- Create: `apps/api/src/voice/business-knowledge.ts`
- Create: `apps/api/src/voice/business-knowledge.test.ts`

- [ ] **Step 4.1: Write the failing tests first**

Create `apps/api/src/voice/business-knowledge.test.ts`:

```typescript
import { describe, it, expect } from '@jest/globals'
import { buildBusinessKnowledgeBlock } from './business-knowledge.js'
import type { BusinessProfile } from '@nuatis/shared'

describe('buildBusinessKnowledgeBlock', () => {
  it('returns empty string for empty profile', () => {
    expect(buildBusinessKnowledgeBlock({})).toBe('')
  })

  it('returns empty string for profile with empty arrays and no notes', () => {
    const profile: BusinessProfile = { services: [], staff: [], faqs: [] }
    expect(buildBusinessKnowledgeBlock(profile)).toBe('')
  })

  it('formats open hours correctly', () => {
    const profile: BusinessProfile = {
      hours: {
        monday: { open: '09:00', close: '17:00', closed: false },
        saturday: { open: '09:00', close: '13:00', closed: true },
      },
    }
    const result = buildBusinessKnowledgeBlock(profile)
    expect(result).toContain('--- BUSINESS KNOWLEDGE ---')
    expect(result).toContain('Monday: 9am–5pm')
    expect(result).toContain('Saturday: Closed')
    expect(result).toContain('--- END BUSINESS KNOWLEDGE ---')
  })

  it('formats 12pm and 12am correctly', () => {
    const profile: BusinessProfile = {
      hours: {
        monday: { open: '12:00', close: '00:00', closed: false },
      },
    }
    const result = buildBusinessKnowledgeBlock(profile)
    expect(result).toContain('Monday: 12pm–12am')
  })

  it('formats services with name, duration and price', () => {
    const profile: BusinessProfile = {
      services: [
        { name: 'Haircut', duration_min: 45, price: 60, description: '' },
        { name: 'Color', duration_min: 120, price: 150, description: 'Full color' },
      ],
    }
    const result = buildBusinessKnowledgeBlock(profile)
    expect(result).toContain('SERVICES:')
    expect(result).toContain('Haircut | 45 min | $60')
    expect(result).toContain('Color | 120 min | $150')
  })

  it('formats staff list', () => {
    const profile: BusinessProfile = {
      staff: [
        { name: 'Jane', role: 'Stylist' },
        { name: 'Bob', role: 'Manager' },
      ],
    }
    const result = buildBusinessKnowledgeBlock(profile)
    expect(result).toContain('STAFF: Jane (Stylist), Bob (Manager)')
  })

  it('formats FAQs', () => {
    const profile: BusinessProfile = {
      faqs: [{ question: 'Do you take walk-ins?', answer: 'Yes, during off-peak hours.' }],
    }
    const result = buildBusinessKnowledgeBlock(profile)
    expect(result).toContain('FAQs:')
    expect(result).toContain('Q: Do you take walk-ins?')
    expect(result).toContain('A: Yes, during off-peak hours.')
  })

  it('includes notes verbatim', () => {
    const profile: BusinessProfile = { notes: 'Parking is free behind the building.' }
    const result = buildBusinessKnowledgeBlock(profile)
    expect(result).toContain('NOTES: Parking is free behind the building.')
  })

  it('skips HOURS section when hours is undefined', () => {
    const profile: BusinessProfile = { notes: 'Open 24/7' }
    const result = buildBusinessKnowledgeBlock(profile)
    expect(result).not.toContain('HOURS:')
    expect(result).toContain('NOTES: Open 24/7')
  })

  it('wraps block in delimiters', () => {
    const profile: BusinessProfile = { notes: 'test' }
    const result = buildBusinessKnowledgeBlock(profile)
    expect(result.startsWith('\n\n--- BUSINESS KNOWLEDGE ---')).toBe(true)
    expect(result.endsWith('--- END BUSINESS KNOWLEDGE ---')).toBe(true)
  })
})
```

- [ ] **Step 4.2: Run tests to confirm they fail**

```bash
cd ~/Documents/Nuatis/nuatis && npx jest apps/api/src/voice/business-knowledge.test.ts --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module './business-knowledge.js'`

- [ ] **Step 4.3: Create the implementation**

Create `apps/api/src/voice/business-knowledge.ts`:

```typescript
import type { BusinessProfile } from '@nuatis/shared'

const DAY_ORDER: Array<keyof Required<BusinessProfile>['hours']> = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]

const DAY_LABEL: Record<string, string> = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
}

function formatTime(time: string): string {
  const [hStr, mStr] = time.split(':')
  const h = parseInt(hStr ?? '0', 10)
  const m = parseInt(mStr ?? '0', 10)
  const period = h < 12 ? 'am' : 'pm'
  const hour12 = h % 12 || 12
  return m === 0 ? `${hour12}${period}` : `${hour12}:${String(m).padStart(2, '0')}${period}`
}

export function buildBusinessKnowledgeBlock(profile: BusinessProfile): string {
  const lines: string[] = []

  // Hours
  if (profile.hours && Object.keys(profile.hours).length > 0) {
    const hourParts: string[] = []
    for (const day of DAY_ORDER) {
      const h = profile.hours[day]
      if (!h) continue
      if (h.closed) {
        hourParts.push(`${DAY_LABEL[day]}: Closed`)
      } else {
        hourParts.push(`${DAY_LABEL[day]}: ${formatTime(h.open)}–${formatTime(h.close)}`)
      }
    }
    if (hourParts.length > 0) {
      lines.push(`HOURS: ${hourParts.join(', ')}`)
    }
  }

  // Services
  if (profile.services && profile.services.length > 0) {
    const serviceParts = profile.services.map((s) => {
      const parts = [s.name]
      if (s.duration_min) parts.push(`${s.duration_min} min`)
      if (s.price != null) parts.push(`$${s.price}`)
      return parts.join(' | ')
    })
    lines.push(`SERVICES: ${serviceParts.join('; ')}`)
  }

  // Staff
  if (profile.staff && profile.staff.length > 0) {
    const staffParts = profile.staff.map((s) => `${s.name} (${s.role})`)
    lines.push(`STAFF: ${staffParts.join(', ')}`)
  }

  // FAQs
  const faqLines: string[] = []
  if (profile.faqs && profile.faqs.length > 0) {
    for (const faq of profile.faqs) {
      if (faq.question && faq.answer) {
        faqLines.push(`Q: ${faq.question}\nA: ${faq.answer}`)
      }
    }
  }

  const hasContent = lines.length > 0 || faqLines.length > 0 || Boolean(profile.notes)
  if (!hasContent) return ''

  let block = '\n\n--- BUSINESS KNOWLEDGE ---\n'
  if (lines.length > 0) block += lines.join('\n') + '\n'
  if (faqLines.length > 0) block += 'FAQs:\n' + faqLines.join('\n') + '\n'
  if (profile.notes) block += `NOTES: ${profile.notes}\n`
  block += '--- END BUSINESS KNOWLEDGE ---'

  return block
}
```

- [ ] **Step 4.4: Run tests to confirm they pass**

```bash
cd ~/Documents/Nuatis/nuatis && npx jest apps/api/src/voice/business-knowledge.test.ts --no-coverage 2>&1 | tail -20
```

Expected: all 10 tests PASS.

- [ ] **Step 4.5: Commit**

```bash
git add apps/api/src/voice/business-knowledge.ts apps/api/src/voice/business-knowledge.test.ts
git commit -m "feat(voice): add buildBusinessKnowledgeBlock helper with tests"
```

---

## Task 5: Inject Business Profile into Gemini System Prompt

**Files:**

- Modify: `apps/api/src/voice/gemini-live.ts`

- [ ] **Step 5.1: Add import for buildBusinessKnowledgeBlock and BusinessProfile type**

In `apps/api/src/voice/gemini-live.ts`, add to the existing imports at the top:

```typescript
import { buildBusinessKnowledgeBlock } from './business-knowledge.js'
import type { BusinessProfile } from '@nuatis/shared'
```

- [ ] **Step 5.2: Add businessProfile parameter to createGeminiLiveSession**

The current signature (around line 119) is:

```typescript
export async function createGeminiLiveSession(
  tenantId: string,
  vertical: string,
  businessName?: string,
  callControlId?: string,
  product?: 'maya_only' | 'suite',
  promptSuffix?: string,
  callerContactId?: string | null,
  afterHoursPrefix?: string
): Promise<GeminiLiveSession> {
```

Change to:

```typescript
export async function createGeminiLiveSession(
  tenantId: string,
  vertical: string,
  businessName?: string,
  callControlId?: string,
  product?: 'maya_only' | 'suite',
  promptSuffix?: string,
  callerContactId?: string | null,
  afterHoursPrefix?: string,
  businessProfile?: BusinessProfile | null
): Promise<GeminiLiveSession> {
```

- [ ] **Step 5.3: Inject business knowledge block after knowledge base section**

Find this block (around line 173–175):

```typescript
    console.info(
      `[gemini-live] knowledge injection skipped: ${msg}`
    )
  }

  systemPrompt += BOOKING_CONTRACT
```

Insert between the closing `}` of the knowledge base try/catch and `systemPrompt += BOOKING_CONTRACT`:

```typescript
// ── Inject business profile structured data ──────────────────────────────
if (businessProfile) {
  const block = buildBusinessKnowledgeBlock(businessProfile)
  if (block) {
    systemPrompt += block
    console.info(`[gemini-live] injected business knowledge block for tenant=${tenantId}`)
  }
}

systemPrompt += BOOKING_CONTRACT
```

(Remove the existing bare `systemPrompt += BOOKING_CONTRACT` line that you just replaced.)

- [ ] **Step 5.4: TypeScript check**

```bash
cd ~/Documents/Nuatis/nuatis && npx tsc --noEmit -p apps/api/tsconfig.json 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors.

- [ ] **Step 5.5: Commit**

```bash
git add apps/api/src/voice/gemini-live.ts
git commit -m "feat(voice): inject business profile knowledge block into Gemini system prompt"
```

---

## Task 6: telnyx-handler.ts — Fetch and Forward Business Profile

**Files:**

- Modify: `apps/api/src/voice/telnyx-handler.ts`

- [ ] **Step 6.1: Add BusinessProfile import**

At the top of `apps/api/src/voice/telnyx-handler.ts`, add to the existing imports:

```typescript
import type { BusinessProfile } from '@nuatis/shared'
```

- [ ] **Step 6.2: Add LocationConfig interface**

Find the existing `LocationAfterHoursConfig` interface (around line 105–113). After it, add:

```typescript
interface LocationConfig {
  afterHoursConfig: LocationAfterHoursConfig | null
  businessProfile: BusinessProfile | null
}
```

- [ ] **Step 6.3: Replace getLocationAfterHoursConfig with getLocationConfig**

Find the function `async function getLocationAfterHoursConfig(` (around line 140). Replace the entire function body (lines 140–190) with:

```typescript
async function getLocationConfig(tenantId: string): Promise<LocationConfig> {
  const FALLBACK: LocationConfig = { afterHoursConfig: null, businessProfile: null }
  const FALLBACK_MESSAGE =
    'We are currently closed. Please leave your name and number and we will call you back during business hours.'
  try {
    const url = process.env['SUPABASE_URL']
    const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
    if (!url || !key) return FALLBACK

    const supabase = createClient(url, key)
    let timedOut = false
    const timeout = new Promise<LocationConfig>((resolve) =>
      setTimeout(() => {
        timedOut = true
        resolve(FALLBACK)
      }, 400)
    )

    const query = (async (): Promise<LocationConfig> => {
      try {
        const { data, error } = await supabase
          .from('locations')
          .select(
            'after_hours_enabled, business_hours, after_hours_message, timezone, business_profile'
          )
          .eq('tenant_id', tenantId)
          .eq('is_primary', true)
          .single()
        if (timedOut || error || !data) return FALLBACK
        const d = data as {
          after_hours_enabled?: boolean
          business_hours?: Record<string, AfterHoursDayConfig>
          after_hours_message?: string
          timezone?: string
          business_profile?: BusinessProfile | null
        }
        const afterHoursConfig: LocationAfterHoursConfig | null = d.after_hours_enabled
          ? {
              afterHoursEnabled: true,
              businessHours: d.business_hours ?? {},
              afterHoursMessage: d.after_hours_message ?? FALLBACK_MESSAGE,
              timezone: d.timezone ?? 'America/Chicago',
            }
          : null
        const businessProfile =
          d.business_profile && Object.keys(d.business_profile).length > 0
            ? d.business_profile
            : null
        return { afterHoursConfig, businessProfile }
      } catch {
        return FALLBACK
      }
    })()

    return Promise.race([query, timeout])
  } catch {
    return FALLBACK
  }
}
```

- [ ] **Step 6.4: Update prewarmGemini to use getLocationConfig**

Find the call site in `prewarmGemini` (around line 325–348):

```typescript
const [callerContext, locationConfig] = await Promise.all([
  lookupPromise,
  getLocationAfterHoursConfig(tenantId),
])
const contextSuffix = buildSystemPromptSuffix(callerContext, fromNumber)

let afterHoursPrefix: string | undefined
if (locationConfig && isAfterHoursNow(locationConfig.businessHours, locationConfig.timezone)) {
  afterHoursPrefix = buildAfterHoursSystemPrefix(locationConfig.afterHoursMessage)
  console.info(
    `[telnyx-handler] after-hours mode active for tenant=${tenantId} — overriding system prompt`
  )
}

const session = await createGeminiLiveSession(
  tenantId,
  safeVertical,
  safeName,
  callControlId,
  product,
  contextSuffix,
  callerContext.contactId ?? null,
  afterHoursPrefix
)
```

Replace with:

```typescript
const [callerContext, locationConfig] = await Promise.all([
  lookupPromise,
  getLocationConfig(tenantId),
])
const contextSuffix = buildSystemPromptSuffix(callerContext, fromNumber)
const { afterHoursConfig, businessProfile } = locationConfig

let afterHoursPrefix: string | undefined
if (
  afterHoursConfig &&
  isAfterHoursNow(afterHoursConfig.businessHours, afterHoursConfig.timezone)
) {
  afterHoursPrefix = buildAfterHoursSystemPrefix(afterHoursConfig.afterHoursMessage)
  console.info(
    `[telnyx-handler] after-hours mode active for tenant=${tenantId} — overriding system prompt`
  )
}

const session = await createGeminiLiveSession(
  tenantId,
  safeVertical,
  safeName,
  callControlId,
  product,
  contextSuffix,
  callerContext.contactId ?? null,
  afterHoursPrefix,
  businessProfile
)
```

- [ ] **Step 6.5: TypeScript check**

```bash
cd ~/Documents/Nuatis/nuatis && npx tsc --noEmit -p apps/api/tsconfig.json 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors.

- [ ] **Step 6.6: Commit**

```bash
git add apps/api/src/voice/telnyx-handler.ts
git commit -m "feat(voice): fetch and forward business_profile from locations into Gemini session"
```

---

## Task 7: Settings Page — Server Component

**Files:**

- Create: `apps/web/src/app/(dashboard)/settings/business-profile/page.tsx`

- [ ] **Step 7.1: Create the server component page**

Create `apps/web/src/app/(dashboard)/settings/business-profile/page.tsx`:

```typescript
import { auth } from '@/lib/auth/authjs'
import { createAdminClient } from '@/lib/supabase/server'
import BusinessProfileForm from './BusinessProfileForm'
import type { BusinessProfile } from '@nuatis/shared'

export default async function BusinessProfilePage() {
  const session = await auth()
  const tenantId = session?.user?.tenantId

  const supabase = createAdminClient()

  let profile: BusinessProfile = {}

  if (tenantId) {
    // Try is_primary first, fallback to first location
    const { data: primary } = await supabase
      .from('locations')
      .select('business_profile')
      .eq('tenant_id', tenantId)
      .eq('is_primary', true)
      .maybeSingle<{ business_profile: BusinessProfile | null }>()

    if (primary) {
      profile = primary.business_profile ?? {}
    } else {
      const { data: fallback } = await supabase
        .from('locations')
        .select('business_profile')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle<{ business_profile: BusinessProfile | null }>()
      profile = fallback?.business_profile ?? {}
    }
  }

  return (
    <div className="px-8 py-8">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-ink">Business Profile</h1>
        <p className="text-sm text-ink3 mt-0.5">
          Maya uses this information to answer caller questions about your business
        </p>
      </div>
      <BusinessProfileForm initialProfile={profile} />
    </div>
  )
}
```

- [ ] **Step 7.2: TypeScript check**

```bash
cd ~/Documents/Nuatis/nuatis && npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | grep -E "error|Error" | grep "business-profile" | head -20
```

Expected: no errors related to business-profile/page.tsx.

---

## Task 8: Settings Page — Client Form Component

**Files:**

- Create: `apps/web/src/app/(dashboard)/settings/business-profile/BusinessProfileForm.tsx`

- [ ] **Step 8.1: Create BusinessProfileForm.tsx**

Create `apps/web/src/app/(dashboard)/settings/business-profile/BusinessProfileForm.tsx`:

```typescript
'use client'

import { useState } from 'react'
import type {
  BusinessProfile,
  DayHours,
  ServiceEntry,
  StaffEntry,
  FaqEntry,
} from '@nuatis/shared'

const DAYS: Array<{ key: keyof Required<BusinessProfile>['hours']; label: string }> = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' },
]

const DEFAULT_DAY_HOURS: DayHours = { open: '09:00', close: '17:00', closed: false }
const DEFAULT_HOURS: Required<BusinessProfile>['hours'] = {
  monday: { open: '09:00', close: '17:00', closed: false },
  tuesday: { open: '09:00', close: '17:00', closed: false },
  wednesday: { open: '09:00', close: '17:00', closed: false },
  thursday: { open: '09:00', close: '17:00', closed: false },
  friday: { open: '09:00', close: '17:00', closed: false },
  saturday: { open: '09:00', close: '17:00', closed: true },
  sunday: { open: '09:00', close: '17:00', closed: true },
}

const TIME_SLOTS: string[] = []
for (let h = 0; h <= 23; h++) {
  TIME_SLOTS.push(`${String(h).padStart(2, '0')}:00`)
  TIME_SLOTS.push(`${String(h).padStart(2, '0')}:30`)
}

function formatTimeLabel(t: string): string {
  const [hStr, mStr] = t.split(':')
  const h = parseInt(hStr ?? '0', 10)
  const m = mStr ?? '00'
  const period = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 || 12
  return `${h12}:${m} ${period}`
}

type Section = 'hours' | 'services' | 'staff' | 'faqs'

interface SectionState {
  saving: boolean
  message: { type: 'success' | 'error'; text: string } | null
}

interface CatalogService {
  id: string
  name: string
  unit_price: number
  duration_minutes: number | null
}

export default function BusinessProfileForm({
  initialProfile,
}: {
  initialProfile: BusinessProfile
}) {
  const [hours, setHours] = useState<Required<BusinessProfile>['hours']>(
    initialProfile.hours && Object.keys(initialProfile.hours).length > 0
      ? { ...DEFAULT_HOURS, ...initialProfile.hours }
      : DEFAULT_HOURS
  )
  const [services, setServices] = useState<ServiceEntry[]>(initialProfile.services ?? [])
  const [staff, setStaff] = useState<StaffEntry[]>(initialProfile.staff ?? [])
  const [faqs, setFaqs] = useState<FaqEntry[]>(initialProfile.faqs ?? [])
  const [notes, setNotes] = useState(initialProfile.notes ?? '')

  const [sectionState, setSectionState] = useState<Record<Section, SectionState>>({
    hours: { saving: false, message: null },
    services: { saving: false, message: null },
    staff: { saving: false, message: null },
    faqs: { saving: false, message: null },
  })

  const [catalogServices, setCatalogServices] = useState<CatalogService[] | null>(null)
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [showCatalogPicker, setShowCatalogPicker] = useState(false)
  const [selectedCatalogIds, setSelectedCatalogIds] = useState<Set<string>>(new Set())

  function setSectionMsg(section: Section, msg: SectionState['message']) {
    setSectionState((prev) => ({ ...prev, [section]: { ...prev[section]!, message: msg } }))
  }

  function setSectionSaving(section: Section, saving: boolean) {
    setSectionState((prev) => ({ ...prev, [section]: { ...prev[section]!, saving } }))
  }

  async function saveSection(section: Section, patch: Partial<BusinessProfile>) {
    setSectionSaving(section, true)
    setSectionMsg(section, null)
    try {
      const current: BusinessProfile = {
        hours,
        services,
        staff,
        faqs,
        notes,
      }
      const merged: BusinessProfile = { ...current, ...patch }
      const res = await fetch('/api/business-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_profile: merged }),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        setSectionMsg(section, { type: 'error', text: data.error ?? 'Failed to save' })
        return
      }
      setSectionMsg(section, { type: 'success', text: 'Saved' })
    } catch {
      setSectionMsg(section, { type: 'error', text: 'Network error' })
    } finally {
      setSectionSaving(section, false)
    }
  }

  function updateDayHours(day: keyof Required<BusinessProfile>['hours'], field: keyof DayHours, value: string | boolean) {
    setHours((prev) => ({
      ...prev,
      [day]: { ...(prev[day] ?? DEFAULT_DAY_HOURS), [field]: value },
    }))
  }

  async function loadCatalog() {
    if (catalogServices !== null) {
      setShowCatalogPicker(true)
      return
    }
    setLoadingCatalog(true)
    try {
      const res = await fetch('/api/business-profile/catalog-services')
      if (res.ok) {
        const data = (await res.json()) as { services: CatalogService[] }
        setCatalogServices(data.services)
        setShowCatalogPicker(true)
      }
    } finally {
      setLoadingCatalog(false)
    }
  }

  function importSelected() {
    if (!catalogServices) return
    const toImport = catalogServices
      .filter((s) => selectedCatalogIds.has(s.id))
      .map(
        (s): ServiceEntry => ({
          name: s.name,
          duration_min: s.duration_minutes ?? 0,
          price: s.unit_price,
          description: '',
        })
      )
    setServices((prev) => [...prev, ...toImport])
    setShowCatalogPicker(false)
    setSelectedCatalogIds(new Set())
  }

  const inputCls =
    'w-full px-3 py-2 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent'
  const smallInputCls =
    'px-3 py-1.5 text-sm border border-border-brand rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent'
  const saveBtnCls =
    'px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
  const addBtnCls =
    'px-3 py-1.5 text-sm border border-border-brand rounded-lg hover:bg-bg transition-colors text-ink2'
  const removeBtnCls = 'text-red-400 hover:text-red-600 text-sm px-2'

  function SectionMessage({ section }: { section: Section }) {
    const msg = sectionState[section].message
    if (!msg) return null
    return (
      <div
        className={`px-3 py-2 rounded-lg text-sm ${msg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}
      >
        {msg.text}
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-6">
      {/* ── 1. Business Hours ── */}
      <div className="bg-white rounded-xl border border-border-brand p-6">
        <h2 className="text-sm font-semibold text-ink mb-1">Business Hours</h2>
        <p className="text-xs text-ink4 mb-4">
          Maya uses these hours to tell callers when you are open
        </p>

        <div className="space-y-2">
          {DAYS.map(({ key, label }) => {
            const day = hours[key] ?? DEFAULT_DAY_HOURS
            return (
              <div key={key} className="flex items-center gap-3">
                <span className="w-24 text-sm text-ink2 shrink-0">{label}</span>
                <button
                  type="button"
                  onClick={() => updateDayHours(key, 'closed', !day.closed)}
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-1 ${
                    day.closed ? 'bg-bg3' : 'bg-teal-600'
                  }`}
                  title={day.closed ? 'Closed — click to open' : 'Open — click to close'}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                      day.closed ? 'translate-x-1' : 'translate-x-4'
                    }`}
                  />
                </button>
                {day.closed ? (
                  <span className="text-sm text-ink4">Closed</span>
                ) : (
                  <>
                    <select
                      value={day.open}
                      onChange={(e) => updateDayHours(key, 'open', e.target.value)}
                      className={smallInputCls + ' bg-white'}
                    >
                      {TIME_SLOTS.map((t) => (
                        <option key={t} value={t}>{formatTimeLabel(t)}</option>
                      ))}
                    </select>
                    <span className="text-ink4 text-xs">to</span>
                    <select
                      value={day.close}
                      onChange={(e) => updateDayHours(key, 'close', e.target.value)}
                      className={smallInputCls + ' bg-white'}
                    >
                      {TIME_SLOTS.map((t) => (
                        <option key={t} value={t}>{formatTimeLabel(t)}</option>
                      ))}
                    </select>
                  </>
                )}
              </div>
            )
          })}
        </div>

        <div className="flex items-center gap-3 mt-5">
          <button
            onClick={() => saveSection('hours', { hours })}
            disabled={sectionState.hours.saving}
            className={saveBtnCls}
          >
            {sectionState.hours.saving ? 'Saving…' : 'Save Hours'}
          </button>
          <SectionMessage section="hours" />
        </div>
      </div>

      {/* ── 2. Services ── */}
      <div className="bg-white rounded-xl border border-border-brand p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-ink">Services</h2>
          <button
            onClick={loadCatalog}
            disabled={loadingCatalog}
            className={addBtnCls}
          >
            {loadingCatalog ? 'Loading…' : 'Import from Catalog'}
          </button>
        </div>
        <p className="text-xs text-ink4 mb-4">
          List your services so Maya can quote prices and durations
        </p>

        {/* Catalog picker modal */}
        {showCatalogPicker && catalogServices && (
          <div className="mb-4 p-4 bg-bg rounded-xl border border-border-brand">
            <p className="text-sm font-medium text-ink mb-3">Select services to import</p>
            {catalogServices.length === 0 ? (
              <p className="text-sm text-ink4">No catalog services found.</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {catalogServices.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="text-teal-600 focus:ring-teal-500"
                      checked={selectedCatalogIds.has(s.id)}
                      onChange={(e) => {
                        setSelectedCatalogIds((prev) => {
                          const next = new Set(prev)
                          if (e.target.checked) next.add(s.id)
                          else next.delete(s.id)
                          return next
                        })
                      }}
                    />
                    <span className="text-sm text-ink">{s.name}</span>
                    <span className="text-xs text-ink4">
                      {s.duration_minutes ? `${s.duration_minutes} min` : ''}{' '}
                      {s.unit_price ? `$${s.unit_price}` : ''}
                    </span>
                  </label>
                ))}
              </div>
            )}
            <div className="flex gap-2 mt-3">
              <button
                onClick={importSelected}
                disabled={selectedCatalogIds.size === 0}
                className={saveBtnCls}
              >
                Import Selected
              </button>
              <button
                onClick={() => setShowCatalogPicker(false)}
                className={addBtnCls}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {services.length > 0 && (
            <div className="grid grid-cols-[1fr_80px_80px_1fr_auto] gap-2 text-xs font-medium text-ink4 pb-1 border-b border-border-brand">
              <span>Name</span>
              <span>Duration (min)</span>
              <span>Price ($)</span>
              <span>Description</span>
              <span />
            </div>
          )}
          {services.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_80px_80px_1fr_auto] gap-2 items-center">
              <input
                value={s.name}
                onChange={(e) =>
                  setServices((prev) => prev.map((row, j) => (j === i ? { ...row, name: e.target.value } : row)))
                }
                placeholder="Service name"
                className={smallInputCls}
              />
              <input
                type="number"
                value={s.duration_min || ''}
                onChange={(e) =>
                  setServices((prev) =>
                    prev.map((row, j) => (j === i ? { ...row, duration_min: parseInt(e.target.value) || 0 } : row))
                  )
                }
                placeholder="60"
                className={smallInputCls}
              />
              <input
                type="number"
                value={s.price || ''}
                onChange={(e) =>
                  setServices((prev) =>
                    prev.map((row, j) => (j === i ? { ...row, price: parseFloat(e.target.value) || 0 } : row))
                  )
                }
                placeholder="0"
                className={smallInputCls}
              />
              <input
                value={s.description}
                onChange={(e) =>
                  setServices((prev) =>
                    prev.map((row, j) => (j === i ? { ...row, description: e.target.value } : row))
                  )
                }
                placeholder="Optional description"
                className={smallInputCls}
              />
              <button
                onClick={() => setServices((prev) => prev.filter((_, j) => j !== i))}
                className={removeBtnCls}
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={() =>
              setServices((prev) => [...prev, { name: '', duration_min: 0, price: 0, description: '' }])
            }
            className={addBtnCls}
          >
            + Add Service
          </button>
        </div>

        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-border-brand">
          <button
            onClick={() => saveSection('services', { services })}
            disabled={sectionState.services.saving}
            className={saveBtnCls}
          >
            {sectionState.services.saving ? 'Saving…' : 'Save Services'}
          </button>
          <SectionMessage section="services" />
        </div>
      </div>

      {/* ── 3. Staff ── */}
      <div className="bg-white rounded-xl border border-border-brand p-6">
        <h2 className="text-sm font-semibold text-ink mb-1">Staff</h2>
        <p className="text-xs text-ink4 mb-4">
          Let Maya introduce your team and direct callers to the right person
        </p>

        <div className="space-y-3">
          {staff.length > 0 && (
            <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs font-medium text-ink4 pb-1 border-b border-border-brand">
              <span>Name</span>
              <span>Role</span>
              <span />
            </div>
          )}
          {staff.map((s, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
              <input
                value={s.name}
                onChange={(e) =>
                  setStaff((prev) => prev.map((row, j) => (j === i ? { ...row, name: e.target.value } : row)))
                }
                placeholder="Full name"
                className={smallInputCls}
              />
              <input
                value={s.role}
                onChange={(e) =>
                  setStaff((prev) => prev.map((row, j) => (j === i ? { ...row, role: e.target.value } : row)))
                }
                placeholder="Role (e.g. Stylist)"
                className={smallInputCls}
              />
              <button
                onClick={() => setStaff((prev) => prev.filter((_, j) => j !== i))}
                className={removeBtnCls}
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={() => setStaff((prev) => [...prev, { name: '', role: '' }])}
            className={addBtnCls}
          >
            + Add Staff Member
          </button>
        </div>

        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-border-brand">
          <button
            onClick={() => saveSection('staff', { staff })}
            disabled={sectionState.staff.saving}
            className={saveBtnCls}
          >
            {sectionState.staff.saving ? 'Saving…' : 'Save Staff'}
          </button>
          <SectionMessage section="staff" />
        </div>
      </div>

      {/* ── 4. FAQs & Notes ── */}
      <div className="bg-white rounded-xl border border-border-brand p-6">
        <h2 className="text-sm font-semibold text-ink mb-1">FAQs &amp; Notes</h2>
        <p className="text-xs text-ink4 mb-4">
          Common questions Maya can answer. Notes are cited verbatim.
        </p>

        <div className="space-y-4">
          {faqs.map((faq, i) => (
            <div key={i} className="space-y-1.5 p-3 bg-bg rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-ink4">FAQ {i + 1}</span>
                <button
                  onClick={() => setFaqs((prev) => prev.filter((_, j) => j !== i))}
                  className={removeBtnCls}
                  title="Remove"
                >
                  ✕
                </button>
              </div>
              <input
                value={faq.question}
                onChange={(e) =>
                  setFaqs((prev) =>
                    prev.map((row, j) => (j === i ? { ...row, question: e.target.value } : row))
                  )
                }
                placeholder="Question"
                className={inputCls}
              />
              <textarea
                value={faq.answer}
                onChange={(e) =>
                  setFaqs((prev) =>
                    prev.map((row, j) => (j === i ? { ...row, answer: e.target.value } : row))
                  )
                }
                placeholder="Answer"
                rows={2}
                className={inputCls + ' resize-none'}
              />
            </div>
          ))}
          {faqs.length < 10 && (
            <button
              onClick={() => setFaqs((prev) => [...prev, { question: '', answer: '' }])}
              className={addBtnCls}
            >
              + Add FAQ
            </button>
          )}
        </div>

        <div className="mt-4">
          <label className="block text-xs font-medium text-ink2 mb-1.5">
            Additional Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any extra context Maya should know — parking info, special instructions, etc."
            rows={4}
            maxLength={2000}
            className={inputCls + ' resize-none'}
          />
          <p className="text-[11px] text-ink4 mt-1">{notes.length}/2000 characters</p>
        </div>

        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-border-brand">
          <button
            onClick={() => saveSection('faqs', { faqs, notes })}
            disabled={sectionState.faqs.saving}
            className={saveBtnCls}
          >
            {sectionState.faqs.saving ? 'Saving…' : 'Save FAQs &amp; Notes'}
          </button>
          <SectionMessage section="faqs" />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 8.2: TypeScript check on web app**

```bash
cd ~/Documents/Nuatis/nuatis && npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | grep -E "error|Error" | grep -v "node_modules" | head -30
```

Expected: no errors in business-profile files.

- [ ] **Step 8.3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/settings/business-profile/
git commit -m "feat(web): add Business Profile settings page with 4-section form"
```

---

## Task 9: Sidebar Nav Entry

**Files:**

- Modify: `apps/web/src/app/(dashboard)/Sidebar.tsx`

- [ ] **Step 9.1: Add Business Profile as first item under Settings**

In `apps/web/src/app/(dashboard)/Sidebar.tsx`, find the settings group (around line 143–174):

```typescript
  {
    id: 'settings',
    label: 'Settings',
    items: [
      // Setup first — only visible during onboarding
      { href: '/onboarding', label: 'Setup', icon: '◆', onboardingOnly: true },
      { href: '/settings/voice', label: 'Voice AI', icon: '◇', requireModule: 'maya' },
```

Add `Business Profile` as the first non-onboarding item (after onboarding, before Voice AI):

```typescript
  {
    id: 'settings',
    label: 'Settings',
    items: [
      // Setup first — only visible during onboarding
      { href: '/onboarding', label: 'Setup', icon: '◆', onboardingOnly: true },
      { href: '/settings/business-profile', label: 'Business Profile', icon: '▦', requireModule: 'maya' },
      { href: '/settings/voice', label: 'Voice AI', icon: '◇', requireModule: 'maya' },
```

- [ ] **Step 9.2: Verify the page renders**

```bash
cd ~/Documents/Nuatis/nuatis/apps/web && npx next build 2>&1 | grep -E "error|Error|warning" | grep -v "node_modules" | head -30
```

Expected: build succeeds, no errors on business-profile route.

- [ ] **Step 9.3: Commit**

```bash
git add apps/web/src/app/\(dashboard\)/Sidebar.tsx
git commit -m "feat(nav): add Business Profile as first settings nav item (requireModule: maya)"
```

---

## Task 10: Full TypeScript Check + Test Suite

**Files:** None new — verification pass

- [ ] **Step 10.1: Run full TypeScript check**

```bash
cd ~/Documents/Nuatis/nuatis && npx tsc --noEmit 2>&1 | grep -E "^.*error TS" | grep -v "node_modules" | head -30
```

Expected: 0 errors.

- [ ] **Step 10.2: Run full test suite**

```bash
cd ~/Documents/Nuatis/nuatis && npm test 2>&1 | tail -30
```

Expected: all tests pass, including new `business-knowledge.test.ts`.

- [ ] **Step 10.3: Final commit if any cleanup needed**

```bash
git add -A
git status
# Only commit if there are changes not yet committed
```

---

## Self-Review Checklist

- [x] **Migration**: `0082_business_profile.sql` adds column — Task 2
- [x] **Types**: All 6 types in `packages/shared/src/types/index.ts` — Task 1
- [x] **GET /api/business-profile**: is_primary + fallback — Task 3
- [x] **PUT /api/business-profile**: validation, locate by id, upsert — Task 3
- [x] **GET /api/business-profile/catalog-services**: queries services table — Task 3
- [x] **Wire route in index.ts**: Task 3 step 3.2
- [x] **buildBusinessKnowledgeBlock**: pure fn, tested — Task 4
- [x] **Skip empty sections**: returns '' on empty profile — Task 4 (test case 1)
- [x] **gemini-live.ts injection**: after knowledge base, before BOOKING_CONTRACT — Task 5
- [x] **telnyx-handler.ts**: getLocationConfig replaces getLocationAfterHoursConfig — Task 6
- [x] **Settings page server component**: fallback query — Task 7
- [x] **BusinessProfileForm**: 4 sections, per-section save, Import from Catalog — Task 8
- [x] **Default hours**: Mon–Fri 9am–5pm, Sat–Sun closed — Task 8 (DEFAULT_HOURS)
- [x] **Sidebar entry**: requireModule: 'maya', first in settings — Task 9
- [x] **No `any` types**: BusinessProfile typed throughout
