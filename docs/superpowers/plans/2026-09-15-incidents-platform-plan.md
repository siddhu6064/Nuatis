# Platform Incidents (Sub-project B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Incident tracking for Nuatis's own operations — declare, acknowledge, mitigate, resolve and postmortem an outage, with an on-call rota deciding who owns it and an opt-in notice to the merchants it affected.

**Architecture:** A separate table set with **no `tenant_id`**, served under the existing `/api/admin-console/*` prefix and guarded by the existing platform-owner check. One narrow tenant-facing endpoint exposes only a deliberately-authored customer message — never the internal record.

**Tech Stack:** Express + TypeScript (ESM, `.js` import specifiers), Supabase service-role client, Jest + supertest, BullMQ workers, Next 16 App Router + MUI for the admin console.

---

## Global Constraints

Copied from the spec. Every task's requirements implicitly include these.

- **`platform_incidents` has no `tenant_id`.** The absence is load-bearing and must be commented in the migration so nobody "fixes" it later. (spec §9 P1)
- **`requirePlatformOwner`, never a new auth mode.** Reuse the existing guard; no superuser concept, no second credential. (spec §9 P2)
- **Internal notifications must never reach tenant owners.** `notifyOwner` mails the merchant; platform incidents use `notifyPlatformTeam`. (spec §9 P3)
- **The postmortem gate lives in the transition map**, not in the UI. (spec §9 P4)
- **SEV1 is defined by money**, not by component: merchants cannot take money. (spec §4)
- Money is never involved here, but timestamps are: store `timestamptz`, compare in UTC.
- `getServiceClient()` bypasses RLS. Application-level filtering is the real boundary; RLS policies are defence in depth.
- Never `git add -A`. Stage by path.

---

## Gate 0 — before any code

- [ ] **Branch off `main`**, not off a merged feature branch.

```bash
git checkout main && git pull && git checkout -b feat/incidents-platform
```

- [ ] **Confirm the next migration number against the live database.** `max(name)` does _not_ work — the table holds non-numeric names and `weekly_digest` sorts above `0198`. Order by the numeric prefix:

```sql
select name from supabase_migrations.schema_migrations
 where name ~ '^[0-9]{4}' order by substring(name from '^[0-9]{4}')::int desc limit 5;
```

Confirmed 2026-09-15: latest is `0203_incident_automation_triggers`, so **this plan uses 0204**. If that query returns something higher, renumber every migration below before starting.

---

## Three gaps the spec did not anticipate

Found by reading the codebase before writing this plan. Each would have become a task that silently did nothing.

**G1 — `requirePlatformOwner` is not exported.** The spec says "reuse the existing guard". It is a _private_ function at `apps/api/src/routes/admin-console.ts:28`. Task 2 extracts it to a lib. This is exactly the shape of sub-project A's `ownsRow` problem, which shipped a plan step claiming a private function was importable.

**G2 — `notifyPlatformTeam` has no email transport.** The spec says it "sends to a configured internal address list". There is no generic `sendEmail(to, subject, body)` in this codebase. `lib/email-send.ts` is per-tenant Gmail/Outlook OAuth for _merchant_ mailboxes and is wrong for internal alerts. `notifyOwner` itself sends **web push**, not email. Task 11 therefore builds `notifyPlatformTeam` on two transports that exist today — web push to the platform tenant, and an optional outbound webhook (Slack-shaped) — and explicitly defers email until a transactional provider is added. Writing an email-shaped function with no transport would produce a notifier that silently drops every alert, which is the same failure as sub-project A's commented-out SMS branch.

**G3 — the admin console is a single 764-line `page.tsx`.** There is no `components/admin-console/` directory. Tasks 14–15 create one rather than growing that file past a thousand lines, following the `components/incidents/` split from sub-project A.

---

## File structure

| File                                               | Responsibility                                                                                  |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `supabase/migrations/0204_platform_incidents.sql`  | All four tables, indexes, RLS                                                                   |
| `apps/api/src/lib/platform-auth.ts`                | `requirePlatformOwner` extracted and exported                                                   |
| `apps/api/src/lib/platform-incidents.ts`           | Severities, statuses, ack targets, transition map with the postmortem gate, reference generator |
| `apps/api/src/lib/oncall.ts`                       | `whoIsOnCallAt(when)` rota resolver                                                             |
| `apps/api/src/lib/notify-platform-team.ts`         | `notifyPlatformTeam` — push + webhook, never `notifyOwner`                                      |
| `apps/api/src/routes/admin-console-incidents.ts`   | Declare, list, detail, transitions, assignment, postmortem                                      |
| `apps/api/src/routes/admin-console-oncall.ts`      | Rota CRUD                                                                                       |
| `apps/api/src/routes/platform-notices.ts`          | The **only** tenant-facing endpoint; reads only the customer-message columns                    |
| `apps/api/src/workers/platform-ack-scanner.ts`     | Ack-deadline escalation                                                                         |
| `apps/api/src/lib/platform-detection.ts`           | Sentry hook, ships disabled                                                                     |
| `apps/web/src/components/admin-console/*`          | List, detail, postmortem editor, rota editor                                                    |
| `apps/web/src/components/PlatformNoticeBanner.tsx` | Affected-tenant in-app notice                                                                   |

---

## Task 1: Migration 0204 — the schema

**Files:**

- Create: `supabase/migrations/0204_platform_incidents.sql`
- Modify: `supabase/migrations/README.md`

**Interfaces:**

- Produces: tables `platform_incidents`, `platform_incident_tenants`, `platform_incident_events`, `platform_oncall_shifts`.

- [ ] **Step 1: Write the migration**

```sql
-- Platform / internal-ops incidents. Audience is the Nuatis team, not merchants.
--
-- THERE IS NO tenant_id ON platform_incidents, AND THAT IS DELIBERATE.
-- An incident here is about Nuatis itself — the API is down, a migration locked
-- a table. Adding a tenant_id would make this look like a tenant-scoped table
-- and invite a tenant-scoped read, which is the exact confusion the two-table
-- split exists to prevent. Affected merchants are recorded in
-- platform_incident_tenants instead. Do not "fix" this.
CREATE TABLE IF NOT EXISTS platform_incidents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference         text NOT NULL,
  severity          text NOT NULL CHECK (severity IN ('sev1','sev2','sev3','sev4')),
  status            text NOT NULL DEFAULT 'detected'
                      CHECK (status IN ('detected','acknowledged','mitigating',
                                        'resolved','postmortem_due','closed')),
  title             text NOT NULL,
  summary           text,
  component         text CHECK (component IN ('api','pos-socket','database','worker','web')),
  assigned_to_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  detected_at       timestamptz NOT NULL DEFAULT now(),
  acknowledged_at   timestamptz,
  acknowledged_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  mitigated_at      timestamptz,
  resolved_at       timestamptz,
  postmortem        text,
  postmortem_due_at timestamptz,
  -- Stamped at declaration from severity (Task 3's ackDueAt). Null for SEV4,
  -- which has no deadline — the ack scanner's `.lt()` never matches null, so
  -- that exclusion needs no special case.
  ack_due_at        timestamptz,
  -- Set the first time the scanner notices a missed deadline, so it escalates
  -- once rather than every five minutes.
  ack_breached_at   timestamptz,
  -- The ONLY two columns any merchant can ever see. Null by default: nothing
  -- reaches a tenant until someone deliberately writes this text and publishes
  -- it. title/summary/component and the event timeline are internal and are
  -- never read by the tenant-facing endpoint.
  customer_message  text,
  customer_message_published_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_incidents_reference
  ON platform_incidents(reference);
CREATE INDEX IF NOT EXISTS idx_platform_incidents_status
  ON platform_incidents(status, detected_at DESC);
-- Ack-deadline scanner: open incidents that have not yet been flagged.
CREATE INDEX IF NOT EXISTS idx_platform_incidents_ack_open
  ON platform_incidents(detected_at)
  WHERE acknowledged_at IS NULL AND ack_breached_at IS NULL
    AND status NOT IN ('resolved','postmortem_due','closed');

-- Which merchants were affected. A join table rather than a jsonb array,
-- because "was this tenant affected by anything last month" is a question a
-- support conversation actually asks.
CREATE TABLE IF NOT EXISTS platform_incident_tenants (
  incident_id uuid NOT NULL REFERENCES platform_incidents(id) ON DELETE CASCADE,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  impact      text NOT NULL DEFAULT 'partial' CHECK (impact IN ('full','partial','none')),
  PRIMARY KEY (incident_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_platform_incident_tenants_tenant
  ON platform_incident_tenants(tenant_id);

-- Append-only timeline. The postmortem is written FROM this, so it has to be
-- captured while the incident is live — reconstructing it afterwards from
-- memory is how postmortems become fiction.
CREATE TABLE IF NOT EXISTS platform_incident_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id   uuid NOT NULL REFERENCES platform_incidents(id) ON DELETE CASCADE,
  at            timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_kind    text NOT NULL DEFAULT 'user' CHECK (actor_kind IN ('user','system')),
  kind          text NOT NULL,
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_platform_incident_events_incident
  ON platform_incident_events(incident_id, at);

-- On-call rota. A shift is a half-open interval [starts_at, ends_at).
CREATE TABLE IF NOT EXISTS platform_oncall_shifts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz NOT NULL,
  -- An override wins over a regular shift covering the same instant: someone
  -- swapped out at short notice and the rota should say so without deleting
  -- the original.
  is_override boolean NOT NULL DEFAULT false,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_platform_oncall_window
  ON platform_oncall_shifts(starts_at, ends_at);

-- RLS: these tables are reached only through the service-role client behind
-- requirePlatformOwner. Enabling RLS with no permissive policy means a leaked
-- anon key reads nothing, which is the correct default for internal data.
ALTER TABLE platform_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_incident_tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_incident_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_oncall_shifts ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Apply it and verify against the live database**

```sql
select tablename, rowsecurity from pg_tables
 where schemaname='public' and tablename like 'platform_%' order by tablename;
-- expect 4 rows, rowsecurity true on all 4

select count(*) as should_be_zero from information_schema.columns
 where table_name='platform_incidents' and column_name='tenant_id';
```

The second query is the point of the whole split. It must return 0.

- [ ] **Step 3: Record it in the migrations README**

Add a `0204_platform_incidents.sql` row to the log table and bump **Next migration number** to **0205**.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0204_platform_incidents.sql supabase/migrations/README.md
git commit -m "feat(platform-incidents): migration 0204 — schema with no tenant_id"
```

---

## Task 2: Export the platform-owner guard

**Files:**

- Create: `apps/api/src/lib/platform-auth.ts`
- Create: `apps/api/src/lib/platform-auth.test.ts`
- Modify: `apps/api/src/routes/admin-console.ts:28-38`

**Interfaces:**

- Produces: `requirePlatformOwner(req, res, next): void`

> The spec says "reuse the existing guard". It is currently private to
> `admin-console.ts`, so it cannot be reused without this task. Moving it
> rather than copying it keeps one definition — two copies of an auth check
> drift, and the copy that drifts is the one nobody is looking at.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/platform-auth.test.ts`:

```ts
import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import type { Request, Response, NextFunction } from 'express'
import { requirePlatformOwner } from './platform-auth.js'

const PLATFORM = 'aaaaaaaa-0000-0000-0000-00000platform'

function run(tenantId: string | undefined, role: string | undefined) {
  const req = { tenantId, role } as unknown as Request
  const json = jest.fn()
  const res = { status: jest.fn(() => ({ json })), json } as unknown as Response
  const next = jest.fn() as unknown as NextFunction
  requirePlatformOwner(req, res, next)
  return { next, res, json }
}

beforeEach(() => {
  process.env['PLATFORM_TENANT_ID'] = PLATFORM
})

describe('requirePlatformOwner', () => {
  it('allows the platform tenant owner through', () => {
    const { next } = run(PLATFORM, 'owner')
    expect(next).toHaveBeenCalled()
  })

  it('refuses another tenant owner', () => {
    const { next, res } = run('some-other-tenant', 'owner')
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('refuses a non-owner inside the platform tenant', () => {
    const { next, res } = run(PLATFORM, 'staff')
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(403)
  })

  it('fails closed when PLATFORM_TENANT_ID is unset', () => {
    // An unconfigured environment must not turn the admin console into an
    // open door for whoever happens to have tenantId undefined.
    delete process.env['PLATFORM_TENANT_ID']
    const { next, res } = run(undefined, 'owner')
    expect(next).not.toHaveBeenCalled()
    expect(res.status).toHaveBeenCalledWith(403)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test --workspace=@nuatis/api -- src/lib/platform-auth.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the lib, moving the function verbatim**

Create `apps/api/src/lib/platform-auth.ts`:

```ts
import type { Request, Response, NextFunction } from 'express'
import type { AuthenticatedRequest } from './auth.js'

/**
 * The platform-owner gate: a designated internal tenant whose `owner` login is
 * trusted with cross-tenant internal work.
 *
 * Moved here from routes/admin-console.ts so platform incidents can reuse it.
 * Deliberately not a new auth mode — a tenant-less admin identity was already
 * considered and rejected when the admin console was built, and reintroducing
 * it for one feature would fork the platform's auth story.
 *
 * Fails closed when PLATFORM_TENANT_ID is unset.
 */
export function requirePlatformOwner(req: Request, res: Response, next: NextFunction): void {
  const authed = req as AuthenticatedRequest
  const platformTenantId = process.env['PLATFORM_TENANT_ID']
  if (!platformTenantId || authed.tenantId !== platformTenantId || authed.role !== 'owner') {
    res.status(403).json({ error: 'Not authorized' })
    return
  }
  next()
}
```

- [ ] **Step 4: Delete the private copy and import the shared one**

In `apps/api/src/routes/admin-console.ts`, remove the local `requirePlatformOwner` definition (lines 28-36) and add:

```ts
import { requirePlatformOwner } from '../lib/platform-auth.js'
```

`router.use(requireAuth, requirePlatformOwner)` on line 38 stays exactly as it is.

- [ ] **Step 5: Run the new test and the existing admin-console suite**

```bash
npm test --workspace=@nuatis/api -- src/lib/platform-auth.test.ts src/routes/admin-console.integration.test.ts
```

Expected: both PASS. The admin-console suite is the regression check that the move changed no behaviour.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/platform-auth.ts apps/api/src/lib/platform-auth.test.ts apps/api/src/routes/admin-console.ts
git commit -m "refactor(admin-console): extract requirePlatformOwner so it can be reused"
```

---

## Task 3: Core service module — severity, ack targets, the postmortem gate

**Files:**

- Create: `apps/api/src/lib/platform-incidents.ts`
- Create: `apps/api/src/lib/platform-incidents.test.ts`

**Interfaces:**

- Produces:
  - `PLATFORM_SEVERITIES: readonly ['sev1','sev2','sev3','sev4']`, `type PlatformSeverity`
  - `PLATFORM_STATUSES: readonly [...]`, `type PlatformStatus`
  - `ACK_TARGET_MINUTES: Record<PlatformSeverity, number | null>`
  - `ackDueAt(severity: PlatformSeverity, detectedAt: Date): Date | null`
  - `requiresPostmortem(severity: PlatformSeverity): boolean`
  - `canTransition(from: PlatformStatus, to: PlatformStatus, severity: PlatformSeverity): boolean`
  - `generatePlatformReference(now: Date): Promise<string>`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/platform-incidents.test.ts`:

```ts
import { describe, it, expect } from '@jest/globals'
import {
  ACK_TARGET_MINUTES,
  ackDueAt,
  requiresPostmortem,
  canTransition,
} from './platform-incidents.js'

describe('ack targets', () => {
  it('gives SEV1 fifteen minutes, because SEV1 means nobody can take money', () => {
    expect(ACK_TARGET_MINUTES.sev1).toBe(15)
  })

  it('gives SEV2 an hour and SEV3 a business day', () => {
    expect(ACK_TARGET_MINUTES.sev2).toBe(60)
    expect(ACK_TARGET_MINUTES.sev3).toBe(60 * 8)
  })

  it('gives SEV4 no deadline at all', () => {
    // Best effort. A deadline nobody intends to meet is noise that teaches
    // people to ignore the real ones.
    expect(ACK_TARGET_MINUTES.sev4).toBeNull()
    expect(ackDueAt('sev4', new Date())).toBeNull()
  })

  it('counts the deadline from detection', () => {
    const detected = new Date('2026-09-15T10:00:00.000Z')
    expect(ackDueAt('sev1', detected)!.toISOString()).toBe('2026-09-15T10:15:00.000Z')
  })
})

describe('postmortem gate', () => {
  it('requires a postmortem for SEV1 and SEV2', () => {
    expect(requiresPostmortem('sev1')).toBe(true)
    expect(requiresPostmortem('sev2')).toBe(true)
  })

  it('does not for SEV3 and SEV4', () => {
    expect(requiresPostmortem('sev3')).toBe(false)
    expect(requiresPostmortem('sev4')).toBe(false)
  })

  it('sends a resolved SEV1 to postmortem_due, never straight to closed', () => {
    // This rule is the only thing standing between "we had an outage" and
    // "we learned something", so it lives in the transition map rather than
    // in anyone's discipline.
    expect(canTransition('resolved', 'closed', 'sev1')).toBe(false)
    expect(canTransition('resolved', 'postmortem_due', 'sev1')).toBe(true)
    expect(canTransition('postmortem_due', 'closed', 'sev1')).toBe(true)
  })

  it('lets a resolved SEV3 close directly', () => {
    expect(canTransition('resolved', 'closed', 'sev3')).toBe(true)
  })

  it('refuses a no-op transition so no empty event row is written', () => {
    expect(canTransition('mitigating', 'mitigating', 'sev2')).toBe(false)
  })

  it('refuses reopening a closed incident', () => {
    expect(canTransition('closed', 'detected', 'sev1')).toBe(false)
    expect(canTransition('closed', 'mitigating', 'sev1')).toBe(false)
  })

  it('allows skipping mitigating when a fix was immediate', () => {
    expect(canTransition('acknowledged', 'resolved', 'sev2')).toBe(true)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test --workspace=@nuatis/api -- src/lib/platform-incidents.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

Create `apps/api/src/lib/platform-incidents.ts`:

```ts
import { getServiceClient } from './supabase.js'

export const PLATFORM_SEVERITIES = ['sev1', 'sev2', 'sev3', 'sev4'] as const
export type PlatformSeverity = (typeof PLATFORM_SEVERITIES)[number]

export const PLATFORM_STATUSES = [
  'detected',
  'acknowledged',
  'mitigating',
  'resolved',
  'postmortem_due',
  'closed',
] as const
export type PlatformStatus = (typeof PLATFORM_STATUSES)[number]

/**
 * Minutes from detection to the acknowledgement deadline.
 *
 * SEV1 is anchored to money — merchants cannot take payment — not to a
 * component. The POS socket dropping is a SEV2: the kitchen screen stops
 * updating but the register still takes payment. Anchoring the top severity to
 * revenue is what stops the scale drifting.
 *
 * SEV4 is null rather than a large number: best effort, no deadline. A
 * deadline nobody intends to meet is noise that teaches people to ignore the
 * real ones.
 */
export const ACK_TARGET_MINUTES: Record<PlatformSeverity, number | null> = {
  sev1: 15,
  sev2: 60,
  sev3: 60 * 8,
  sev4: null,
}

export function ackDueAt(severity: PlatformSeverity, detectedAt: Date): Date | null {
  const minutes = ACK_TARGET_MINUTES[severity]
  if (minutes === null) return null
  return new Date(detectedAt.getTime() + minutes * 60_000)
}

/** SEV1 and SEV2 must be written up before they can be closed. */
export function requiresPostmortem(severity: PlatformSeverity): boolean {
  return severity === 'sev1' || severity === 'sev2'
}

/**
 * Explicit transition map, the same shape routes/orders.ts uses.
 *
 * A status is never its own successor, so a no-op is refused and no event row
 * is written for a change that did not happen. `closed` and the terminal end
 * of the map have no successors: an incident that is over stays over, and a
 * new problem is a new incident rather than a resurrected one.
 */
const BASE_TRANSITIONS: Record<PlatformStatus, PlatformStatus[]> = {
  detected: ['acknowledged', 'mitigating', 'resolved'],
  acknowledged: ['mitigating', 'resolved'],
  mitigating: ['resolved'],
  resolved: ['postmortem_due', 'closed'],
  postmortem_due: ['closed'],
  closed: [],
}

export function canTransition(
  from: PlatformStatus,
  to: PlatformStatus,
  severity: PlatformSeverity
): boolean {
  if (!BASE_TRANSITIONS[from].includes(to)) return false
  // The gate: a severity that owes a postmortem cannot jump resolved -> closed.
  if (from === 'resolved' && to === 'closed' && requiresPostmortem(severity)) return false
  return true
}

/**
 * SEV-YYYY-NNN, counting within the calendar year.
 *
 * Mirrors generateIncidentReference's counter pattern from sub-project A. The
 * unique index on `reference` is the real guard against the select-then-insert
 * race, which is acceptable at the volume of incidents a platform team
 * declares by hand.
 */
export async function generatePlatformReference(now: Date): Promise<string> {
  const supabase = getServiceClient()
  const year = now.getUTCFullYear()
  const prefix = `SEV-${year}-`

  const { data } = await supabase
    .from('platform_incidents')
    .select('reference')
    .like('reference', `${prefix}%`)
    .order('reference', { ascending: false })
    .limit(1)

  const rows = (data ?? []) as { reference: string }[]
  const last = rows[0]?.reference
  // Defensive parse: a hand-edited reference must not produce SEV-2026-NaN and
  // then collide with itself on every subsequent insert.
  const parsed = last ? Number(last.slice(prefix.length)) : 0
  const n = Number.isFinite(parsed) ? parsed : 0
  return `${prefix}${String(n + 1).padStart(3, '0')}`
}
```

- [ ] **Step 4: Run the tests**

```bash
npm test --workspace=@nuatis/api -- src/lib/platform-incidents.test.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/platform-incidents.ts apps/api/src/lib/platform-incidents.test.ts
git commit -m "feat(platform-incidents): severity, ack targets and the postmortem gate"
```

---

## Task 4: The on-call rota resolver

**Files:**

- Create: `apps/api/src/lib/oncall.ts`
- Create: `apps/api/src/lib/oncall.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks beyond the `platform_oncall_shifts` table from Task 1.
- Produces: `whoIsOnCallAt(when: Date): Promise<string | null>` — returns a `users.id` or null.

> Decision 8.1: the rota answers "who should pick this up right now"; the
> incident's own `assigned_to_user_id` records who actually owned it. Both
> exist because without the column, an incident from last Tuesday would render
> as assigned to whoever is on call today — the rota rotates and the historical
> record moves with it, which makes the timeline lie.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/oncall.test.ts`:

```ts
import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()
jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const { whoIsOnCallAt } = await import('./oncall.js')

const AT = new Date('2026-09-15T12:00:00.000Z')

function shift(overrides: Record<string, unknown> = {}) {
  return {
    id: `s-${Math.random().toString(36).slice(2, 8)}`,
    user_id: 'user-dana',
    starts_at: '2026-09-15T09:00:00.000Z',
    ends_at: '2026-09-15T17:00:00.000Z',
    is_override: false,
    ...overrides,
  }
}

beforeEach(() => {
  store = createStore()
  store.tables['platform_oncall_shifts'] = []
})

describe('whoIsOnCallAt', () => {
  it('returns the person whose shift covers the instant', async () => {
    store.tables['platform_oncall_shifts'] = [shift()]
    expect(await whoIsOnCallAt(AT)).toBe('user-dana')
  })

  it('returns null when nobody is on call', async () => {
    // Deliberately not "fall back to anyone". A wrong name on an incident is
    // worse than an empty field: it looks owned, so nobody picks it up.
    store.tables['platform_oncall_shifts'] = []
    expect(await whoIsOnCallAt(AT)).toBeNull()
  })

  it('treats the shift as half-open — the end instant belongs to the next shift', async () => {
    store.tables['platform_oncall_shifts'] = [
      shift({
        user_id: 'user-early',
        starts_at: '2026-09-15T04:00:00.000Z',
        ends_at: '2026-09-15T12:00:00.000Z',
      }),
    ]
    expect(await whoIsOnCallAt(AT)).toBeNull()
  })

  it('includes the start instant', async () => {
    store.tables['platform_oncall_shifts'] = [
      shift({ starts_at: '2026-09-15T12:00:00.000Z', ends_at: '2026-09-15T20:00:00.000Z' }),
    ]
    expect(await whoIsOnCallAt(AT)).toBe('user-dana')
  })

  it('lets an override win over a regular shift covering the same instant', async () => {
    // Someone swapped out at short notice. The original shift stays on the
    // rota rather than being deleted, so the history still reads correctly.
    store.tables['platform_oncall_shifts'] = [
      shift({ user_id: 'user-dana' }),
      shift({ user_id: 'user-sam', is_override: true }),
    ]
    expect(await whoIsOnCallAt(AT)).toBe('user-sam')
  })

  it('does not throw when the query fails', async () => {
    // Declaring an incident must not fail because the rota is unreadable.
    store.tables['platform_oncall_shifts'] = []
    await expect(whoIsOnCallAt(AT)).resolves.toBeNull()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test --workspace=@nuatis/api -- src/lib/oncall.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

Create `apps/api/src/lib/oncall.ts`:

```ts
import { getServiceClient } from './supabase.js'

interface ShiftRow {
  user_id: string
  starts_at: string
  ends_at: string
  is_override: boolean
}

/**
 * Who should pick up an incident detected at `when`.
 *
 * Shifts are half-open intervals `[starts_at, ends_at)`, so a handover at
 * 17:00 belongs to the incoming shift and two adjacent shifts can never both
 * claim the same instant.
 *
 * Returns null when nobody is on call, deliberately rather than falling back
 * to an arbitrary person: a wrong name on an incident is worse than an empty
 * field, because it looks owned and so nobody picks it up.
 */
export async function whoIsOnCallAt(when: Date): Promise<string | null> {
  try {
    const supabase = getServiceClient()
    const at = when.toISOString()

    const { data, error } = await supabase
      .from('platform_oncall_shifts')
      .select('user_id, starts_at, ends_at, is_override')
      .lte('starts_at', at)
      .gt('ends_at', at)

    if (error) {
      console.error('[oncall] rota query failed:', error.message)
      return null
    }

    const covering = (data ?? []) as ShiftRow[]
    if (covering.length === 0) return null

    // An override wins over a regular shift for the same instant.
    const override = covering.find((s) => s.is_override)
    return (override ?? covering[0]!).user_id
  } catch (err) {
    console.error('[oncall] rota lookup failed:', err)
    return null
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
npm test --workspace=@nuatis/api -- src/lib/oncall.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/oncall.ts apps/api/src/lib/oncall.test.ts
git commit -m "feat(platform-incidents): on-call rota resolver"
```

---

## Task 5: Declare, list and read an incident

**Files:**

- Create: `apps/api/src/routes/admin-console-incidents.ts`
- Create: `apps/api/src/routes/admin-console-incidents.integration.test.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**

- Consumes: `requirePlatformOwner` (Task 2); `PLATFORM_SEVERITIES`, `generatePlatformReference`, `ackDueAt` (Task 3); `whoIsOnCallAt` (Task 4).
- Produces: `POST /api/admin-console/incidents`, `GET /api/admin-console/incidents`, `GET /api/admin-console/incidents/:id`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/routes/admin-console-incidents.integration.test.ts`. Mirror the mock-and-token setup used by `admin-console.integration.test.ts` in the same directory, then:

```ts
describe('POST /api/admin-console/incidents', () => {
  it('declares an incident with a SEV reference and an opening event', async () => {
    const res = await request(makeApp())
      .post('/api/admin-console/incidents')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ severity: 'sev1', title: 'Register cannot take payment', component: 'api' })

    expect(res.status).toBe(201)
    expect(res.body.incident.reference).toMatch(/^SEV-\d{4}-\d{3}$/)
    expect(res.body.incident.status).toBe('detected')
    const events = store.tables['platform_incident_events'] ?? []
    expect(events).toHaveLength(1)
    expect(events[0]!['kind']).toBe('detected')
  })

  it('assigns the person on call at detection time', async () => {
    store.tables['platform_oncall_shifts'] = [
      {
        id: 's1',
        user_id: 'user-dana',
        starts_at: '2000-01-01T00:00:00.000Z',
        ends_at: '2099-01-01T00:00:00.000Z',
        is_override: false,
      },
    ]
    const res = await request(makeApp())
      .post('/api/admin-console/incidents')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ severity: 'sev2', title: 'POS socket dropping' })

    expect(res.body.incident.assigned_to_user_id).toBe('user-dana')
  })

  it('leaves the assignee empty when nobody is on call', async () => {
    const res = await request(makeApp())
      .post('/api/admin-console/incidents')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ severity: 'sev2', title: 'POS socket dropping' })

    expect(res.body.incident.assigned_to_user_id).toBeNull()
  })

  it('stamps an ack deadline from severity', async () => {
    const res = await request(makeApp())
      .post('/api/admin-console/incidents')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ severity: 'sev1', title: 'x' })

    const detected = new Date(res.body.incident.detected_at).getTime()
    const due = new Date(res.body.incident.ack_due_at).getTime()
    expect(due - detected).toBe(15 * 60_000)
  })

  it('rejects a severity outside the scale', async () => {
    const res = await request(makeApp())
      .post('/api/admin-console/incidents')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ severity: 'sev9', title: 'x' })
    expect(res.status).toBe(400)
  })

  it('requires a title', async () => {
    const res = await request(makeApp())
      .post('/api/admin-console/incidents')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ severity: 'sev3' })
    expect(res.status).toBe(400)
  })

  it('refuses a non-platform tenant', async () => {
    const res = await request(makeApp())
      .post('/api/admin-console/incidents')
      .set('Authorization', `Bearer ${await makeOtherTenantToken()}`)
      .send({ severity: 'sev1', title: 'x' })
    expect(res.status).toBe(403)
    expect(store.tables['platform_incidents'] ?? []).toHaveLength(0)
  })
})

describe('GET /api/admin-console/incidents', () => {
  it('lists newest first and filters by status', async () => {
    store.tables['platform_incidents'] = [
      {
        id: 'i1',
        reference: 'SEV-2026-001',
        severity: 'sev1',
        status: 'closed',
        title: 'old',
        detected_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'i2',
        reference: 'SEV-2026-002',
        severity: 'sev2',
        status: 'mitigating',
        title: 'live',
        detected_at: '2026-06-01T00:00:00Z',
      },
    ]
    const res = await request(makeApp())
      .get('/api/admin-console/incidents?status=mitigating')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].id).toBe('i2')
  })
})

describe('GET /api/admin-console/incidents/:id', () => {
  it('returns the incident with its timeline in order', async () => {
    store.tables['platform_incidents'] = [
      {
        id: 'i1',
        reference: 'SEV-2026-001',
        severity: 'sev1',
        status: 'detected',
        title: 'x',
        detected_at: '2026-01-01T00:00:00Z',
      },
    ]
    store.tables['platform_incident_events'] = [
      {
        id: 'e2',
        incident_id: 'i1',
        at: '2026-01-01T02:00:00Z',
        kind: 'acknowledged',
        actor_kind: 'user',
        detail: {},
      },
      {
        id: 'e1',
        incident_id: 'i1',
        at: '2026-01-01T00:00:00Z',
        kind: 'detected',
        actor_kind: 'user',
        detail: {},
      },
    ]
    const res = await request(makeApp())
      .get('/api/admin-console/incidents/i1')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)

    expect(res.body.events.map((e: { id: string }) => e.id)).toEqual(['e1', 'e2'])
  })

  it('404s for an id that does not exist', async () => {
    const res = await request(makeApp())
      .get('/api/admin-console/incidents/nope')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm test --workspace=@nuatis/api -- src/routes/admin-console-incidents.integration.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the router**

Create `apps/api/src/routes/admin-console-incidents.ts`. The router applies the guard once at the top, exactly as `admin-console.ts` does:

```ts
import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { requirePlatformOwner } from '../lib/platform-auth.js'
import { whoIsOnCallAt } from '../lib/oncall.js'
import {
  PLATFORM_SEVERITIES,
  PLATFORM_STATUSES,
  ackDueAt,
  generatePlatformReference,
  type PlatformSeverity,
} from '../lib/platform-incidents.js'

const router = Router()
router.use(requireAuth, requirePlatformOwner)

// ── POST /api/admin-console/incidents ────────────────────────────────────────
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const body = req.body as Record<string, unknown>

  const severity = String(body['severity'] ?? '')
  if (!(PLATFORM_SEVERITIES as readonly string[]).includes(severity)) {
    res.status(400).json({ error: `severity must be one of: ${PLATFORM_SEVERITIES.join(', ')}` })
    return
  }
  const title = typeof body['title'] === 'string' ? body['title'].trim() : ''
  if (!title) {
    res.status(400).json({ error: 'title is required' })
    return
  }

  const now = new Date()
  const reference = await generatePlatformReference(now)
  // The rota answers who should pick this up; the column records who owned it.
  const onCall = await whoIsOnCallAt(now)
  const due = ackDueAt(severity as PlatformSeverity, now)

  const { data: incident, error } = await supabase
    .from('platform_incidents')
    .insert({
      reference,
      severity,
      status: 'detected',
      title,
      summary: typeof body['summary'] === 'string' ? body['summary'] : null,
      component: typeof body['component'] === 'string' ? body['component'] : null,
      assigned_to_user_id: onCall,
      detected_at: now.toISOString(),
      ack_due_at: due ? due.toISOString() : null,
    })
    .select('*')
    .single<{ id: string }>()

  if (error || !incident) {
    res.status(500).json({ error: error?.message ?? 'Failed to declare incident' })
    return
  }

  await supabase.from('platform_incident_events').insert({
    incident_id: incident.id,
    actor_kind: 'user',
    actor_user_id: authed.appUserId,
    kind: 'detected',
    detail: { severity, component: body['component'] ?? null, assigned_to_user_id: onCall },
  })

  res.status(201).json({ incident })
})

// ── GET /api/admin-console/incidents ─────────────────────────────────────────
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()
  const page = Math.max(1, Number(req.query['page']) || 1)
  const limit = Math.min(100, Math.max(1, Number(req.query['limit']) || 50))
  const from = (page - 1) * limit

  let query = supabase.from('platform_incidents').select('*', { count: 'exact' })

  const status = req.query['status']
  if (typeof status === 'string' && (PLATFORM_STATUSES as readonly string[]).includes(status)) {
    query = query.eq('status', status)
  }
  const severity = req.query['severity']
  if (
    typeof severity === 'string' &&
    (PLATFORM_SEVERITIES as readonly string[]).includes(severity)
  ) {
    query = query.eq('severity', severity)
  }

  const { data, error, count } = await query
    .order('detected_at', { ascending: false })
    .range(from, from + limit - 1)

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ data: data ?? [], total: count ?? 0, page })
})

// ── GET /api/admin-console/incidents/:id ─────────────────────────────────────
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()

  const { data: incident } = await supabase
    .from('platform_incidents')
    .select('*')
    .eq('id', req.params['id'])
    .maybeSingle()

  if (!incident) {
    res.status(404).json({ error: 'Incident not found' })
    return
  }

  const { data: events } = await supabase
    .from('platform_incident_events')
    .select('*')
    .eq('incident_id', req.params['id'])

  const timeline = ((events ?? []) as { at: string }[]).sort((a, b) => a.at.localeCompare(b.at))
  res.json({ incident, events: timeline })
})

export default router
```

- [ ] **Step 4: Mount the router**

In `apps/api/src/index.ts`, alongside the other admin-console mount:

```ts
import adminConsoleIncidentsRouter from './routes/admin-console-incidents.js'
app.use('/api/admin-console/incidents', adminConsoleIncidentsRouter)
```

Mount it **before** any `/api/admin-console` catch-all, the same ordering rule sub-project A needed for `/api/incidents/reports`.

- [ ] **Step 5: Run the tests**

```bash
npm test --workspace=@nuatis/api -- src/routes/admin-console-incidents.integration.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin-console-incidents.ts apps/api/src/routes/admin-console-incidents.integration.test.ts apps/api/src/index.ts
git commit -m "feat(platform-incidents): declare, list and read"
```

---

## Task 6: Transitions, acknowledgement and the postmortem gate

**Files:**

- Modify: `apps/api/src/routes/admin-console-incidents.ts`
- Modify: `apps/api/src/routes/admin-console-incidents.integration.test.ts`

**Interfaces:**

- Consumes: `canTransition`, `requiresPostmortem` (Task 3).
- Produces: `PATCH /api/admin-console/incidents/:id`.

- [ ] **Step 1: Write the failing tests**

Append to the integration test:

```ts
describe('PATCH /api/admin-console/incidents/:id', () => {
  beforeEach(() => {
    store.tables['platform_incidents'] = [
      {
        id: 'i1',
        reference: 'SEV-2026-001',
        severity: 'sev1',
        status: 'detected',
        title: 'x',
        detected_at: '2026-01-01T00:00:00Z',
        acknowledged_at: null,
        postmortem: null,
      },
    ]
    store.tables['platform_incident_events'] = []
  })

  it('acknowledges, stamping who and when', async () => {
    const res = await request(makeApp())
      .patch('/api/admin-console/incidents/i1')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ status: 'acknowledged' })

    expect(res.status).toBe(200)
    const row = (store.tables['platform_incidents'] as Record<string, unknown>[])[0]!
    expect(row['acknowledged_at']).toEqual(expect.any(String))
    expect(row['acknowledged_by']).toBeTruthy()
  })

  it('refuses to close a resolved SEV1 with no postmortem', async () => {
    // The gate. This is the only thing standing between "we had an outage"
    // and "we learned something".
    ;(store.tables['platform_incidents'] as Record<string, unknown>[])[0]!['status'] = 'resolved'
    const res = await request(makeApp())
      .patch('/api/admin-console/incidents/i1')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ status: 'closed' })

    expect(res.status).toBe(400)
  })

  it('refuses to leave postmortem_due for closed while the postmortem is empty', async () => {
    // Moving to postmortem_due must not become a way to tick the box.
    const row = (store.tables['platform_incidents'] as Record<string, unknown>[])[0]!
    row['status'] = 'postmortem_due'
    row['postmortem'] = null
    const res = await request(makeApp())
      .patch('/api/admin-console/incidents/i1')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ status: 'closed' })

    expect(res.status).toBe(400)
  })

  it('closes a SEV1 once the postmortem is written', async () => {
    const row = (store.tables['platform_incidents'] as Record<string, unknown>[])[0]!
    row['status'] = 'postmortem_due'
    row['postmortem'] = '## What happened\nThe register could not reach Stripe.'
    const res = await request(makeApp())
      .patch('/api/admin-console/incidents/i1')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ status: 'closed' })

    expect(res.status).toBe(200)
  })

  it('lets a resolved SEV3 close directly', async () => {
    const row = (store.tables['platform_incidents'] as Record<string, unknown>[])[0]!
    row['severity'] = 'sev3'
    row['status'] = 'resolved'
    const res = await request(makeApp())
      .patch('/api/admin-console/incidents/i1')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ status: 'closed' })

    expect(res.status).toBe(200)
  })

  it('refuses a no-op so no empty event row is written', async () => {
    const res = await request(makeApp())
      .patch('/api/admin-console/incidents/i1')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ status: 'detected' })

    expect(res.status).toBe(400)
    expect(store.tables['platform_incident_events']).toHaveLength(0)
  })

  it('stamps resolved_at on resolution', async () => {
    const res = await request(makeApp())
      .patch('/api/admin-console/incidents/i1')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ status: 'resolved' })

    expect(res.status).toBe(200)
    expect(
      (store.tables['platform_incidents'] as Record<string, unknown>[])[0]!['resolved_at']
    ).toEqual(expect.any(String))
  })

  it('reassigns only to a user inside the platform tenant', async () => {
    // users.id is a plain FK with no tenant in it, so nothing in the schema
    // stops an incident being handed to a merchant's user account.
    store.tables['users'] = [{ id: 'user-outsider', tenant_id: 'some-merchant' }]
    const res = await request(makeApp())
      .patch('/api/admin-console/incidents/i1')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ assigned_to_user_id: 'user-outsider' })

    expect(res.status).toBe(400)
  })

  it('writes an event for every change it accepts', async () => {
    await request(makeApp())
      .patch('/api/admin-console/incidents/i1')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ status: 'acknowledged' })

    const events = store.tables['platform_incident_events'] ?? []
    expect(events).toHaveLength(1)
    expect(events[0]!['kind']).toBe('status_changed')
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm test --workspace=@nuatis/api -- src/routes/admin-console-incidents.integration.test.ts -t "PATCH"
```

Expected: FAIL — no PATCH route.

- [ ] **Step 3: Implement the PATCH handler**

Append to `apps/api/src/routes/admin-console-incidents.ts`, before `export default router`:

```ts
// ── PATCH /api/admin-console/incidents/:id ───────────────────────────────────
router.patch('/:id', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const body = req.body as Record<string, unknown>

  const { data: current } = await supabase
    .from('platform_incidents')
    .select('id, status, severity, postmortem')
    .eq('id', req.params['id'])
    .maybeSingle<{
      id: string
      status: PlatformStatus
      severity: PlatformSeverity
      postmortem: string | null
    }>()

  if (!current) {
    res.status(404).json({ error: 'Incident not found' })
    return
  }

  const patch: Record<string, unknown> = {}
  const events: { kind: string; detail: Record<string, unknown> }[] = []

  if (typeof body['assigned_to_user_id'] === 'string') {
    const assignee = body['assigned_to_user_id']
    // users.id is a plain FK with no tenant in it, so nothing in the schema
    // stops an incident being handed to a merchant's user account — where it
    // would read as owned by someone who can never see it.
    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('id', assignee)
      .eq('tenant_id', process.env['PLATFORM_TENANT_ID'] ?? '')
      .maybeSingle<{ id: string }>()

    if (!user) {
      res.status(400).json({ error: 'Assignee is not a platform user' })
      return
    }
    patch['assigned_to_user_id'] = assignee
    events.push({ kind: 'assigned', detail: { assigned_to_user_id: assignee } })
  }

  if (typeof body['postmortem'] === 'string') {
    patch['postmortem'] = body['postmortem']
    events.push({ kind: 'postmortem_written', detail: {} })
  }

  if (typeof body['status'] === 'string') {
    const next = body['status'] as PlatformStatus
    if (!(PLATFORM_STATUSES as readonly string[]).includes(next)) {
      res.status(400).json({ error: `status must be one of: ${PLATFORM_STATUSES.join(', ')}` })
      return
    }
    if (!canTransition(current.status, next, current.severity)) {
      res.status(400).json({
        error:
          requiresPostmortem(current.severity) && current.status === 'resolved' && next === 'closed'
            ? `A ${current.severity.toUpperCase()} needs a postmortem before it can be closed`
            : `Cannot move an incident from ${current.status} to ${next}`,
      })
      return
    }
    // postmortem_due -> closed is legal in the map, but only once something is
    // actually written. Otherwise the gate becomes a box to tick.
    const writtenNow = typeof body['postmortem'] === 'string' ? body['postmortem'].trim() : ''
    const alreadyWritten = (current.postmortem ?? '').trim()
    if (
      next === 'closed' &&
      requiresPostmortem(current.severity) &&
      !writtenNow &&
      !alreadyWritten
    ) {
      res.status(400).json({ error: 'Write the postmortem before closing this incident' })
      return
    }

    patch['status'] = next
    if (next === 'acknowledged') {
      patch['acknowledged_at'] = new Date().toISOString()
      patch['acknowledged_by'] = authed.appUserId
    }
    if (next === 'mitigating') patch['mitigated_at'] = new Date().toISOString()
    if (next === 'resolved') patch['resolved_at'] = new Date().toISOString()
    events.push({ kind: 'status_changed', detail: { from: current.status, to: next } })
  }

  if (Object.keys(patch).length === 0) {
    res.status(400).json({ error: 'Nothing to update' })
    return
  }
  patch['updated_at'] = new Date().toISOString()

  const { data: updated, error } = await supabase
    .from('platform_incidents')
    .update(patch)
    .eq('id', req.params['id'])
    .select('*')
    .single()

  if (error || !updated) {
    res.status(500).json({ error: error?.message ?? 'Failed to update incident' })
    return
  }

  for (const e of events) {
    await supabase.from('platform_incident_events').insert({
      incident_id: current.id,
      actor_kind: 'user',
      actor_user_id: authed.appUserId,
      kind: e.kind,
      detail: e.detail,
    })
  }

  res.json({ incident: updated })
})
```

Extend the existing import from `../lib/platform-incidents.js` to also bring in `canTransition`, `requiresPostmortem`, `type PlatformStatus`.

- [ ] **Step 4: Run the tests**

```bash
npm test --workspace=@nuatis/api -- src/routes/admin-console-incidents.integration.test.ts
```

Expected: PASS, 19 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin-console-incidents.ts apps/api/src/routes/admin-console-incidents.integration.test.ts
git commit -m "feat(platform-incidents): transitions, acknowledgement and the postmortem gate"
```

---

## Task 7: Record which merchants were affected

**Files:**

- Modify: `apps/api/src/routes/admin-console-incidents.ts`
- Modify: `apps/api/src/routes/admin-console-incidents.integration.test.ts`

**Interfaces:**

- Produces: `PUT /api/admin-console/incidents/:id/tenants` (replaces the set), `GET /api/admin-console/incidents/:id/tenants`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('incident tenant impact', () => {
  beforeEach(() => {
    store.tables['platform_incidents'] = [
      {
        id: 'i1',
        reference: 'SEV-2026-001',
        severity: 'sev2',
        status: 'mitigating',
        title: 'x',
        detected_at: '2026-01-01T00:00:00Z',
      },
    ]
    store.tables['platform_incident_tenants'] = []
    store.tables['tenants'] = [{ id: 'tenant-a' }, { id: 'tenant-b' }]
  })

  it('attaches affected tenants with an impact level', async () => {
    const res = await request(makeApp())
      .put('/api/admin-console/incidents/i1/tenants')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({
        tenants: [
          { tenant_id: 'tenant-a', impact: 'full' },
          { tenant_id: 'tenant-b', impact: 'partial' },
        ],
      })

    expect(res.status).toBe(200)
    expect(store.tables['platform_incident_tenants']).toHaveLength(2)
  })

  it('replaces the set rather than appending, so removing a tenant works', async () => {
    store.tables['platform_incident_tenants'] = [
      { incident_id: 'i1', tenant_id: 'tenant-b', impact: 'full' },
    ]
    await request(makeApp())
      .put('/api/admin-console/incidents/i1/tenants')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ tenants: [{ tenant_id: 'tenant-a', impact: 'full' }] })

    const rows = store.tables['platform_incident_tenants'] as Record<string, unknown>[]
    expect(rows).toHaveLength(1)
    expect(rows[0]!['tenant_id']).toBe('tenant-a')
  })

  it('rejects a tenant id that does not exist', async () => {
    const res = await request(makeApp())
      .put('/api/admin-console/incidents/i1/tenants')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ tenants: [{ tenant_id: 'ghost', impact: 'full' }] })

    expect(res.status).toBe(400)
    expect(store.tables['platform_incident_tenants']).toHaveLength(0)
  })

  it('rejects an impact level outside the scale', async () => {
    const res = await request(makeApp())
      .put('/api/admin-console/incidents/i1/tenants')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ tenants: [{ tenant_id: 'tenant-a', impact: 'catastrophic' }] })

    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm test --workspace=@nuatis/api -- src/routes/admin-console-incidents.integration.test.ts -t "tenant impact"
```

Expected: FAIL — no such route.

- [ ] **Step 3: Implement both handlers**

Append to the router, before `export default router`:

```ts
const IMPACTS = ['full', 'partial', 'none'] as const

// ── PUT /api/admin-console/incidents/:id/tenants ─────────────────────────────
// Replaces the whole set. Attaching is how a support conversation later answers
// "was this tenant affected by anything last month", so it has to be editable
// as the blast radius becomes clear, including shrinking.
router.put('/:id/tenants', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()
  const body = req.body as { tenants?: { tenant_id?: unknown; impact?: unknown }[] }
  const incoming = Array.isArray(body.tenants) ? body.tenants : []

  const rows: { incident_id: string; tenant_id: string; impact: string }[] = []
  for (const entry of incoming) {
    const tenantId = typeof entry.tenant_id === 'string' ? entry.tenant_id : ''
    const impact = typeof entry.impact === 'string' ? entry.impact : 'partial'
    if (!tenantId) {
      res.status(400).json({ error: 'Each entry needs a tenant_id' })
      return
    }
    if (!(IMPACTS as readonly string[]).includes(impact)) {
      res.status(400).json({ error: `impact must be one of: ${IMPACTS.join(', ')}` })
      return
    }
    const { data: tenant } = await supabase
      .from('tenants')
      .select('id')
      .eq('id', tenantId)
      .maybeSingle<{ id: string }>()
    if (!tenant) {
      res.status(400).json({ error: `Unknown tenant: ${tenantId}` })
      return
    }
    rows.push({ incident_id: req.params['id'] as string, tenant_id: tenantId, impact })
  }

  await supabase.from('platform_incident_tenants').delete().eq('incident_id', req.params['id'])
  if (rows.length > 0) {
    const { error } = await supabase.from('platform_incident_tenants').insert(rows)
    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
  }

  res.json({ tenants: rows })
})

// ── GET /api/admin-console/incidents/:id/tenants ─────────────────────────────
router.get('/:id/tenants', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()
  const { data } = await supabase
    .from('platform_incident_tenants')
    .select('tenant_id, impact')
    .eq('incident_id', req.params['id'])
  res.json({ tenants: data ?? [] })
})
```

- [ ] **Step 4: Run the tests**

```bash
npm test --workspace=@nuatis/api -- src/routes/admin-console-incidents.integration.test.ts
```

Expected: PASS, 23 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin-console-incidents.ts apps/api/src/routes/admin-console-incidents.integration.test.ts
git commit -m "feat(platform-incidents): record which merchants were affected"
```

---

## Task 8: The customer message, and publishing it

**Files:**

- Modify: `apps/api/src/routes/admin-console-incidents.ts`
- Modify: `apps/api/src/routes/admin-console-incidents.integration.test.ts`

**Interfaces:**

- Produces: `PUT /api/admin-console/incidents/:id/customer-message`, `POST /api/admin-console/incidents/:id/customer-message/publish`.

> Decision 8.2. Writing the text and publishing it are **two separate
> operations on purpose**. One-step publishing means a half-finished sentence
> reaches every affected merchant the moment someone saves.

- [ ] **Step 1: Write the failing tests**

```ts
describe('customer message', () => {
  beforeEach(() => {
    store.tables['platform_incidents'] = [
      {
        id: 'i1',
        reference: 'SEV-2026-001',
        severity: 'sev1',
        status: 'mitigating',
        title: 'Internal: stripe key rotation broke checkout',
        detected_at: '2026-01-01T00:00:00Z',
        customer_message: null,
        customer_message_published_at: null,
      },
    ]
  })

  it('saves a draft without publishing it', async () => {
    const res = await request(makeApp())
      .put('/api/admin-console/incidents/i1/customer-message')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ customer_message: 'Card payments were unavailable between 09:00 and 09:20.' })

    expect(res.status).toBe(200)
    const row = (store.tables['platform_incidents'] as Record<string, unknown>[])[0]!
    expect(row['customer_message']).toContain('Card payments')
    // Saved is not sent.
    expect(row['customer_message_published_at']).toBeNull()
  })

  it('publishes only after the text exists', async () => {
    const res = await request(makeApp())
      .post('/api/admin-console/incidents/i1/customer-message/publish')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({})

    expect(res.status).toBe(400)
  })

  it('publishes once the text is written', async () => {
    ;(store.tables['platform_incidents'] as Record<string, unknown>[])[0]!['customer_message'] =
      'Card payments were unavailable.'
    const res = await request(makeApp())
      .post('/api/admin-console/incidents/i1/customer-message/publish')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({})

    expect(res.status).toBe(200)
    expect(
      (store.tables['platform_incidents'] as Record<string, unknown>[])[0]![
        'customer_message_published_at'
      ]
    ).toEqual(expect.any(String))
  })

  it('records publishing on the timeline', async () => {
    ;(store.tables['platform_incidents'] as Record<string, unknown>[])[0]!['customer_message'] =
      'text'
    store.tables['platform_incident_events'] = []
    await request(makeApp())
      .post('/api/admin-console/incidents/i1/customer-message/publish')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({})

    const events = store.tables['platform_incident_events'] as Record<string, unknown>[]
    expect(events.some((e) => e['kind'] === 'customer_message_published')).toBe(true)
  })

  it('can be unpublished, because a wrong notice must be retractable', async () => {
    const row = (store.tables['platform_incidents'] as Record<string, unknown>[])[0]!
    row['customer_message'] = 'text'
    row['customer_message_published_at'] = '2026-01-01T00:00:00Z'
    const res = await request(makeApp())
      .post('/api/admin-console/incidents/i1/customer-message/publish')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({ published: false })

    expect(res.status).toBe(200)
    expect(
      (store.tables['platform_incidents'] as Record<string, unknown>[])[0]![
        'customer_message_published_at'
      ]
    ).toBeNull()
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm test --workspace=@nuatis/api -- src/routes/admin-console-incidents.integration.test.ts -t "customer message"
```

Expected: FAIL — no such routes.

- [ ] **Step 3: Implement both handlers**

```ts
// ── PUT /api/admin-console/incidents/:id/customer-message ────────────────────
// Saving is not sending. Publishing is a separate act (below), because
// one-step publishing means a half-written sentence reaches every affected
// merchant the moment someone saves.
router.put('/:id/customer-message', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()
  const body = req.body as Record<string, unknown>
  const text = typeof body['customer_message'] === 'string' ? body['customer_message'] : ''

  const { data, error } = await supabase
    .from('platform_incidents')
    .update({ customer_message: text || null, updated_at: new Date().toISOString() })
    .eq('id', req.params['id'])
    .select('id, customer_message, customer_message_published_at')
    .single()

  if (error || !data) {
    res.status(error ? 500 : 404).json({ error: error?.message ?? 'Incident not found' })
    return
  }
  res.json({ incident: data })
})

// ── POST /api/admin-console/incidents/:id/customer-message/publish ───────────
router.post('/:id/customer-message/publish', async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()
  const body = req.body as Record<string, unknown>
  const publishing = body['published'] !== false

  const { data: current } = await supabase
    .from('platform_incidents')
    .select('id, customer_message')
    .eq('id', req.params['id'])
    .maybeSingle<{ id: string; customer_message: string | null }>()

  if (!current) {
    res.status(404).json({ error: 'Incident not found' })
    return
  }
  if (publishing && !(current.customer_message ?? '').trim()) {
    res.status(400).json({ error: 'Write the customer message before publishing it' })
    return
  }

  const at = publishing ? new Date().toISOString() : null
  const { error } = await supabase
    .from('platform_incidents')
    .update({ customer_message_published_at: at, updated_at: new Date().toISOString() })
    .eq('id', req.params['id'])

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  await supabase.from('platform_incident_events').insert({
    incident_id: current.id,
    actor_kind: 'user',
    actor_user_id: authed.appUserId,
    kind: publishing ? 'customer_message_published' : 'customer_message_retracted',
    detail: {},
  })

  res.json({ published_at: at })
})
```

- [ ] **Step 4: Run the tests**

```bash
npm test --workspace=@nuatis/api -- src/routes/admin-console-incidents.integration.test.ts
```

Expected: PASS, 28 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin-console-incidents.ts apps/api/src/routes/admin-console-incidents.integration.test.ts
git commit -m "feat(platform-incidents): customer message, written and published separately"
```

---

## Task 9: The tenant-facing notice endpoint

**Files:**

- Create: `apps/api/src/routes/platform-notices.ts`
- Create: `apps/api/src/routes/platform-notices.integration.test.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**

- Produces: `GET /api/platform-notices` — returns only published customer messages for incidents affecting the calling tenant.

> **This is the security-critical task of the sub-project.** It is the one
> endpoint where internal ops data could become customer-facing. The test that
> matters most is the one asserting the internal title never appears in the
> response — write it first and never delete it.

- [ ] **Step 1: Write the failing tests**

```ts
describe('GET /api/platform-notices', () => {
  beforeEach(() => {
    store.tables['platform_incidents'] = [
      {
        id: 'i1',
        reference: 'SEV-2026-001',
        severity: 'sev1',
        status: 'mitigating',
        title: 'INTERNAL: rotated the stripe key and broke checkout',
        summary: 'INTERNAL: rollback in progress, see runbook',
        component: 'api',
        customer_message: 'Card payments were briefly unavailable this morning.',
        customer_message_published_at: '2026-01-01T09:30:00Z',
        detected_at: '2026-01-01T09:00:00Z',
      },
    ]
    store.tables['platform_incident_tenants'] = [
      { incident_id: 'i1', tenant_id: TENANT_ID, impact: 'full' },
    ]
  })

  it('returns the published customer message for an affected tenant', async () => {
    const res = await request(makeApp())
      .get('/api/platform-notices')
      .set('Authorization', `Bearer ${await makeTenantToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.notices).toHaveLength(1)
    expect(res.body.notices[0].message).toContain('Card payments')
  })

  it('never exposes the internal title, summary or component', async () => {
    // The whole point of the two-column split. If this ever fails, an internal
    // sentence is on its way to a merchant's screen.
    const res = await request(makeApp())
      .get('/api/platform-notices')
      .set('Authorization', `Bearer ${await makeTenantToken()}`)

    const body = JSON.stringify(res.body)
    expect(body).not.toContain('INTERNAL')
    expect(body).not.toContain('rotated the stripe key')
    expect(body).not.toContain('runbook')
    expect(res.body.notices[0]).not.toHaveProperty('title')
    expect(res.body.notices[0]).not.toHaveProperty('summary')
    expect(res.body.notices[0]).not.toHaveProperty('component')
  })

  it('hides an unpublished message even from an affected tenant', async () => {
    ;(store.tables['platform_incidents'] as Record<string, unknown>[])[0]![
      'customer_message_published_at'
    ] = null
    const res = await request(makeApp())
      .get('/api/platform-notices')
      .set('Authorization', `Bearer ${await makeTenantToken()}`)

    expect(res.body.notices).toHaveLength(0)
  })

  it('hides it from a tenant that was not affected', async () => {
    store.tables['platform_incident_tenants'] = [
      { incident_id: 'i1', tenant_id: 'someone-else', impact: 'full' },
    ]
    const res = await request(makeApp())
      .get('/api/platform-notices')
      .set('Authorization', `Bearer ${await makeTenantToken()}`)

    expect(res.body.notices).toHaveLength(0)
  })

  it('excludes tenants recorded with impact none', async () => {
    ;(store.tables['platform_incident_tenants'] as Record<string, unknown>[])[0]!['impact'] = 'none'
    const res = await request(makeApp())
      .get('/api/platform-notices')
      .set('Authorization', `Bearer ${await makeTenantToken()}`)

    expect(res.body.notices).toHaveLength(0)
  })

  it('requires authentication', async () => {
    const res = await request(makeApp()).get('/api/platform-notices')
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm test --workspace=@nuatis/api -- src/routes/platform-notices.integration.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the router**

Create `apps/api/src/routes/platform-notices.ts`:

```ts
import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'

const router = Router()

/**
 * The ONLY tenant-facing view of a platform incident.
 *
 * It selects `customer_message` and its publish timestamp and nothing else.
 * `title`, `summary`, `component` and the event timeline are internal and are
 * never on this path — that is a structural guarantee rather than a review
 * habit, and it is why the customer text lives in its own column instead of
 * being a flag on the internal one.
 *
 * No platform-owner guard here: this is for merchants. It is scoped to the
 * caller's own tenant through platform_incident_tenants.
 */
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const { data: links } = await supabase
    .from('platform_incident_tenants')
    .select('incident_id, impact')
    .eq('tenant_id', authed.tenantId)

  // 'none' means we checked and this merchant was not affected. Recording that
  // is useful internally; showing them a notice about it is not.
  const affected = ((links ?? []) as { incident_id: string; impact: string }[]).filter(
    (l) => l.impact !== 'none'
  )
  if (affected.length === 0) {
    res.json({ notices: [] })
    return
  }

  const { data, error } = await supabase
    .from('platform_incidents')
    .select('id, customer_message, customer_message_published_at, resolved_at')
    .in(
      'id',
      affected.map((l) => l.incident_id)
    )
    .not('customer_message_published_at', 'is', null)
    .order('customer_message_published_at', { ascending: false })

  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const rows = (data ?? []) as {
    id: string
    customer_message: string | null
    customer_message_published_at: string
    resolved_at: string | null
  }[]

  // Reshaped explicitly rather than spread, so a column added to
  // platform_incidents later cannot silently start appearing here.
  res.json({
    notices: rows.map((r) => ({
      id: r.id,
      message: r.customer_message,
      published_at: r.customer_message_published_at,
      resolved_at: r.resolved_at,
    })),
  })
})

export default router
```

- [ ] **Step 4: Mount it**

In `apps/api/src/index.ts`:

```ts
import platformNoticesRouter from './routes/platform-notices.js'
app.use('/api/platform-notices', platformNoticesRouter)
```

- [ ] **Step 5: Run the tests**

```bash
npm test --workspace=@nuatis/api -- src/routes/platform-notices.integration.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/platform-notices.ts apps/api/src/routes/platform-notices.integration.test.ts apps/api/src/index.ts
git commit -m "feat(platform-incidents): tenant-facing notices, customer message only"
```

---

## Task 10: Rota management routes

**Files:**

- Create: `apps/api/src/routes/admin-console-oncall.ts`
- Create: `apps/api/src/routes/admin-console-oncall.integration.test.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**

- Consumes: `requirePlatformOwner` (Task 2), `whoIsOnCallAt` (Task 4).
- Produces: `GET /api/admin-console/oncall` (shifts in a window), `GET /api/admin-console/oncall/now`, `POST /api/admin-console/oncall`, `DELETE /api/admin-console/oncall/:id`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('rota routes', () => {
  beforeEach(() => {
    store.tables['platform_oncall_shifts'] = []
    store.tables['users'] = [{ id: 'user-dana', tenant_id: PLATFORM_TENANT_ID, full_name: 'Dana' }]
  })

  it('creates a shift', async () => {
    const res = await request(makeApp())
      .post('/api/admin-console/oncall')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({
        user_id: 'user-dana',
        starts_at: '2026-09-15T09:00:00Z',
        ends_at: '2026-09-15T17:00:00Z',
      })

    expect(res.status).toBe(201)
    expect(store.tables['platform_oncall_shifts']).toHaveLength(1)
  })

  it('refuses a shift that ends before it starts', async () => {
    const res = await request(makeApp())
      .post('/api/admin-console/oncall')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({
        user_id: 'user-dana',
        starts_at: '2026-09-15T17:00:00Z',
        ends_at: '2026-09-15T09:00:00Z',
      })

    expect(res.status).toBe(400)
  })

  it('refuses a user outside the platform tenant', async () => {
    // Putting a merchant's account on the Nuatis on-call rota would assign
    // them incidents they can never see.
    store.tables['users'] = [{ id: 'user-outsider', tenant_id: 'some-merchant' }]
    const res = await request(makeApp())
      .post('/api/admin-console/oncall')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)
      .send({
        user_id: 'user-outsider',
        starts_at: '2026-09-15T09:00:00Z',
        ends_at: '2026-09-15T17:00:00Z',
      })

    expect(res.status).toBe(400)
  })

  it('reports who is on call right now', async () => {
    store.tables['platform_oncall_shifts'] = [
      {
        id: 's1',
        user_id: 'user-dana',
        starts_at: '2000-01-01T00:00:00Z',
        ends_at: '2099-01-01T00:00:00Z',
        is_override: false,
      },
    ]
    const res = await request(makeApp())
      .get('/api/admin-console/oncall/now')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)

    expect(res.body.user_id).toBe('user-dana')
  })

  it('says so plainly when nobody is on call', async () => {
    const res = await request(makeApp())
      .get('/api/admin-console/oncall/now')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.user_id).toBeNull()
  })

  it('deletes a shift', async () => {
    store.tables['platform_oncall_shifts'] = [
      {
        id: 's1',
        user_id: 'user-dana',
        starts_at: '2026-09-15T09:00:00Z',
        ends_at: '2026-09-15T17:00:00Z',
        is_override: false,
      },
    ]
    const res = await request(makeApp())
      .delete('/api/admin-console/oncall/s1')
      .set('Authorization', `Bearer ${await makePlatformToken()}`)

    expect(res.status).toBe(200)
    expect(store.tables['platform_oncall_shifts']).toHaveLength(0)
  })

  it('refuses a non-platform tenant', async () => {
    const res = await request(makeApp())
      .post('/api/admin-console/oncall')
      .set('Authorization', `Bearer ${await makeOtherTenantToken()}`)
      .send({
        user_id: 'user-dana',
        starts_at: '2026-09-15T09:00:00Z',
        ends_at: '2026-09-15T17:00:00Z',
      })

    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm test --workspace=@nuatis/api -- src/routes/admin-console-oncall.integration.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the router**

Create `apps/api/src/routes/admin-console-oncall.ts`:

```ts
import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth } from '../lib/auth.js'
import { requirePlatformOwner } from '../lib/platform-auth.js'
import { whoIsOnCallAt } from '../lib/oncall.js'

const router = Router()
router.use(requireAuth, requirePlatformOwner)

// ── GET /api/admin-console/oncall/now ────────────────────────────────────────
// Declared before '/:id'-shaped routes so 'now' is never read as an id.
router.get('/now', async (_req: Request, res: Response): Promise<void> => {
  const userId = await whoIsOnCallAt(new Date())
  if (!userId) {
    res.json({ user_id: null, user: null })
    return
  }
  const supabase = getServiceClient()
  const { data: user } = await supabase
    .from('users')
    .select('id, full_name')
    .eq('id', userId)
    .maybeSingle<{ id: string; full_name: string }>()
  res.json({ user_id: userId, user: user ?? null })
})

// ── GET /api/admin-console/oncall ────────────────────────────────────────────
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()
  const from = typeof req.query['from'] === 'string' ? req.query['from'] : null
  const to = typeof req.query['to'] === 'string' ? req.query['to'] : null

  let query = supabase.from('platform_oncall_shifts').select('*')
  if (from) query = query.gte('ends_at', from)
  if (to) query = query.lte('starts_at', to)

  const { data, error } = await query.order('starts_at', { ascending: true })
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ shifts: data ?? [] })
})

// ── POST /api/admin-console/oncall ───────────────────────────────────────────
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()
  const body = req.body as Record<string, unknown>

  const userId = typeof body['user_id'] === 'string' ? body['user_id'] : ''
  const startsAt = typeof body['starts_at'] === 'string' ? body['starts_at'] : ''
  const endsAt = typeof body['ends_at'] === 'string' ? body['ends_at'] : ''

  if (!userId || !startsAt || !endsAt) {
    res.status(400).json({ error: 'user_id, starts_at and ends_at are required' })
    return
  }
  if (!(Date.parse(endsAt) > Date.parse(startsAt))) {
    res.status(400).json({ error: 'ends_at must be after starts_at' })
    return
  }

  // users.id is a plain FK with no tenant in it. Putting a merchant's account
  // on the Nuatis rota would assign them incidents they can never see.
  const { data: user } = await supabase
    .from('users')
    .select('id')
    .eq('id', userId)
    .eq('tenant_id', process.env['PLATFORM_TENANT_ID'] ?? '')
    .maybeSingle<{ id: string }>()

  if (!user) {
    res.status(400).json({ error: 'That user is not on the platform team' })
    return
  }

  const { data, error } = await supabase
    .from('platform_oncall_shifts')
    .insert({
      user_id: userId,
      starts_at: startsAt,
      ends_at: endsAt,
      is_override: body['is_override'] === true,
      note: typeof body['note'] === 'string' ? body['note'] : null,
    })
    .select('*')
    .single()

  if (error || !data) {
    res.status(500).json({ error: error?.message ?? 'Failed to create shift' })
    return
  }
  res.status(201).json({ shift: data })
})

// ── DELETE /api/admin-console/oncall/:id ─────────────────────────────────────
router.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const supabase = getServiceClient()
  const { error } = await supabase
    .from('platform_oncall_shifts')
    .delete()
    .eq('id', req.params['id'])
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }
  res.json({ ok: true })
})

export default router
```

- [ ] **Step 4: Mount it**

```ts
import adminConsoleOncallRouter from './routes/admin-console-oncall.js'
app.use('/api/admin-console/oncall', adminConsoleOncallRouter)
```

- [ ] **Step 5: Run the tests**

```bash
npm test --workspace=@nuatis/api -- src/routes/admin-console-oncall.integration.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin-console-oncall.ts apps/api/src/routes/admin-console-oncall.integration.test.ts apps/api/src/index.ts
git commit -m "feat(platform-incidents): on-call rota routes"
```

---

## Task 11: `notifyPlatformTeam`

**Files:**

- Create: `apps/api/src/lib/notify-platform-team.ts`
- Create: `apps/api/src/lib/notify-platform-team.test.ts`

**Interfaces:**

- Produces: `notifyPlatformTeam(eventType: string, payload: { title: string; body: string; url?: string }): Promise<void>`

> **Gap G2.** The spec says this "sends to a configured internal address list".
> There is no generic `sendEmail` in this codebase — `lib/email-send.ts` is
> per-tenant Gmail/Outlook OAuth for _merchant_ mailboxes, and `notifyOwner`
> itself sends web push, not email. Writing an email-shaped function with no
> transport would produce a notifier that silently drops every alert, which is
> exactly what sub-project A's commented-out SMS branch does.
>
> So this ships on two transports that exist today: web push to the platform
> tenant, and an optional outbound webhook (`PLATFORM_ALERT_WEBHOOK_URL`,
> Slack-shaped). Email is deferred with a comment, not faked.

- [ ] **Step 1: Write the failing tests**

```ts
import { jest, describe, it, expect, beforeEach } from '@jest/globals'

const sendPushNotification = jest.fn<() => Promise<void>>()
jest.unstable_mockModule('./push-client.js', () => ({ sendPushNotification }))

const PLATFORM = 'aaaaaaaa-0000-0000-0000-00000platform'
const { notifyPlatformTeam } = await import('./notify-platform-team.js')

beforeEach(() => {
  sendPushNotification.mockClear()
  sendPushNotification.mockResolvedValue(undefined)
  process.env['PLATFORM_TENANT_ID'] = PLATFORM
  delete process.env['PLATFORM_ALERT_WEBHOOK_URL']
  global.fetch = jest.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch
})

describe('notifyPlatformTeam', () => {
  it('pushes to the platform tenant, never to a merchant', async () => {
    // notifyOwner would mail the merchant. Getting this wrong tells every
    // customer about an internal outage.
    await notifyPlatformTeam('platform_incident_declared', { title: 'SEV1', body: 'x' })

    expect(sendPushNotification).toHaveBeenCalledTimes(1)
    expect((sendPushNotification.mock.calls[0] as unknown as string[])[0]).toBe(PLATFORM)
  })

  it('posts to the alert webhook when one is configured', async () => {
    process.env['PLATFORM_ALERT_WEBHOOK_URL'] = 'https://hooks.example.com/abc'
    await notifyPlatformTeam('platform_incident_declared', { title: 'SEV1', body: 'register down' })

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://hooks.example.com/abc')
    expect(String(init.body)).toContain('register down')
  })

  it('skips the webhook when none is configured', async () => {
    await notifyPlatformTeam('platform_incident_declared', { title: 'x', body: 'y' })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('does nothing and does not throw when PLATFORM_TENANT_ID is unset', async () => {
    delete process.env['PLATFORM_TENANT_ID']
    await expect(notifyPlatformTeam('x', { title: 'a', body: 'b' })).resolves.toBeUndefined()
    expect(sendPushNotification).not.toHaveBeenCalled()
  })

  it('still pushes when the webhook fails', async () => {
    // One broken Slack URL must not cost the team the alert entirely.
    process.env['PLATFORM_ALERT_WEBHOOK_URL'] = 'https://hooks.example.com/abc'
    global.fetch = jest.fn(async () => {
      throw new Error('dns')
    }) as unknown as typeof fetch

    await expect(notifyPlatformTeam('x', { title: 'a', body: 'b' })).resolves.toBeUndefined()
    expect(sendPushNotification).toHaveBeenCalledTimes(1)
  })

  it('never throws', async () => {
    sendPushNotification.mockRejectedValue(new Error('push is down'))
    await expect(notifyPlatformTeam('x', { title: 'a', body: 'b' })).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm test --workspace=@nuatis/api -- src/lib/notify-platform-team.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

Create `apps/api/src/lib/notify-platform-team.ts`:

```ts
import { sendPushNotification } from './push-client.js'

/**
 * Tell the Nuatis team about an internal incident.
 *
 * **Never use `notifyOwner` for this.** That function targets a merchant's
 * tenant, and reaching for it here would send an internal outage notice to
 * every customer.
 *
 * Transports are the two that exist today:
 *
 *   1. Web push to the platform tenant — the same machinery notifyOwner uses,
 *      aimed at the internal tenant whose owner logs into the admin console.
 *   2. An optional outbound webhook (PLATFORM_ALERT_WEBHOOK_URL), Slack-shaped,
 *      because an internal ops alert usually wants to land in a channel.
 *
 * Email is deliberately absent. There is no transactional email provider in
 * this codebase — lib/email-send.ts is per-tenant Gmail/Outlook OAuth for
 * merchant mailboxes and is the wrong tool. Adding an email branch that cannot
 * send would be a notifier that silently drops alerts, which is worse than not
 * offering the channel.
 *
 * Fire-and-forget and never throws: a failed notification must not fail the
 * incident operation that triggered it.
 */
export async function notifyPlatformTeam(
  eventType: string,
  payload: { title: string; body: string; url?: string }
): Promise<void> {
  const platformTenantId = process.env['PLATFORM_TENANT_ID']
  if (!platformTenantId) {
    console.warn(`[notify-platform-team] PLATFORM_TENANT_ID unset — dropping ${eventType}`)
    return
  }

  const webhookUrl = process.env['PLATFORM_ALERT_WEBHOOK_URL']
  if (webhookUrl) {
    // Independent of push: one broken Slack URL must not cost the team the
    // alert entirely, so this is caught on its own.
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `*${payload.title}*\n${payload.body}`,
          event_type: eventType,
          url: payload.url ?? null,
        }),
        signal: controller.signal,
      })
    } catch (err) {
      console.error('[notify-platform-team] webhook failed:', err)
    } finally {
      clearTimeout(timeout)
    }
  }

  try {
    await sendPushNotification(platformTenantId, {
      title: payload.title,
      body: payload.body,
      url: payload.url,
    })
  } catch (err) {
    console.error('[notify-platform-team] push failed:', err)
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
npm test --workspace=@nuatis/api -- src/lib/notify-platform-team.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Call it on declaration**

In `apps/api/src/routes/admin-console-incidents.ts`, after the opening event insert in `POST /`:

```ts
void notifyPlatformTeam('platform_incident_declared', {
  title: `${severity.toUpperCase()} declared — ${reference}`,
  body: title,
  url: `/admin-console/incidents/${incident.id}`,
})
```

- [ ] **Step 6: Document the env vars**

Add to `apps/api/.env.example`:

```
# Internal ops alerting. PLATFORM_TENANT_ID already exists for the admin console.
# Optional Slack-compatible incoming webhook for platform incident alerts.
PLATFORM_ALERT_WEBHOOK_URL=
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/notify-platform-team.ts apps/api/src/lib/notify-platform-team.test.ts apps/api/src/routes/admin-console-incidents.ts apps/api/.env.example
git commit -m "feat(platform-incidents): notifyPlatformTeam over push and webhook"
```

---

## Task 12: Ack-deadline scanner

**Files:**

- Create: `apps/api/src/workers/platform-ack-scanner.ts`
- Create: `apps/api/src/workers/platform-ack-scanner.test.ts`
- Modify: `apps/api/src/workers/index.ts`

**Interfaces:**

- Consumes: `notifyPlatformTeam` (Task 11); `createBullMQConnection` from `lib/bullmq-connection.js`.
- Produces: `scan(): Promise<void>`, `createPlatformAckScanner(): { queue: Queue; worker: Worker }`.

> Runs every 5 minutes, not the daily cron the tenant-side scanners use: a
> 15-minute SEV1 deadline checked hourly is not a deadline. `getPausedTenants`
> is deliberately **not** consulted — it is a per-tenant control and these
> incidents have no tenant.

- [ ] **Step 1: Write the failing tests**

```ts
describe('platform-ack-scanner', () => {
  it('escalates a SEV1 that nobody acknowledged inside 15 minutes', async () => {
    store.tables['platform_incidents'] = [
      incident({ severity: 'sev1', detected_at: minutesAgo(20), ack_due_at: minutesAgo(5) }),
    ]
    await scan()
    expect(notifyPlatformTeam).toHaveBeenCalledTimes(1)
  })

  it('leaves an acknowledged incident alone', async () => {
    store.tables['platform_incidents'] = [
      incident({ severity: 'sev1', ack_due_at: minutesAgo(5), acknowledged_at: minutesAgo(10) }),
    ]
    await scan()
    expect(notifyPlatformTeam).not.toHaveBeenCalled()
  })

  it('escalates once, not on every tick', async () => {
    store.tables['platform_incidents'] = [incident({ severity: 'sev1', ack_due_at: minutesAgo(5) })]
    await scan()
    await scan()
    await scan()
    expect(notifyPlatformTeam).toHaveBeenCalledTimes(1)
  })

  it('stamps the breach before notifying', async () => {
    // A crash between the two costs one missed escalation; the other order
    // costs a duplicate every five minutes forever, which is how a team
    // learns to mute the alert.
    store.tables['platform_incidents'] = [incident({ ack_due_at: minutesAgo(5) })]
    await scan()
    expect(
      (store.tables['platform_incidents'] as Record<string, unknown>[])[0]!['ack_breached_at']
    ).toEqual(expect.any(String))
  })

  it('ignores SEV4, which has no deadline', async () => {
    store.tables['platform_incidents'] = [
      incident({ severity: 'sev4', ack_due_at: null, detected_at: minutesAgo(600) }),
    ]
    await scan()
    expect(notifyPlatformTeam).not.toHaveBeenCalled()
  })

  it('ignores an incident already past acknowledgement', async () => {
    store.tables['platform_incidents'] = [
      incident({ status: 'resolved', ack_due_at: minutesAgo(5) }),
    ]
    await scan()
    expect(notifyPlatformTeam).not.toHaveBeenCalled()
  })

  it('does not throw when the query fails', async () => {
    await expect(scan()).resolves.toBeUndefined()
  })
})
```

Use the `supabase-mock` setup from Task 4's test, mocking `../lib/notify-platform-team.js` instead of the push client, and define `incident()` / `minutesAgo()` helpers in the same shape.

- [ ] **Step 2: Run them and watch them fail**

```bash
npm test --workspace=@nuatis/api -- src/workers/platform-ack-scanner.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the scanner**

Model it on `apps/api/src/workers/incident-sla-scanner.ts` from sub-project A: select unbreached rows past their deadline, stamp `ack_breached_at` **before** notifying, then notify. Select with:

```ts
const { data, error } = await supabase
  .from('platform_incidents')
  .select('id, reference, severity, title, ack_due_at')
  .lt('ack_due_at', now)
  .is('ack_breached_at', null)
  .is('acknowledged_at', null)
  .not('status', 'in', '(resolved,postmortem_due,closed)')
```

`ack_due_at IS NULL` for SEV4 excludes it automatically — `.lt()` never matches null — so no special case is needed. One notification per incident here, unlike the tenant-side scanner's per-tenant batching: the platform team is one audience and a SEV1 deserves its own alert.

- [ ] **Step 4: Register it on a 5-minute cron**

In `apps/api/src/workers/index.ts`, following the numbered-comment style of the existing entries:

```ts
const platformAckScanner = createPlatformAckScanner()
await platformAckScanner.queue.add(
  'scan',
  {},
  { repeat: { pattern: '*/5 * * * *' }, jobId: 'platform-ack-scanner-5min' }
)
managed.push({ name: 'platform-ack-scanner', ...platformAckScanner })
console.info('[workers] platform-ack-scanner started, cron */5 * * * *')
```

- [ ] **Step 5: Run the tests**

```bash
npm test --workspace=@nuatis/api -- src/workers/platform-ack-scanner.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/workers/platform-ack-scanner.ts apps/api/src/workers/platform-ack-scanner.test.ts apps/api/src/workers/index.ts
git commit -m "feat(platform-incidents): ack-deadline scanner on a 5-minute cron"
```

---

## Task 13: Sentry auto-detection, shipped disabled

**Files:**

- Create: `apps/api/src/lib/platform-detection.ts`
- Create: `apps/api/src/lib/platform-detection.test.ts`
- Modify: `apps/api/.env.example`

**Interfaces:**

- Consumes: `generatePlatformReference`, `ackDueAt` (Task 3); `notifyPlatformTeam` (Task 11).
- Produces: `autoDetectionEnabled(): boolean`, `maybeDeclareFromErrorRate(input: { windowMinutes: number; errorCount: number }): Promise<string | null>` — returns a new incident id, or null.

> Decision 8.3: manual now, with the hook built and **off by default**. A
> tracker that declares its own incidents before anyone trusts its thresholds
> trains the team to ignore it. Building the hook now means calibration is a
> config change rather than a project.

- [ ] **Step 1: Write the failing tests**

```ts
describe('autoDetectionEnabled', () => {
  it('is off when the flag is unset — the shipping default', async () => {
    delete process.env['PLATFORM_AUTO_DETECT']
    expect(autoDetectionEnabled()).toBe(false)
  })

  it('is off for any value other than an explicit true', async () => {
    process.env['PLATFORM_AUTO_DETECT'] = '1'
    expect(autoDetectionEnabled()).toBe(false)
    process.env['PLATFORM_AUTO_DETECT'] = 'yes'
    expect(autoDetectionEnabled()).toBe(false)
  })

  it('is on only for "true"', async () => {
    process.env['PLATFORM_AUTO_DETECT'] = 'true'
    expect(autoDetectionEnabled()).toBe(true)
  })
})

describe('maybeDeclareFromErrorRate', () => {
  it('declares nothing while the flag is off, however bad the spike', async () => {
    delete process.env['PLATFORM_AUTO_DETECT']
    const id = await maybeDeclareFromErrorRate({ windowMinutes: 5, errorCount: 10_000 })
    expect(id).toBeNull()
    expect(store.tables['platform_incidents']).toHaveLength(0)
  })

  it('declares a SEV3 above the threshold when enabled', async () => {
    process.env['PLATFORM_AUTO_DETECT'] = 'true'
    const id = await maybeDeclareFromErrorRate({ windowMinutes: 5, errorCount: 500 })
    expect(id).toBeTruthy()
    const row = (store.tables['platform_incidents'] as Record<string, unknown>[])[0]!
    expect(row['severity']).toBe('sev3')
  })

  it('never auto-declares above SEV3', async () => {
    // A machine may say "something is wrong". Only a human decides that
    // merchants cannot take money.
    process.env['PLATFORM_AUTO_DETECT'] = 'true'
    await maybeDeclareFromErrorRate({ windowMinutes: 5, errorCount: 1_000_000 })
    const row = (store.tables['platform_incidents'] as Record<string, unknown>[])[0]!
    expect(row['severity']).toBe('sev3')
  })

  it('stays quiet below the threshold', async () => {
    process.env['PLATFORM_AUTO_DETECT'] = 'true'
    const id = await maybeDeclareFromErrorRate({ windowMinutes: 5, errorCount: 3 })
    expect(id).toBeNull()
  })

  it('does not open a second incident while one is already open', async () => {
    // A spike lasting twenty minutes is one incident, not four.
    process.env['PLATFORM_AUTO_DETECT'] = 'true'
    await maybeDeclareFromErrorRate({ windowMinutes: 5, errorCount: 500 })
    await maybeDeclareFromErrorRate({ windowMinutes: 5, errorCount: 500 })
    expect(store.tables['platform_incidents']).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm test --workspace=@nuatis/api -- src/lib/platform-detection.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

Create `apps/api/src/lib/platform-detection.ts`. Key rules, each enforced by a test above: default off; only the exact string `'true'` enables it; auto-declared incidents are always `sev3`; an existing open auto-declared incident suppresses a second. Use `AUTO_DETECT_ERROR_THRESHOLD = 100` errors per window as the starting number and comment that it is uncalibrated.

```ts
export function autoDetectionEnabled(): boolean {
  // Exact match only. '1' and 'yes' returning false is deliberate: a flag this
  // consequential should be switched on by someone who read the docs.
  return process.env['PLATFORM_AUTO_DETECT'] === 'true'
}
```

- [ ] **Step 4: Document the flag**

Add to `apps/api/.env.example`:

```
# Auto-declare a SEV3 from an error-rate spike. Ships OFF and should stay off
# until the threshold has been calibrated against real traffic — a tracker that
# declares its own incidents before anyone trusts it trains the team to ignore
# it. Only the exact value "true" enables it.
PLATFORM_AUTO_DETECT=
```

- [ ] **Step 5: Run the tests**

```bash
npm test --workspace=@nuatis/api -- src/lib/platform-detection.test.ts
```

Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/platform-detection.ts apps/api/src/lib/platform-detection.test.ts apps/api/.env.example
git commit -m "feat(platform-incidents): error-rate auto-detection, shipped disabled"
```

---

## Task 14: Admin console — incident list and detail

**Files:**

- Create: `apps/web/src/components/admin-console/types.ts`
- Create: `apps/web/src/components/admin-console/PlatformIncidentsBoard.tsx`
- Create: `apps/web/src/components/admin-console/PlatformIncidentDetail.tsx`
- Create: `apps/web/src/components/admin-console/incidents.test.ts`
- Create: `apps/web/src/app/(dashboard)/admin-console/incidents/page.tsx`
- Create: `apps/web/src/app/(dashboard)/admin-console/incidents/[id]/page.tsx`

> **Gap G3.** The admin console is a single 764-line `page.tsx` with no
> components directory. These go in a new `components/admin-console/` folder,
> following the `components/incidents/` split from sub-project A, rather than
> growing that file past a thousand lines.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/components/admin-console/incidents.test.ts` for the pure helpers only — the same approach sub-project A used, since these components are MUI-heavy and the logic worth testing is the formatting and gating:

```ts
import { describe, it, expect } from '@jest/globals'
import { severityColor, ackCountdownLabel, canCloseFromUi } from './types.js'

describe('severityColor', () => {
  it('makes SEV1 unmistakable', () => {
    expect(severityColor('sev1')).toBe('error')
    expect(severityColor('sev4')).toBe('default')
  })
})

describe('ackCountdownLabel', () => {
  it('counts down while there is time left', () => {
    const now = new Date('2026-09-15T10:00:00Z')
    expect(ackCountdownLabel('2026-09-15T10:10:00Z', now)).toBe('10m to ack')
  })

  it('says how late it is once the deadline passed', () => {
    const now = new Date('2026-09-15T10:20:00Z')
    expect(ackCountdownLabel('2026-09-15T10:00:00Z', now)).toBe('20m over')
  })

  it('shows nothing for a severity with no deadline', () => {
    expect(ackCountdownLabel(null, new Date())).toBe('')
  })
})

describe('canCloseFromUi', () => {
  it('hides Close on a resolved SEV1 with no postmortem', () => {
    // The API refuses this anyway — the gate lives in the transition map. The
    // UI matches it so the button is not offered and then rejected.
    expect(canCloseFromUi({ severity: 'sev1', status: 'resolved', postmortem: null })).toBe(false)
  })

  it('offers Close once the postmortem is written', () => {
    expect(
      canCloseFromUi({ severity: 'sev1', status: 'postmortem_due', postmortem: '## What happened' })
    ).toBe(true)
  })

  it('offers Close on a resolved SEV3 immediately', () => {
    expect(canCloseFromUi({ severity: 'sev3', status: 'resolved', postmortem: null })).toBe(true)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm test --workspace=@nuatis/web -- src/components/admin-console/incidents.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `types.ts` with those three helpers plus the DTOs**

`PlatformIncident`, `PlatformIncidentEvent`, `severityColor`, `ackCountdownLabel`, `canCloseFromUi`. `canCloseFromUi` must mirror `canTransition` + the written-postmortem rule from Task 6 exactly.

- [ ] **Step 4: Build the board and detail views**

`PlatformIncidentsBoard` — a table of reference, severity chip, status, title, assignee, ack countdown; filters for status and severity. `PlatformIncidentDetail` — header, timeline, the transition buttons (only those `canCloseFromUi` and the transition map allow), the tenant impact picker reusing the admin console's existing cross-tenant tenant list, the postmortem editor, and the customer-message editor with a separate **Publish** button carrying the warning that it is visible to affected merchants.

- [ ] **Step 5: Add the two pages and the nav entry**

The pages render the two components. Add an `Incidents` link to the admin console page's own navigation.

- [ ] **Step 6: Run the tests and the build**

```bash
npm test --workspace=@nuatis/web -- src/components/admin-console/incidents.test.ts
npm run build --workspace=apps/web
```

Expected: PASS, 6 tests; build succeeds with `/admin-console/incidents` and `/admin-console/incidents/[id]` listed.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/admin-console apps/web/src/app/\(dashboard\)/admin-console/incidents
git commit -m "feat(platform-incidents): admin console list and detail"
```

---

## Task 15: Admin console — rota editor

**Files:**

- Create: `apps/web/src/components/admin-console/OncallRota.tsx`
- Create: `apps/web/src/app/(dashboard)/admin-console/oncall/page.tsx`

- [ ] **Step 1: Build the view**

A week view listing shifts from `GET /api/admin-console/oncall?from=&to=`, a "who is on call now" banner from `GET /api/admin-console/oncall/now` that says **"Nobody is on call"** in a warning colour when `user_id` is null, a form to add a shift, and delete buttons. Overrides render distinctly from regular shifts, since the whole point of the flag is that a reader can see the swap.

- [ ] **Step 2: Verify the empty state honestly**

With no shifts, the banner must read "Nobody is on call" rather than showing a blank name. An empty rota is a real operational state and the page should say so.

- [ ] **Step 3: Build**

```bash
npm run build --workspace=apps/web
```

Expected: succeeds, `/admin-console/oncall` listed.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/admin-console/OncallRota.tsx apps/web/src/app/\(dashboard\)/admin-console/oncall
git commit -m "feat(platform-incidents): on-call rota editor"
```

---

## Task 16: The merchant-facing notice banner

**Files:**

- Create: `apps/web/src/components/PlatformNoticeBanner.tsx`
- Modify: `apps/web/src/app/(dashboard)/layout.tsx`

**Interfaces:**

- Consumes: `GET /api/platform-notices` (Task 9).

- [ ] **Step 1: Build the banner**

Fetches `/api/platform-notices` on mount. Renders nothing when the list is empty — which is the overwhelmingly common case and must cost the dashboard nothing visually. When there is a notice, render the `message` and its `published_at`, dismissible per notice id via `localStorage` so a merchant who has read it is not nagged on every page.

It renders **only** `message`, `published_at` and `resolved_at`. There is no other field on the response to render, by design (Task 9).

- [ ] **Step 2: Mount it in the dashboard layout**

Above the page content, below the top bar. A failed fetch renders nothing — a broken status notice must never break the dashboard.

- [ ] **Step 3: Build**

```bash
npm run build --workspace=apps/web
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/PlatformNoticeBanner.tsx apps/web/src/app/\(dashboard\)/layout.tsx
git commit -m "feat(platform-incidents): merchant-facing notice banner"
```

---

## Final verification

Run before opening the PR. Every box names the command or query that proves it.

- [ ] `npm run typecheck --workspaces --if-present` — clean
- [ ] `npm run lint` — clean at `--max-warnings 0`
- [ ] `npm test --workspaces --if-present` — green
- [ ] `npm run build --workspace=apps/web` — succeeds, all four new routes listed
- [ ] **`platform_incidents` has no `tenant_id`:**
      `select count(*) from information_schema.columns where table_name='platform_incidents' and column_name='tenant_id';` → **0**
- [ ] A SEV1 cannot be closed without a postmortem, and a SEV3 can
- [ ] A merchant hitting `/api/platform-notices` sees the customer message and **never** the internal title — grep the response body for the internal text
- [ ] An unpublished customer message is invisible to the affected tenant
- [ ] A non-platform tenant gets 403 from every `/api/admin-console/*` route
- [ ] Declaring an incident assigns whoever is on call, and leaves it empty when nobody is
- [ ] An unacknowledged SEV1 escalates exactly once across two scanner runs
- [ ] `PLATFORM_AUTO_DETECT` unset means no incident is ever auto-declared
- [ ] Migration 0204 applied to production and recorded in `supabase/migrations/README.md`

---

## Self-review notes

Checked after writing, against the spec:

- **§3 data model** — all four tables in Task 1, plus `assigned_to_user_id`, `customer_message`, `customer_message_published_at`, `ack_due_at` and `ack_breached_at` which §3 does not list because they come from §8's resolutions and the scanner's once-only requirement.
- **§4 severity** — Task 3, with SEV4's null deadline made explicit.
- **§5 lifecycle** — Task 3's transition map; the gate is enforced twice on purpose, once in the map and once on the written text, because `postmortem_due → closed` is legal in the map and must not become a box to tick.
- **§6 surfaces** — Tasks 14–15. The tenant impact picker is part of the detail view.
- **§7 notifications** — Task 11 (transport changed from email, see G2) and Task 12.
- **§8.1** — Tasks 4 and 10, rota plus the assignee column.
- **§8.2** — Tasks 8, 9 and 16, and the `platform_incident_tenants` join from Task 1.
- **§8.3** — Task 13.
- **§8.4** — `postmortem text` in Task 1, edited in Task 14.
- **§9 P1–P4** — P1 Task 1's comment and the final-verification query; P2 Task 2; P3 Task 11; P4 Task 3.

**Fixed during self-review:** an earlier draft introduced `ack_due_at` in Task 5 with a note telling the implementer to go back and amend Task 1's migration. Task 1 now declares the column up front — a plan that asks someone to re-apply an already-applied migration is how sub-project A's 0201/0202 index churn happened.
