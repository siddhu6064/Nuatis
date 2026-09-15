# Incidents — Tenant Core + POS Surface — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship an incident tracker that a cashier can report into from the register, a cook from the kitchen display, and a manager can triage, resolve and report on from the dashboard — with comps recorded, authorised, and visible per staff member.

**Architecture:** One tenant-scoped `incidents` table with two route prefixes over one service module: `/api/pos/incidents` for the PIN-authenticated register and KDS, `/api/incidents` for the dashboard. A POS token carries `portalScope: 'pos'`, which `requireAuth` confines to `/api/pos/*`, so the split is enforced by the auth layer, not by convention. SLA breach is one more BullMQ scanner on the pattern the other 33 workers already follow.

**Tech Stack:** Express + TypeScript (NodeNext ESM, `.js` specifiers), Supabase Postgres, BullMQ, Next 16 App Router, React 19, MUI v9, Jest.

**Spec:** `docs/superpowers/specs/2026-09-15-incidents-tenant-design.md`
**Master checklist:** `docs/superpowers/plans/2026-09-15-incidents-MASTER-CHECKLIST.md`

## Global Constraints

- **Migration number is 0199.** The highest on disk is `0198_pos_terminal_pin.sql`. **Confirm against the live database before writing SQL** — `select name from supabase_migrations.schema_migrations
where name ~ '^[0-9]{4}' order by substring(name from '^[0-9]{4}')::int desc limit 5;`. POS assumed a free number and hit `42P07: relation already exists`.
- **Every migration is idempotent**: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF EXISTS` before `CREATE POLICY`. Migrations here get applied by hand and re-run.
- **RLS uses `current_tenant_id()`**, never the `auth.jwt()->'app_metadata'` form.
- **`getServiceClient()` bypasses RLS.** Application-level `.eq('tenant_id', …)` is the real boundary. Every foreign key arriving in a request body must be proven tenant-owned before it is written — copy the `ownsRow()` helper pattern from `apps/api/src/routes/pos/menu.ts`.
- **Money is integer cents** (`cost_cents integer`) in the database and in TypeScript. Never `numeric`, never float dollars.
- **`portalScope: 'pos'` is confined to `/api/pos/*`** by the fail-closed prefix map in `apps/api/src/lib/auth.ts`. Register and KDS routes MUST live under that prefix.
- **`notifyOwner` does not send SMS.** The SMS branch is commented out in `lib/notifications.ts` pending a personal phone field on `users`. Do not build a UI that offers SMS escalation.
- **Imports in `apps/api` use `.js` specifiers** (NodeNext). Imports in `apps/web`, `apps/pos`, `apps/kds` are extensionless.
- Lint runs at `--max-warnings 0`; a pre-commit hook runs ESLint and Prettier on staged files.
- **Stage files by path.** Never `git add -A` — it swept 2271 iOS build artifacts once.
- Commit after every task.

---

### Task 1: Migration 0199 — incident schema

**Files:**

- Create: `supabase/migrations/0199_incidents.sql`
- Modify: `supabase/migrations/README.md`

**Interfaces:**

- Produces: tables `incidents`, `incident_types`, `incident_rules`, `incident_events`; column `tasks.incident_id`.

- [ ] **Step 1: Confirm the migration number against production**

```sql
select name from supabase_migrations.schema_migrations
 where name ~ '^[0-9]{4}' order by substring(name from '^[0-9]{4}')::int desc limit 5;
```

Expected top row: `0198_pos_terminal_pin`, so **0199 is free**. `max(name)` does **not** work here — the table holds non-numeric
names too (`weekly_digest` sorts above `0198`), so alphabetical max is
meaningless. Order by the numeric prefix instead.

If the top row is higher, renumber this migration and every reference to it before continuing.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/0199_incidents.sql`:

```sql
-- 0199_incidents
-- Tenant-scoped incident tracking: the general module plus the POS surface.
-- Deliberately NOT the same table as platform incidents (see
-- docs/superpowers/specs/2026-09-15-incidents-platform-design.md) — a shared
-- table would put an "and not a platform incident" predicate on every tenant
-- read, and these routes run on the service-role key, which bypasses RLS.

CREATE TABLE IF NOT EXISTS incident_types (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key              text NOT NULL,
  label            text NOT NULL,
  default_severity text NOT NULL DEFAULT 'medium'
                     CHECK (default_severity IN ('low','medium','high','critical')),
  -- Wastage always has a cost; a logged complaint may not.
  requires_cost    boolean NOT NULL DEFAULT false,
  sort_order       integer NOT NULL DEFAULT 0,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS incidents (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  reference              text NOT NULL,
  type_key               text NOT NULL,
  severity               text NOT NULL DEFAULT 'medium'
                           CHECK (severity IN ('low','medium','high','critical')),
  status                 text NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open','triaged','in_progress','resolved','cancelled')),
  title                  text NOT NULL,
  description            text,
  -- Integer cents, not numeric(10,2). Incidents have no generated columns to
  -- stay compatible with, and integer cents removes a conversion at every
  -- boundary. All arithmetic goes through @nuatis/pos-core.
  cost_cents             integer NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  location_id            uuid REFERENCES locations(id) ON DELETE SET NULL,
  order_id               uuid REFERENCES orders(id) ON DELETE SET NULL,
  kitchen_ticket_id      uuid REFERENCES kitchen_tickets(id) ON DELETE SET NULL,
  -- Two reporter columns because the register authenticates a staff_members row
  -- by PIN while the dashboard authenticates a users row. Different identity
  -- spaces; collapsing them would mean inventing a user for every cashier.
  reported_by_staff_id   uuid REFERENCES staff_members(id) ON DELETE SET NULL,
  reported_by_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  authorised_by_staff_id uuid REFERENCES staff_members(id) ON DELETE SET NULL,
  assigned_to_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  sla_due_at             timestamptz,
  resolved_at            timestamptz,
  root_cause             text,
  resolution_notes       text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS incident_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  when_event      text NOT NULL CHECK (when_event IN ('created','breached','unassigned')),
  match_type_key  text,
  match_severity  text CHECK (match_severity IN ('low','medium','high','critical')),
  action          text NOT NULL CHECK (action IN ('assign_to','notify_owner')),
  target_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  delay_minutes   integer NOT NULL DEFAULT 0 CHECK (delay_minutes >= 0),
  enabled         boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Append-only. Status changes, assignment, authorisation and resolution each
-- write one row. This is what makes an incident auditable, which matters most
-- for the ones with money attached.
CREATE TABLE IF NOT EXISTS incident_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_kind  text NOT NULL CHECK (actor_kind IN ('staff','user','system')),
  actor_id    uuid,
  kind        text NOT NULL,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Follow-up work is an ordinary task pointing back at its cause. No task field
-- is duplicated onto incidents.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS incident_id uuid
  REFERENCES incidents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_incidents_tenant_status ON incidents(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_incidents_tenant_created ON incidents(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_incidents_order ON incidents(order_id);
CREATE INDEX IF NOT EXISTS idx_incidents_ticket ON incidents(kitchen_ticket_id);
CREATE INDEX IF NOT EXISTS idx_incidents_sla ON incidents(sla_due_at)
  WHERE status NOT IN ('resolved','cancelled');
CREATE INDEX IF NOT EXISTS idx_incident_events_incident ON incident_events(incident_id);
CREATE INDEX IF NOT EXISTS idx_incident_types_tenant ON incident_types(tenant_id);
CREATE INDEX IF NOT EXISTS idx_incident_rules_tenant ON incident_rules(tenant_id, when_event);
CREATE INDEX IF NOT EXISTS idx_tasks_incident ON tasks(incident_id);

-- Reference numbers restart per tenant. The unique index is the real guard; the
-- counter read in lib/incidents.ts only picks the next number.
CREATE UNIQUE INDEX IF NOT EXISTS idx_incidents_reference_per_tenant
  ON incidents(tenant_id, reference);

ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON incidents;
CREATE POLICY tenant_isolation ON incidents USING (tenant_id = current_tenant_id());

ALTER TABLE incident_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON incident_types;
CREATE POLICY tenant_isolation ON incident_types USING (tenant_id = current_tenant_id());

ALTER TABLE incident_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON incident_rules;
CREATE POLICY tenant_isolation ON incident_rules USING (tenant_id = current_tenant_id());

ALTER TABLE incident_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON incident_events;
CREATE POLICY tenant_isolation ON incident_events USING (tenant_id = current_tenant_id());
```

- [ ] **Step 3: Verify it is re-runnable**

Apply it twice against the database. The second run must succeed with no error.

- [ ] **Step 4: Verify the schema landed**

```sql
select tablename, rowsecurity from pg_tables where tablename like 'incident%';
-- expect 4 rows, rowsecurity = true on all

select data_type from information_schema.columns
 where table_name = 'incidents' and column_name = 'cost_cents';
-- expect: integer
```

- [ ] **Step 5: Record it in the migrations README**

Add a row to the table in `supabase/migrations/README.md` with the "Applied to prod" column filled in.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/0199_incidents.sql supabase/migrations/README.md
git commit -m "feat(incidents): migration 0199 — incident schema"
```

---

### Task 2: Module registration and the entitlement gate

**Files:**

- Modify: `apps/api/src/config/stripe-plans.ts`
- Create: `apps/api/src/lib/incident-module.ts`
- Create: `apps/api/src/lib/incident-module.test.ts`

**Interfaces:**

- Consumes: `isModuleEnabled(tenantId, module)` from `lib/modules.js`.
- Produces: `requireIncidents(req, res, next)` — Express middleware, 403 when the tenant lacks the module.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/incident-module.test.ts`:

```ts
import { describe, it, expect } from '@jest/globals'
import { defaultEntitlement } from '../config/stripe-plans.js'

describe('incidents entitlement', () => {
  it('is included on the scale plan', () => {
    expect(defaultEntitlement('incidents', 'scale', 'suite')).toBe(true)
  })

  it('is not included on core', () => {
    expect(defaultEntitlement('incidents', 'core', 'suite')).toBe(false)
  })

  it('is NOT implied by pos_only — the tracker is the upsell', () => {
    expect(defaultEntitlement('incidents', 'scale', 'pos_only')).toBe(false)
    // The register itself still works.
    expect(defaultEntitlement('pos', 'scale', 'pos_only')).toBe(true)
  })

  it('is not granted to a maya_only tenant', () => {
    expect(defaultEntitlement('incidents', 'scale', 'maya_only')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test --workspace=@nuatis/api -- src/lib/incident-module.test.ts
```

Expected: the scale-plan case FAILS — `incidents` is an unknown module, and `defaultEntitlement` fails closed to `false`.

- [ ] **Step 3: Register the module**

In `apps/api/src/config/stripe-plans.ts`, add `'incidents'` to the `scale` plan's `modules` array (after `'pos'`), and add `'incidents'` to the `TIER_GATED` set.

Do **not** add it to `BASE_SUITE`, and do **not** extend the `pos_only` branch — that branch must keep returning `module === 'pos' || module === 'crm'`.

- [ ] **Step 4: Run the test again**

```bash
npm test --workspace=@nuatis/api -- src/lib/incident-module.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Write the entitlement gate**

Create `apps/api/src/lib/incident-module.ts`:

```ts
import type { Request, Response, NextFunction } from 'express'
import { isModuleEnabled } from './modules.js'
import type { AuthenticatedRequest } from './auth.js'

/**
 * Incidents module gate. Mirrors requirePos in routes/pos/menu.ts —
 * entitlement only, no subscription_status opinion.
 *
 * Deliberately NOT applied to the POS report routes: basic incident capture
 * rides with the `pos` module so a pos_only merchant can log a comp without
 * buying anything. This gate protects the tracker — queue, assignment, SLA,
 * rules — which is what the module actually sells.
 */
export async function requireIncidents(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authed = req as AuthenticatedRequest
  const enabled = await isModuleEnabled(authed.tenantId, 'incidents')
  if (!enabled) {
    res.status(403).json({ error: 'Incidents module is not enabled' })
    return
  }
  next()
}
```

- [ ] **Step 6: Typecheck, lint and commit**

```bash
npm run typecheck --workspace=@nuatis/api && npm run lint --workspace=@nuatis/api
git add apps/api/src/config/stripe-plans.ts apps/api/src/lib/incident-module.ts apps/api/src/lib/incident-module.test.ts
git commit -m "feat(incidents): register the module and its entitlement gate"
```

---

### Task 3: Core service module — references, SLA, authorisation threshold

**Files:**

- Create: `apps/api/src/lib/incidents.ts`
- Create: `apps/api/src/lib/incidents.test.ts`

**Interfaces:**

- Produces:
  - `SEVERITIES` — `readonly ['low','medium','high','critical']`
  - `INCIDENT_STATUSES` — `readonly ['open','triaged','in_progress','resolved','cancelled']`
  - `type Severity`, `type IncidentStatus`
  - `DEFAULT_SLA_MINUTES: Record<Severity, number>`
  - `DEFAULT_AUTH_THRESHOLD_CENTS = 1000`
  - `slaDueAt(severity: Severity, now: Date, minutesBySeverity?: Partial<Record<Severity, number>>): Date`
  - `requiresAuthorisation(costCents: number, thresholdCents: number): boolean`
  - `generateIncidentReference(tenantId: string): Promise<string>`
  - `ALLOWED_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]>`
  - `canTransition(from: IncidentStatus, to: IncidentStatus): boolean`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/lib/incidents.test.ts`:

```ts
import { describe, it, expect } from '@jest/globals'
import {
  slaDueAt,
  requiresAuthorisation,
  canTransition,
  DEFAULT_SLA_MINUTES,
  DEFAULT_AUTH_THRESHOLD_CENTS,
} from './incidents.js'

const NOW = new Date('2026-09-15T12:00:00.000Z')

describe('slaDueAt', () => {
  it('derives a due time from severity', () => {
    expect(slaDueAt('critical', NOW).toISOString()).toBe('2026-09-15T13:00:00.000Z')
    expect(slaDueAt('high', NOW).toISOString()).toBe('2026-09-15T16:00:00.000Z')
  })

  it('lets a tenant override one severity without redefining the rest', () => {
    const due = slaDueAt('critical', NOW, { critical: 30 })
    expect(due.toISOString()).toBe('2026-09-15T12:30:00.000Z')
    // high is untouched by the override
    expect(slaDueAt('high', NOW, { critical: 30 }).toISOString()).toBe('2026-09-15T16:00:00.000Z')
  })

  it('has a duration for every severity', () => {
    for (const s of ['low', 'medium', 'high', 'critical'] as const) {
      expect(DEFAULT_SLA_MINUTES[s]).toBeGreaterThan(0)
    }
  })
})

describe('requiresAuthorisation', () => {
  it('needs a manager at or above the threshold', () => {
    expect(requiresAuthorisation(1000, 1000)).toBe(true)
    expect(requiresAuthorisation(1350, 1000)).toBe(true)
  })

  it('does not need one below the threshold', () => {
    expect(requiresAuthorisation(999, 1000)).toBe(false)
  })

  it('never needs one for a zero-cost report — friction stops people reporting', () => {
    expect(requiresAuthorisation(0, 1000)).toBe(false)
    expect(requiresAuthorisation(0, 0)).toBe(false)
  })

  it('defaults to a $10 threshold', () => {
    expect(DEFAULT_AUTH_THRESHOLD_CENTS).toBe(1000)
  })
})

describe('canTransition', () => {
  it('allows the ordinary path', () => {
    expect(canTransition('open', 'triaged')).toBe(true)
    expect(canTransition('triaged', 'in_progress')).toBe(true)
    expect(canTransition('in_progress', 'resolved')).toBe(true)
  })

  it('refuses to reopen a resolved incident', () => {
    expect(canTransition('resolved', 'open')).toBe(false)
  })

  it('allows cancelling from any live state', () => {
    expect(canTransition('open', 'cancelled')).toBe(true)
    expect(canTransition('in_progress', 'cancelled')).toBe(true)
  })

  it('refuses a no-op transition, so an event row is never written for nothing', () => {
    expect(canTransition('open', 'open')).toBe(false)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm test --workspace=@nuatis/api -- src/lib/incidents.test.ts
```

Expected: FAIL — `Cannot find module './incidents.js'`.

- [ ] **Step 3: Write the module**

Create `apps/api/src/lib/incidents.ts`:

```ts
import { getServiceClient } from './supabase.js'

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
export type Severity = (typeof SEVERITIES)[number]

export const INCIDENT_STATUSES = [
  'open',
  'triaged',
  'in_progress',
  'resolved',
  'cancelled',
] as const
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number]

/** Minutes from creation to the SLA deadline, by severity. */
export const DEFAULT_SLA_MINUTES: Record<Severity, number> = {
  critical: 60,
  high: 240,
  medium: 60 * 24,
  low: 60 * 24 * 3,
}

/**
 * $10. Above this, a comp needs a manager PIN.
 *
 * The threshold has a known weakness — a cashier who learns it is $10 can comp
 * $9.99 all shift. The mitigation is the per-staff comp total in the manager
 * report, not a lower number: set it low enough and every free coffee needs a
 * manager, which is how people stop reporting anything at all.
 */
export const DEFAULT_AUTH_THRESHOLD_CENTS = 1000

export function slaDueAt(
  severity: Severity,
  now: Date,
  minutesBySeverity: Partial<Record<Severity, number>> = {}
): Date {
  const minutes = minutesBySeverity[severity] ?? DEFAULT_SLA_MINUTES[severity]
  return new Date(now.getTime() + minutes * 60_000)
}

/**
 * Whether this cost needs a second person.
 *
 * Zero is always free: a logged complaint or a noted late order gave nothing
 * away, and prompting for a PIN there just teaches staff not to log them.
 */
export function requiresAuthorisation(costCents: number, thresholdCents: number): boolean {
  if (costCents <= 0) return false
  return costCents >= thresholdCents
}

/**
 * Explicit transition map, the same shape routes/orders.ts uses. A status
 * change is an API operation and the rule belongs where the transition is
 * validated, not in the UI.
 */
export const ALLOWED_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  open: ['triaged', 'in_progress', 'resolved', 'cancelled'],
  triaged: ['in_progress', 'resolved', 'cancelled'],
  in_progress: ['resolved', 'cancelled'],
  resolved: [],
  cancelled: [],
}

export function canTransition(from: IncidentStatus, to: IncidentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

/**
 * INC-#### per tenant. Mirrors generateOrderNumber's counter pattern; the
 * unique index on (tenant_id, reference) is the real guard against the
 * select-then-update race, which is acceptable at incident volumes.
 */
export async function generateIncidentReference(tenantId: string): Promise<string> {
  const supabase = getServiceClient()
  const { data } = await supabase
    .from('incidents')
    .select('reference')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(1)

  const rows = (data ?? []) as { reference: string }[]
  const last = rows[0]?.reference ?? 'INC-1000'
  const n = Number(last.replace('INC-', '')) || 1000
  return `INC-${n + 1}`
}
```

- [ ] **Step 4: Run the tests again**

```bash
npm test --workspace=@nuatis/api -- src/lib/incidents.test.ts
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/incidents.ts apps/api/src/lib/incidents.test.ts
git commit -m "feat(incidents): severity, SLA, threshold and transition rules"
```

---

### Task 4: Incident type seeding

**Files:**

- Create: `apps/api/src/lib/incident-types.ts`
- Create: `apps/api/src/lib/incident-types.test.ts`

**Interfaces:**

- Consumes: `Severity` from `lib/incidents.js`.
- Produces:
  - `SEEDED_TYPES: Record<string, IncidentTypeSeed[]>` — keyed by vertical, with a `default` fallback
  - `interface IncidentTypeSeed { key: string; label: string; default_severity: Severity; requires_cost: boolean }`
  - `seedIncidentTypes(tenantId: string, vertical: string | null): Promise<void>` — idempotent

> **Found during execution:** seeding on `vertical` alone is not enough — it is
> self-declared at signup and routinely wrong. The real test file mocks the
> Supabase client and covers the fallback, rather than being the pure-data tests
> this task originally specified. 12 tests, not 5.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/incident-types.test.ts`:

```ts
import { describe, it, expect } from '@jest/globals'
import { SEEDED_TYPES } from './incident-types.js'

describe('seeded incident types', () => {
  it('gives a restaurant the reasons a till actually needs', () => {
    const keys = SEEDED_TYPES['restaurant']!.map((t) => t.key)
    expect(keys).toEqual(
      expect.arrayContaining(['wrong_item', 'allergy', 'dropped', 'late', 'equipment'])
    )
  })

  it('has a default set for a vertical with no specific list', () => {
    expect(SEEDED_TYPES['default']!.length).toBeGreaterThan(0)
  })

  it('marks allergy critical — it is the one that ends up in a newspaper', () => {
    const allergy = SEEDED_TYPES['restaurant']!.find((t) => t.key === 'allergy')
    expect(allergy?.default_severity).toBe('critical')
  })

  it('marks wastage as always carrying a cost', () => {
    const dropped = SEEDED_TYPES['restaurant']!.find((t) => t.key === 'dropped')
    expect(dropped?.requires_cost).toBe(true)
  })

  it('uses keys that are stable identifiers, not labels', () => {
    for (const list of Object.values(SEEDED_TYPES)) {
      for (const t of list) {
        expect(t.key).toMatch(/^[a-z][a-z0-9_]*$/)
      }
    }
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npm test --workspace=@nuatis/api -- src/lib/incident-types.test.ts
```

Expected: FAIL — `Cannot find module './incident-types.js'`.

- [ ] **Step 3: Write the module**

Create `apps/api/src/lib/incident-types.ts`:

```ts
import { getServiceClient } from './supabase.js'
import type { Severity } from './incidents.js'

export interface IncidentTypeSeed {
  key: string
  label: string
  default_severity: Severity
  requires_cost: boolean
}

/**
 * Starting taxonomy per vertical, seeded once and then tenant-editable —
 * the same shape lib/custom-fields.ts uses for vertical_configs.
 * A hard-coded enum would mean a migration every time a merchant wants a
 * category, which is how a feature stops getting used.
 *
 * `key` is the stable identifier and what reports group by. Labels are
 * editable; keys are not, so renaming a category does not change last
 * month's numbers.
 */
export const SEEDED_TYPES: Record<string, IncidentTypeSeed[]> = {
  restaurant: [
    { key: 'wrong_item', label: 'Wrong item', default_severity: 'medium', requires_cost: true },
    {
      key: 'allergy',
      label: 'Allergy incident',
      default_severity: 'critical',
      requires_cost: false,
    },
    { key: 'dropped', label: 'Dropped / wastage', default_severity: 'low', requires_cost: true },
    { key: 'late', label: 'Late order', default_severity: 'medium', requires_cost: false },
    {
      key: 'equipment',
      label: 'Equipment failure',
      default_severity: 'high',
      requires_cost: false,
    },
    {
      key: 'complaint',
      label: 'Customer complaint',
      default_severity: 'medium',
      requires_cost: false,
    },
  ],
  default: [
    {
      key: 'service_failure',
      label: 'Service failure',
      default_severity: 'medium',
      requires_cost: false,
    },
    { key: 'damage', label: 'Damage', default_severity: 'high', requires_cost: true },
    { key: 'safety', label: 'Safety concern', default_severity: 'critical', requires_cost: false },
    {
      key: 'complaint',
      label: 'Customer complaint',
      default_severity: 'medium',
      requires_cost: false,
    },
    { key: 'other', label: 'Other', default_severity: 'low', requires_cost: false },
  ],
}

/**
 * Seed a tenant's types if it has none. Idempotent: re-running does nothing,
 * and it never overwrites a type a tenant has edited.
 */
export async function seedIncidentTypes(tenantId: string, vertical: string | null): Promise<void> {
  const supabase = getServiceClient()

  const { data: existing } = await supabase
    .from('incident_types')
    .select('id')
    .eq('tenant_id', tenantId)
    .limit(1)

  if ((existing ?? []).length > 0) return

  const seeds = await chooseSeeds(supabase, tenantId, vertical)
  await supabase
    .from('incident_types')
    .insert(seeds.map((s, i) => ({ tenant_id: tenantId, ...s, sort_order: i })))
}

/**
 * Which starting list this tenant gets.
 *
 * `vertical` is a self-declared signup field and it is routinely wrong — the
 * demo tenant is `sales_crm` with eighteen menu items and a burger register.
 * Handing a kitchen "Service failure / Damage / Safety concern" is a bad enough
 * first run that most people will never edit it, they will just stop using the
 * feature.
 *
 * So when the vertical has no list of its own, fall back to evidence: a tenant
 * with menu items has a kitchen, because menu_items carries kitchen_station.
 * An explicit vertical still wins.
 */
async function chooseSeeds(
  supabase: ReturnType<typeof getServiceClient>,
  tenantId: string,
  vertical: string | null
): Promise<IncidentTypeSeed[]> {
  if (vertical && SEEDED_TYPES[vertical]) return SEEDED_TYPES[vertical]

  const { data } = await supabase.from('menu_items').select('id').eq('tenant_id', tenantId).limit(1)

  if ((data ?? []).length > 0) return SEEDED_TYPES['restaurant']!
  return SEEDED_TYPES['default']!
}
```

- [ ] **Step 4: Run the test again**

```bash
npm test --workspace=@nuatis/api -- src/lib/incident-types.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/incident-types.ts apps/api/src/lib/incident-types.test.ts
git commit -m "feat(incidents): seeded per-vertical incident types"
```

---

### Task 5: POS report route — `/api/pos/incidents`

**Files:**

- Create: `apps/api/src/routes/pos/incidents.ts`
- Create: `apps/api/src/routes/pos/incidents.integration.test.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**

- Consumes: `requirePos` from `routes/pos/menu.js`; `requiresAuthorisation`, `slaDueAt`, `generateIncidentReference` from `lib/incidents.js`; `verifyPin` from `lib/pos-pin.js`.
- **Note:** `ownsRow` is _private_ to `routes/pos/menu.ts` — it is declared `async function ownsRow`, not exported. This task defines its own copy rather than exporting the original, because widening a security helper's visibility is a change that belongs in its own commit with its own review. If you would rather share it, export it from `menu.ts` first as a separate commit.
- Produces: `POST /api/pos/incidents`, `GET /api/pos/incidents/types`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/routes/pos/incidents.integration.test.ts`. Model the harness on `apps/api/src/routes/pos/tickets.integration.test.ts` — same `jest.unstable_mockModule('@supabase/supabase-js', …)`, `createStore`, `createMockSupabase`, `seedEntitledTenant`, `mintTestToken`.

```ts
import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from '../__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../__test-support__/supabase-mock.js'
import { seedEntitledTenant } from '../__test-support__/tenant-fixture.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000inc0001'
const OTHER_TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000inc0002'
const LOCATION_ID = 'bbbbbbbb-0000-0000-0000-00000loc0001'
const ORDER_ID = 'cccccccc-0000-0000-0000-00000ord0001'
const CASHIER_ID = 'dddddddd-0000-0000-0000-0000staff001'
const MANAGER_ID = 'dddddddd-0000-0000-0000-0000staff002'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken(
    { sub: 'user-inc-001', tenantId: TENANT_ID, role: 'owner', vertical: 'restaurant' },
    { secret: SECRET }
  )
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { hashPin } = await import('../../lib/pos-pin.js')
const { default: incidentsRouter } = await import('./incidents.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/pos/incidents', incidentsRouter)
  return app
}

function post(body: unknown, token: string) {
  return request(makeApp())
    .post('/api/pos/incidents')
    .set('Authorization', `Bearer ${token}`)
    .send(body as object)
}

beforeEach(async () => {
  store = createStore()
  seedEntitledTenant(store, TENANT_ID, { modules: { pos: true }, vertical: 'restaurant' })
  store.tables['locations'] = [{ id: LOCATION_ID, tenant_id: TENANT_ID, name: 'Demo Location' }]
  store.tables['orders'] = [
    { id: ORDER_ID, tenant_id: TENANT_ID, location_id: LOCATION_ID, order_number: 'ORD-1001' },
  ]
  store.tables['staff_members'] = [
    {
      id: CASHIER_ID,
      tenant_id: TENANT_ID,
      name: 'Alex Brown',
      role: 'staff',
      pos_pin_hash: await hashPin('1234'),
    },
    {
      id: MANAGER_ID,
      tenant_id: TENANT_ID,
      name: 'Carlos Mendez',
      role: 'manager',
      pos_pin_hash: await hashPin('4321'),
    },
  ]
  store.tables['incident_types'] = [
    {
      id: 'ty-1',
      tenant_id: TENANT_ID,
      key: 'wrong_item',
      label: 'Wrong item',
      default_severity: 'medium',
      requires_cost: true,
      deleted_at: null,
    },
  ]
  store.tables['incidents'] = []
  store.tables['incident_events'] = []
})

describe('POST /api/pos/incidents', () => {
  it('records a small comp without a manager PIN', async () => {
    const res = await post(
      {
        type_key: 'wrong_item',
        title: 'Wrong side',
        cost_cents: 450,
        order_id: ORDER_ID,
        reported_by_staff_id: CASHIER_ID,
      },
      await makeToken()
    )
    expect(res.status).toBe(201)
    expect(store.tables['incidents']![0]!['cost_cents']).toBe(450)
    expect(store.tables['incidents']![0]!['authorised_by_staff_id']).toBeNull()
  })

  it('refuses a comp at or above the threshold with no manager PIN', async () => {
    const res = await post(
      {
        type_key: 'wrong_item',
        title: 'Whole order',
        cost_cents: 1350,
        order_id: ORDER_ID,
        reported_by_staff_id: CASHIER_ID,
      },
      await makeToken()
    )
    expect(res.status).toBe(403)
    expect(store.tables['incidents']).toHaveLength(0)
  })

  it('accepts it with a manager PIN and records who authorised', async () => {
    const res = await post(
      {
        type_key: 'wrong_item',
        title: 'Whole order',
        cost_cents: 1350,
        order_id: ORDER_ID,
        reported_by_staff_id: CASHIER_ID,
        manager_pin: '4321',
      },
      await makeToken()
    )
    expect(res.status).toBe(201)
    expect(store.tables['incidents']![0]!['authorised_by_staff_id']).toBe(MANAGER_ID)
  })

  it('refuses a non-manager PIN above the threshold', async () => {
    const res = await post(
      {
        type_key: 'wrong_item',
        title: 'Whole order',
        cost_cents: 1350,
        order_id: ORDER_ID,
        reported_by_staff_id: CASHIER_ID,
        manager_pin: '1234',
      },
      await makeToken()
    )
    expect(res.status).toBe(403)
    expect(store.tables['incidents']).toHaveLength(0)
  })

  it('never prompts for a zero-cost report', async () => {
    // 'complaint' does NOT require a cost — unlike 'wrong_item' above.
    store.tables['incident_types']!.push({
      id: 'ty-2',
      tenant_id: TENANT_ID,
      key: 'complaint',
      label: 'Customer complaint',
      default_severity: 'medium',
      requires_cost: false,
      deleted_at: null,
    })
    const res = await post(
      {
        type_key: 'complaint',
        title: 'Customer complained',
        cost_cents: 0,
        reported_by_staff_id: CASHIER_ID,
      },
      await makeToken()
    )
    expect(res.status).toBe(201)
  })

  it('rejects an order belonging to another tenant', async () => {
    store.tables['orders']!.push({
      id: 'foreign-order',
      tenant_id: OTHER_TENANT_ID,
      location_id: LOCATION_ID,
    })
    const res = await post(
      {
        type_key: 'wrong_item',
        title: 'x',
        cost_cents: 0,
        order_id: 'foreign-order',
        reported_by_staff_id: CASHIER_ID,
      },
      await makeToken()
    )
    expect(res.status).toBe(400)
    expect(store.tables['incidents']).toHaveLength(0)
  })

  it('rejects a type_key the tenant does not have', async () => {
    const res = await post(
      { type_key: 'not_a_type', title: 'x', cost_cents: 0, reported_by_staff_id: CASHIER_ID },
      await makeToken()
    )
    expect(res.status).toBe(400)
  })

  it('enforces requires_cost — wastage with no amount understates food cost', async () => {
    const res = await post(
      {
        type_key: 'wrong_item',
        title: 'Dropped a plate',
        cost_cents: 0,
        reported_by_staff_id: CASHIER_ID,
      },
      await makeToken()
    )
    // The seeded 'wrong_item' type has requires_cost: true.
    expect(res.status).toBe(400)
  })

  it('rejects a negative cost', async () => {
    const res = await post(
      { type_key: 'wrong_item', title: 'x', cost_cents: -100, reported_by_staff_id: CASHIER_ID },
      await makeToken()
    )
    expect(res.status).toBe(400)
  })

  it('writes an opening event so the timeline starts at creation', async () => {
    await post(
      { type_key: 'wrong_item', title: 'x', cost_cents: 0, reported_by_staff_id: CASHIER_ID },
      await makeToken()
    )
    expect(store.tables['incident_events']).toHaveLength(1)
    expect(store.tables['incident_events']![0]!['kind']).toBe('reported')
  })

  it('stamps an sla_due_at from the type default severity', async () => {
    await post(
      { type_key: 'wrong_item', title: 'x', cost_cents: 0, reported_by_staff_id: CASHIER_ID },
      await makeToken()
    )
    expect(store.tables['incidents']![0]!['sla_due_at']).toBeTruthy()
  })

  it('refuses a tenant without the POS module', async () => {
    seedEntitledTenant(store, TENANT_ID, { modules: { pos: false }, vertical: 'restaurant' })
    const res = await post(
      { type_key: 'wrong_item', title: 'x', cost_cents: 0, reported_by_staff_id: CASHIER_ID },
      await makeToken()
    )
    expect(res.status).toBe(403)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm test --workspace=@nuatis/api -- src/routes/pos/incidents.integration.test.ts
```

Expected: FAIL — `Cannot find module './incidents.js'`.

- [ ] **Step 3: Write the route**

Create `apps/api/src/routes/pos/incidents.ts`:

```ts
import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../../lib/auth.js'
import { verifyPin } from '../../lib/pos-pin.js'
import {
  requiresAuthorisation,
  slaDueAt,
  generateIncidentReference,
  DEFAULT_AUTH_THRESHOLD_CENTS,
  SEVERITIES,
  type Severity,
} from '../../lib/incidents.js'
import { seedIncidentTypes } from '../../lib/incident-types.js'
import { requirePos } from './menu.js'

const router = Router()

/**
 * Report an incident from the register or the kitchen display.
 *
 * Deliberately gated on `pos`, not on `incidents`: logging a comp is part of
 * running a till, and a pos_only merchant must be able to do it. The tracker —
 * queue, assignment, SLA views — is what the incidents module sells.
 *
 * This route lives under /api/pos/* because a register token carries
 * portalScope 'pos', which requireAuth confines to that prefix. Moving it to
 * /api/incidents would make it unreachable from the register.
 */
router.post('/', requireAuth, requirePos, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const body = req.body as Record<string, unknown>
  const supabase = getServiceClient()

  const typeKey = typeof body['type_key'] === 'string' ? body['type_key'] : ''
  const title = typeof body['title'] === 'string' ? body['title'].trim() : ''
  const costCents = typeof body['cost_cents'] === 'number' ? body['cost_cents'] : 0

  if (!typeKey || !title) {
    res.status(400).json({ error: 'type_key and title are required' })
    return
  }
  if (!Number.isInteger(costCents) || costCents < 0) {
    res.status(400).json({ error: 'cost_cents must be a non-negative integer' })
    return
  }

  // The type must be the tenant's own. Service-role bypasses RLS, so this is
  // the boundary, not the policy.
  const { data: type } = await supabase
    .from('incident_types')
    .select('key, default_severity, requires_cost')
    .eq('tenant_id', authed.tenantId)
    .eq('key', typeKey)
    .is('deleted_at', null)
    .maybeSingle<{ key: string; default_severity: Severity; requires_cost: boolean }>()

  if (!type) {
    res.status(400).json({ error: `Unknown incident type: ${typeKey}` })
    return
  }

  // A type flagged requires_cost must carry one. Wastage with a zero cost is
  // almost always someone tapping through the keypad, and it silently
  // understates the month's food cost.
  if (type.requires_cost && costCents <= 0) {
    res.status(400).json({ error: 'This incident type needs an amount' })
    return
  }

  // Every foreign key from the body is proven tenant-owned before it is stored.
  const orderId = typeof body['order_id'] === 'string' ? body['order_id'] : null
  if (orderId && !(await ownsRow(supabase, 'orders', orderId, authed.tenantId))) {
    res.status(400).json({ error: 'Order not found' })
    return
  }
  const ticketId = typeof body['kitchen_ticket_id'] === 'string' ? body['kitchen_ticket_id'] : null
  if (ticketId && !(await ownsRow(supabase, 'kitchen_tickets', ticketId, authed.tenantId))) {
    res.status(400).json({ error: 'Ticket not found' })
    return
  }
  const reporterId =
    typeof body['reported_by_staff_id'] === 'string' ? body['reported_by_staff_id'] : null
  if (reporterId && !(await ownsRow(supabase, 'staff_members', reporterId, authed.tenantId))) {
    res.status(400).json({ error: 'Staff member not found' })
    return
  }

  // Authorisation. The client also checks the threshold so it knows whether to
  // show the PIN pad, but THIS is the check that matters — a register is a
  // device in a public room and its request body is not trustworthy.
  const threshold = await authThresholdFor(authed.tenantId)
  let authorisedBy: string | null = null

  if (requiresAuthorisation(costCents, threshold)) {
    const pin = typeof body['manager_pin'] === 'string' ? body['manager_pin'] : ''
    if (!pin) {
      res.status(403).json({ error: 'A manager PIN is required for this amount' })
      return
    }
    authorisedBy = await resolveManager(supabase, authed.tenantId, pin)
    if (!authorisedBy) {
      // Uniform message: never reveal whether the PIN was wrong or the staff
      // member simply is not a manager.
      res.status(403).json({ error: 'A manager PIN is required for this amount' })
      return
    }
  }

  const severity = (SEVERITIES as readonly string[]).includes(String(body['severity']))
    ? (body['severity'] as Severity)
    : type.default_severity

  const now = new Date()
  const reference = await generateIncidentReference(authed.tenantId)

  const { data: incident, error } = await supabase
    .from('incidents')
    .insert({
      tenant_id: authed.tenantId,
      reference,
      type_key: type.key,
      severity,
      status: 'open',
      title,
      description: typeof body['description'] === 'string' ? body['description'] : null,
      cost_cents: costCents,
      location_id: typeof body['location_id'] === 'string' ? body['location_id'] : null,
      order_id: orderId,
      kitchen_ticket_id: ticketId,
      reported_by_staff_id: reporterId,
      authorised_by_staff_id: authorisedBy,
      sla_due_at: slaDueAt(severity, now).toISOString(),
    })
    .select('*')
    .single<{ id: string }>()

  if (error || !incident) {
    res.status(500).json({ error: error?.message ?? 'Failed to record incident' })
    return
  }

  await supabase.from('incident_events').insert({
    tenant_id: authed.tenantId,
    incident_id: incident.id,
    actor_kind: 'staff',
    actor_id: reporterId,
    kind: 'reported',
    detail: { cost_cents: costCents, authorised_by: authorisedBy },
  })

  res.status(201).json({ incident })
})

// ── GET /api/pos/incidents/types ────────────────────────────────────────────
router.get(
  '/types',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    // Seed on first read. A tenant with no types cannot report anything, and
    // seeding at signup would only help tenants created after this ships.
    // seedIncidentTypes is idempotent and returns immediately once types exist.
    const { data: tenant } = await supabase
      .from('tenants')
      .select('vertical')
      .eq('id', authed.tenantId)
      .maybeSingle<{ vertical: string | null }>()
    await seedIncidentTypes(authed.tenantId, tenant?.vertical ?? null)

    const { data } = await supabase
      .from('incident_types')
      .select('key, label, default_severity, requires_cost, sort_order')
      .eq('tenant_id', authed.tenantId)
      .is('deleted_at', null)

    const types = (data ?? []) as { sort_order: number }[]
    res.json({ types: [...types].sort((a, b) => a.sort_order - b.sort_order) })
  }
)

/** Per-tenant threshold, falling back to $10. */
async function authThresholdFor(tenantId: string): Promise<number> {
  const supabase = getServiceClient()
  const { data } = await supabase
    .from('tenants')
    .select('incident_auth_threshold_cents')
    .eq('id', tenantId)
    .maybeSingle<{ incident_auth_threshold_cents: number | null }>()
  const v = data?.incident_auth_threshold_cents
  return typeof v === 'number' && v >= 0 ? v : DEFAULT_AUTH_THRESHOLD_CENTS
}

/** The staff id of a manager whose PIN matches, or null. */
async function resolveManager(
  supabase: ReturnType<typeof getServiceClient>,
  tenantId: string,
  pin: string
): Promise<string | null> {
  const { data } = await supabase
    .from('staff_members')
    .select('id, role, pos_pin_hash')
    .eq('tenant_id', tenantId)

  const rows = (data ?? []) as { id: string; role: string; pos_pin_hash: string | null }[]
  for (const row of rows) {
    if (!row.pos_pin_hash) continue
    if (row.role !== 'manager' && row.role !== 'owner') continue
    if (await verifyPin(pin, row.pos_pin_hash)) return row.id
  }
  return null
}

/**
 * Confirm a row belongs to the caller's tenant. Same guard as
 * routes/pos/menu.ts — the service-role client bypasses RLS, so this is the
 * live boundary for every foreign key that arrives in a request body.
 */
async function ownsRow(
  supabase: ReturnType<typeof getServiceClient>,
  table: string,
  id: string,
  tenantId: string
): Promise<boolean> {
  const { data } = await supabase
    .from(table)
    .select('id')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle<{ id: string }>()
  return !!data
}

export default router
```

- [ ] **Step 4: Add the threshold column**

Append to `supabase/migrations/0199_incidents.sql`:

```sql
-- Per-tenant manager-authorisation threshold, in cents. NULL means the
-- $10 default in lib/incidents.ts.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS incident_auth_threshold_cents integer;
```

Re-apply the migration; it is idempotent, so this is safe.

- [ ] **Step 5: Mount the router**

In `apps/api/src/index.ts`, add the import next to the other POS routers:

```ts
import posIncidentsRouter from './routes/pos/incidents.js'
```

and mount it next to the others:

```ts
app.use('/api/pos/incidents', posIncidentsRouter)
```

- [ ] **Step 6: Run the tests**

```bash
npm test --workspace=@nuatis/api -- src/routes/pos/incidents.integration.test.ts
```

Expected: PASS, 12 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/pos/incidents.ts apps/api/src/routes/pos/incidents.integration.test.ts apps/api/src/index.ts supabase/migrations/0199_incidents.sql
git commit -m "feat(incidents): POS report route with manager-PIN authorisation"
```

---

### Task 6: Dashboard route — `/api/incidents`

**Files:**

- Create: `apps/api/src/routes/incidents.ts`
- Create: `apps/api/src/routes/incidents.integration.test.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**

- Consumes: `requireIncidents` from `lib/incident-module.js`; `canTransition`, `INCIDENT_STATUSES` from `lib/incidents.js`.
- Produces: `GET /api/incidents`, `GET /api/incidents/:id`, `PATCH /api/incidents/:id`, `POST /api/incidents`.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/routes/incidents.integration.test.ts`. The harness is the same as Task 5's — `jest.unstable_mockModule('@supabase/supabase-js', …)`, `createStore`, `createMockSupabase`, `seedEntitledTenant`, `mintTestToken` — but seed `modules: { incidents: true }` and mount at `/api/incidents`.

```ts
import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { mintTestToken } from './__test-support__/jwt.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from './__test-support__/supabase-mock.js'
import { seedEntitledTenant } from './__test-support__/tenant-fixture.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000dsh0001'
const OTHER_TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000dsh0002'
const USER_ID = 'eeeeeeee-0000-0000-0000-00000user001'
const OTHER_USER_ID = 'eeeeeeee-0000-0000-0000-00000user002'
const INCIDENT_ID = 'ffffffff-0000-0000-0000-00000inc0001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken(
    { sub: USER_ID, appUserId: USER_ID, tenantId: TENANT_ID, role: 'owner' },
    { secret: SECRET }
  )
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: incidentsRouter } = await import('./incidents.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/incidents', incidentsRouter)
  return app
}

function incidentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: INCIDENT_ID,
    tenant_id: TENANT_ID,
    reference: 'INC-1001',
    type_key: 'wrong_item',
    severity: 'medium',
    status: 'open',
    title: 'Wrong side',
    cost_cents: 450,
    assigned_to_user_id: null,
    resolved_at: null,
    root_cause: null,
    created_at: '2026-09-15T10:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  store = createStore()
  seedEntitledTenant(store, TENANT_ID, { modules: { incidents: true } })
  store.tables['users'] = [
    { id: USER_ID, tenant_id: TENANT_ID, name: 'Dana' },
    { id: OTHER_USER_ID, tenant_id: OTHER_TENANT_ID, name: 'Someone else' },
  ]
  store.tables['incidents'] = [incidentRow()]
  store.tables['incident_events'] = []
})

describe('GET /api/incidents', () => {
  it("lists only the caller tenant's incidents", async () => {
    store.tables['incidents']!.push(
      incidentRow({ id: 'foreign', tenant_id: OTHER_TENANT_ID, reference: 'INC-9999' })
    )

    const res = await request(makeApp())
      .get('/api/incidents')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].reference).toBe('INC-1001')
  })

  it('filters by status', async () => {
    store.tables['incidents']!.push(
      incidentRow({ id: 'done', status: 'resolved', reference: 'INC-1002' })
    )

    const res = await request(makeApp())
      .get('/api/incidents?status=resolved')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].reference).toBe('INC-1002')
  })

  it('filters by severity', async () => {
    store.tables['incidents']!.push(
      incidentRow({ id: 'crit', severity: 'critical', reference: 'INC-1003' })
    )

    const res = await request(makeApp())
      .get('/api/incidents?severity=critical')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0].reference).toBe('INC-1003')
  })

  it('refuses a tenant without the incidents module', async () => {
    seedEntitledTenant(store, TENANT_ID, { modules: { incidents: false } })

    const res = await request(makeApp())
      .get('/api/incidents')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(403)
  })
})

describe('PATCH /api/incidents/:id', () => {
  function patch(body: unknown, token: string) {
    return request(makeApp())
      .patch(`/api/incidents/${INCIDENT_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body as object)
  }

  it('assigns an incident and writes an event', async () => {
    const res = await patch({ assigned_to_user_id: USER_ID }, await makeToken())

    expect(res.status).toBe(200)
    expect(store.tables['incidents']![0]!['assigned_to_user_id']).toBe(USER_ID)
    expect(store.tables['incident_events']).toHaveLength(1)
    expect(store.tables['incident_events']![0]!['kind']).toBe('assigned')
  })

  it('rejects an assignee from another tenant', async () => {
    const res = await patch({ assigned_to_user_id: OTHER_USER_ID }, await makeToken())

    expect(res.status).toBe(400)
    expect(store.tables['incidents']![0]!['assigned_to_user_id']).toBeNull()
  })

  it('resolves with a root cause', async () => {
    const res = await patch(
      { status: 'resolved', root_cause: 'Kitchen misread the ticket' },
      await makeToken()
    )

    expect(res.status).toBe(200)
    expect(store.tables['incidents']![0]!['status']).toBe('resolved')
    expect(store.tables['incidents']![0]!['resolved_at']).toBeTruthy()
    expect(store.tables['incidents']![0]!['root_cause']).toBe('Kitchen misread the ticket')
  })

  it('refuses to reopen a resolved incident', async () => {
    store.tables['incidents'] = [incidentRow({ status: 'resolved' })]

    const res = await patch({ status: 'open' }, await makeToken())

    expect(res.status).toBe(400)
    expect(store.tables['incidents']![0]!['status']).toBe('resolved')
  })

  it('refuses a no-op transition so no empty event row is written', async () => {
    const res = await patch({ status: 'open' }, await makeToken())

    expect(res.status).toBe(400)
    expect(store.tables['incident_events']).toHaveLength(0)
  })

  it("404s for another tenant's incident and writes nothing", async () => {
    store.tables['incidents'] = [incidentRow({ tenant_id: OTHER_TENANT_ID })]

    const res = await patch({ status: 'triaged' }, await makeToken())

    expect(res.status).toBe(404)
    expect(store.tables['incidents']![0]!['status']).toBe('open')
    expect(store.tables['incident_events']).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm test --workspace=@nuatis/api -- src/routes/incidents.integration.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the route**

Create `apps/api/src/routes/incidents.ts`:

```ts
import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../lib/auth.js'
import { requireIncidents } from '../lib/incident-module.js'
import {
  canTransition,
  generateIncidentReference,
  slaDueAt,
  INCIDENT_STATUSES,
  SEVERITIES,
  type IncidentStatus,
  type Severity,
} from '../lib/incidents.js'

const router = Router()

interface IncidentRow {
  id: string
  status: IncidentStatus
  assigned_to_user_id: string | null
}

// ── GET /api/incidents ──────────────────────────────────────────────────────
router.get(
  '/',
  requireAuth,
  requireIncidents,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    const page = Math.max(1, Number(req.query['page']) || 1)
    const limit = Math.min(100, Math.max(1, Number(req.query['limit']) || 50))
    const from = (page - 1) * limit

    let query = supabase
      .from('incidents')
      .select('*', { count: 'exact' })
      .eq('tenant_id', authed.tenantId)

    const status = req.query['status']
    if (typeof status === 'string' && (INCIDENT_STATUSES as readonly string[]).includes(status)) {
      query = query.eq('status', status)
    }
    const severity = req.query['severity']
    if (typeof severity === 'string' && (SEVERITIES as readonly string[]).includes(severity)) {
      query = query.eq('severity', severity)
    }
    const typeKey = req.query['type_key']
    if (typeof typeKey === 'string' && typeKey !== '') query = query.eq('type_key', typeKey)
    const assignee = req.query['assigned_to_user_id']
    if (typeof assignee === 'string' && assignee !== '') {
      query = query.eq('assigned_to_user_id', assignee)
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, from + limit - 1)

    if (error) {
      res.status(500).json({ error: error.message })
      return
    }
    res.json({ data: data ?? [], total: count ?? 0, page })
  }
)

// ── GET /api/incidents/:id ──────────────────────────────────────────────────
router.get(
  '/:id',
  requireAuth,
  requireIncidents,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()

    const { data: incident } = await supabase
      .from('incidents')
      .select('*')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .maybeSingle()

    if (!incident) {
      res.status(404).json({ error: 'Incident not found' })
      return
    }

    const { data: events } = await supabase
      .from('incident_events')
      .select('*')
      .eq('tenant_id', authed.tenantId)
      .eq('incident_id', req.params['id'])

    const timeline = ((events ?? []) as { at: string }[]).sort((a, b) => a.at.localeCompare(b.at))
    res.json({ incident, events: timeline })
  }
)

// ── POST /api/incidents ─────────────────────────────────────────────────────
// No manager-PIN path here. The threshold exists because the register is a
// shared device in a public room; a dashboard user is already authenticated as
// a named person, and their user id lands on the row.
router.post(
  '/',
  requireAuth,
  requireIncidents,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const body = req.body as Record<string, unknown>

    const typeKey = typeof body['type_key'] === 'string' ? body['type_key'] : ''
    const title = typeof body['title'] === 'string' ? body['title'].trim() : ''
    const costCents = typeof body['cost_cents'] === 'number' ? body['cost_cents'] : 0

    if (!typeKey || !title) {
      res.status(400).json({ error: 'type_key and title are required' })
      return
    }
    if (!Number.isInteger(costCents) || costCents < 0) {
      res.status(400).json({ error: 'cost_cents must be a non-negative integer' })
      return
    }

    const { data: type } = await supabase
      .from('incident_types')
      .select('key, default_severity, requires_cost')
      .eq('tenant_id', authed.tenantId)
      .eq('key', typeKey)
      .is('deleted_at', null)
      .maybeSingle<{ key: string; default_severity: Severity; requires_cost: boolean }>()

    if (!type) {
      res.status(400).json({ error: `Unknown incident type: ${typeKey}` })
      return
    }
    if (type.requires_cost && costCents <= 0) {
      res.status(400).json({ error: 'This incident type needs an amount' })
      return
    }

    const severity = (SEVERITIES as readonly string[]).includes(String(body['severity']))
      ? (body['severity'] as Severity)
      : type.default_severity

    const now = new Date()
    const reference = await generateIncidentReference(authed.tenantId)

    const { data: incident, error } = await supabase
      .from('incidents')
      .insert({
        tenant_id: authed.tenantId,
        reference,
        type_key: type.key,
        severity,
        status: 'open',
        title,
        description: typeof body['description'] === 'string' ? body['description'] : null,
        cost_cents: costCents,
        reported_by_user_id: authed.appUserId,
        sla_due_at: slaDueAt(severity, now).toISOString(),
      })
      .select('*')
      .single<{ id: string }>()

    if (error || !incident) {
      res.status(500).json({ error: error?.message ?? 'Failed to create incident' })
      return
    }

    await supabase.from('incident_events').insert({
      tenant_id: authed.tenantId,
      incident_id: incident.id,
      actor_kind: 'user',
      actor_id: authed.appUserId,
      kind: 'reported',
      detail: { cost_cents: costCents },
    })

    res.status(201).json({ incident })
  }
)

// ── PATCH /api/incidents/:id ────────────────────────────────────────────────
router.patch(
  '/:id',
  requireAuth,
  requireIncidents,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const body = req.body as Record<string, unknown>

    const { data: current } = await supabase
      .from('incidents')
      .select('id, status, assigned_to_user_id')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .maybeSingle<IncidentRow>()

    if (!current) {
      res.status(404).json({ error: 'Incident not found' })
      return
    }

    const patch: Record<string, unknown> = {}
    const events: { kind: string; detail: Record<string, unknown> }[] = []

    // Assignment. The assignee must belong to this tenant — service-role
    // bypasses RLS, so this check is the boundary.
    if (typeof body['assigned_to_user_id'] === 'string') {
      const assignee = body['assigned_to_user_id']
      const { data: user } = await supabase
        .from('users')
        .select('id')
        .eq('id', assignee)
        .eq('tenant_id', authed.tenantId)
        .maybeSingle<{ id: string }>()

      if (!user) {
        res.status(400).json({ error: 'Assignee not found' })
        return
      }
      patch['assigned_to_user_id'] = assignee
      events.push({ kind: 'assigned', detail: { assigned_to_user_id: assignee } })
    }

    // Status. The transition map is the rule, and it refuses a no-op so an event
    // row is never written for a change that did not happen.
    if (typeof body['status'] === 'string') {
      const next = body['status'] as IncidentStatus
      if (!(INCIDENT_STATUSES as readonly string[]).includes(next)) {
        res.status(400).json({ error: `status must be one of: ${INCIDENT_STATUSES.join(', ')}` })
        return
      }
      if (!canTransition(current.status, next)) {
        res.status(400).json({ error: `Cannot move an incident from ${current.status} to ${next}` })
        return
      }
      patch['status'] = next
      if (next === 'resolved') patch['resolved_at'] = new Date().toISOString()
      events.push({ kind: 'status_changed', detail: { from: current.status, to: next } })
    }

    if (typeof body['root_cause'] === 'string') patch['root_cause'] = body['root_cause']
    if (typeof body['resolution_notes'] === 'string') {
      patch['resolution_notes'] = body['resolution_notes']
    }

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: 'Nothing to update' })
      return
    }

    patch['updated_at'] = new Date().toISOString()

    const { data: updated, error } = await supabase
      .from('incidents')
      .update(patch)
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .select('*')
      .single()

    if (error || !updated) {
      res.status(500).json({ error: error?.message ?? 'Failed to update incident' })
      return
    }

    for (const e of events) {
      await supabase.from('incident_events').insert({
        tenant_id: authed.tenantId,
        incident_id: current.id,
        actor_kind: 'user',
        actor_id: authed.appUserId,
        kind: e.kind,
        detail: e.detail,
      })
    }

    res.json({ incident: updated })
  }
)

export default router
```

- [ ] **Step 4: Mount the router**

In `apps/api/src/index.ts`:

```ts
import incidentsRouter from './routes/incidents.js'
```

```ts
app.use('/api/incidents', incidentsRouter)
```

- [ ] **Step 5: Run the tests**

```bash
npm test --workspace=@nuatis/api -- src/routes/incidents.integration.test.ts
```

Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/incidents.ts apps/api/src/routes/incidents.integration.test.ts apps/api/src/index.ts
git commit -m "feat(incidents): dashboard queue, triage and resolution routes"
```

---

### Task 7: Reporting route — cost, per-staff comps, recurrence

**Files:**

- Create: `apps/api/src/routes/incidents-reports.ts`
- Create: `apps/api/src/routes/incidents-reports.integration.test.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**

- Produces: `GET /api/incidents/reports/summary?from=&to=` returning
  `{ byType: { type_key, count, cost_cents }[], byStaff: { staff_id, staff_name, count, cost_cents }[], recurring: { type_key, location_id, count }[] }`

- [ ] **Step 1: Write the failing tests**

The per-staff report is the one that matters — it is what makes the authorisation threshold safe, so it gets the sharpest test:

```ts
it('totals comps per staff member, which is what makes the threshold safe', async () => {
  // Seed six $9.99 incidents from one cashier, all below the $10 threshold and
  // each individually unremarkable.
  store.tables['incidents'] = Array.from({ length: 6 }, (_, i) => ({
    id: `inc-${i}`,
    tenant_id: TENANT_ID,
    type_key: 'wrong_item',
    cost_cents: 999,
    reported_by_staff_id: CASHIER_ID,
    status: 'open',
    created_at: '2026-09-15T10:00:00.000Z',
  }))

  const res = await request(makeApp())
    .get('/api/incidents/reports/summary')
    .set('Authorization', `Bearer ${await makeToken()}`)

  expect(res.status).toBe(200)
  const alex = res.body.byStaff.find((s: { staff_id: string }) => s.staff_id === CASHIER_ID)
  // Individually invisible, collectively $59.94.
  expect(alex.count).toBe(6)
  expect(alex.cost_cents).toBe(5994)
})

it('groups by type_key, not label, so renaming a category does not change last month', async () => {
  // Seed two incidents of the same key, then rename the type's label.
  // Expect one group of two.
})

it('counts a repeat as recurrence when the same type hits the same location', async () => {
  // Four 'equipment' incidents at one location → recurring entry with count 4.
})

it('excludes another tenant from every section', async () => {
  // Seed a foreign incident; expect byType, byStaff and recurring all empty.
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm test --workspace=@nuatis/api -- src/routes/incidents-reports.integration.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the route**

Create `apps/api/src/routes/incidents-reports.ts`. One handler, `requireAuth, requireIncidents`, which:

1. loads the tenant's incidents in the window (default: the current calendar month) with `.eq('tenant_id', authed.tenantId)`;
2. aggregates in TypeScript, not SQL — the mock store used by the tests does not implement `GROUP BY`, and these volumes are small;
3. groups `byType` on `type_key`, joining labels from `incident_types` for display only;
4. groups `byStaff` on `reported_by_staff_id`, joining `staff_members.name`;
5. `recurring` groups on `type_key` + `location_id` and keeps groups with `count >= 3`.

Sum costs with plain integer addition. Never `parseFloat`.

- [ ] **Step 4: Mount it before the `/:id` route**

In `apps/api/src/index.ts`:

```ts
import incidentsReportsRouter from './routes/incidents-reports.js'
```

```ts
// Mounted BEFORE /api/incidents so 'reports' is not swallowed by /:id.
app.use('/api/incidents/reports', incidentsReportsRouter)
app.use('/api/incidents', incidentsRouter)
```

- [ ] **Step 5: Run the tests**

```bash
npm test --workspace=@nuatis/api -- src/routes/incidents-reports.integration.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/incidents-reports.ts apps/api/src/routes/incidents-reports.integration.test.ts apps/api/src/index.ts
git commit -m "feat(incidents): reporting — cost by type, comps per staff, recurrence"
```

---

### Task 8: Register report dialog

**Files:**

- Create: `apps/pos/src/components/ReportIncidentDialog.tsx`
- Create: `apps/pos/src/lib/report-incident.ts`
- Create: `apps/pos/src/lib/report-incident.test.ts`
- Modify: `apps/pos/src/app/page.tsx`

**Interfaces:**

- Produces:
  - `needsManagerPin(costCents: number, thresholdCents: number): boolean`
  - `toIncidentPayload(input: IncidentInput): Record<string, unknown>`
  - `reportIncident(input: IncidentInput, fetchImpl?: typeof fetch): Promise<{ id: string }>`

- [ ] **Step 1: Write the failing tests**

Create `apps/pos/src/lib/report-incident.test.ts`:

```ts
import { describe, it, expect, jest } from '@jest/globals'
import { needsManagerPin, toIncidentPayload, reportIncident } from './report-incident'

describe('needsManagerPin', () => {
  it('matches the server rule exactly', () => {
    expect(needsManagerPin(0, 1000)).toBe(false)
    expect(needsManagerPin(999, 1000)).toBe(false)
    expect(needsManagerPin(1000, 1000)).toBe(true)
    expect(needsManagerPin(1350, 1000)).toBe(true)
  })
})

describe('toIncidentPayload', () => {
  it('sends cost in integer cents, never dollars', () => {
    const payload = toIncidentPayload({
      typeKey: 'wrong_item',
      title: 'Wrong side',
      costCents: 450,
      orderId: 'ord-1',
      reportedByStaffId: 'staff-1',
      managerPin: null,
    })
    expect(payload['cost_cents']).toBe(450)
    expect(JSON.stringify(payload)).not.toContain('4.5')
  })

  it('omits the manager PIN entirely when none was entered', () => {
    const payload = toIncidentPayload({
      typeKey: 'wrong_item',
      title: 'x',
      costCents: 0,
      orderId: null,
      reportedByStaffId: 'staff-1',
      managerPin: null,
    })
    expect('manager_pin' in payload).toBe(false)
  })
})

describe('reportIncident', () => {
  it('surfaces the server’s refusal rather than retrying', async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'A manager PIN is required for this amount' }),
    } as unknown as Response)

    await expect(
      reportIncident(
        {
          typeKey: 'wrong_item',
          title: 'x',
          costCents: 1350,
          orderId: null,
          reportedByStaffId: 'staff-1',
          managerPin: null,
        },
        fetchImpl
      )
    ).rejects.toThrow('A manager PIN is required for this amount')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm test --workspace=@nuatis/pos -- src/lib/report-incident.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper**

Create `apps/pos/src/lib/report-incident.ts`. `needsManagerPin` must mirror `requiresAuthorisation` in `apps/api/src/lib/incidents.ts` exactly — zero is always free, at-or-above needs a manager. Add a comment saying the server is authoritative and this only decides whether to show the PIN pad.

- [ ] **Step 4: Run the tests**

```bash
npm test --workspace=@nuatis/pos -- src/lib/report-incident.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Build the dialog**

Create `apps/pos/src/components/ReportIncidentDialog.tsx`: type buttons from `GET /api/pos/incidents/types`, a title field, an amount keypad reusing the pattern in `TenderAmount.tsx`, and — only when `needsManagerPin` is true — a PIN entry.

One dialog, not a wizard. This happens with a queue waiting.

- [ ] **Step 6: Wire it into the register**

In `apps/pos/src/app/page.tsx`, add a "Report issue" action on the cart panel that opens the dialog for the current order.

- [ ] **Step 7: Verify in the browser**

Start all three servers through the Browser pane (`preview_start`, never `npm run dev` in Bash). Report a $4.50 incident — no PIN prompt. Report a $13.50 one — PIN required, and `4321` accepts. Confirm both rows in the database:

```sql
select reference, type_key, cost_cents, authorised_by_staff_id from incidents
 order by created_at desc limit 2;
```

- [ ] **Step 8: Commit**

```bash
git add apps/pos/src/components/ReportIncidentDialog.tsx apps/pos/src/lib/report-incident.ts apps/pos/src/lib/report-incident.test.ts apps/pos/src/app/page.tsx
git commit -m "feat(pos): report an incident from the register"
```

---

### Task 9: KDS report action

**Files:**

- Create: `apps/kds/src/components/ReportTicketIssueDialog.tsx`
- Modify: `apps/kds/src/components/TicketCard.tsx`
- Modify: `apps/kds/src/app/page.tsx`

**Interfaces:**

- Consumes: `POST /api/pos/incidents` with `kitchen_ticket_id`.

- [ ] **Step 1: Add the action to the card**

Add an `onReportIssue: () => void` prop to `TicketCardProps` and a small "Issue" button next to Start/Ready. Keep it visually secondary — it is the rare action.

- [ ] **Step 2: Build the dialog**

Create `apps/kds/src/components/ReportTicketIssueDialog.tsx`. Kitchen-relevant types only — remakes and drops are what a cook reports. Cost defaults to 0, because a cook is not pricing the food.

- [ ] **Step 3: Send `kitchen_ticket_id`, and let the server derive the location**

The incident inherits the ticket's `location_id` server-side. The client must not send a location it chose itself — that is how a ticket-linked incident ends up filed against the wrong site.

- [ ] **Step 4: Verify in the browser**

Report an issue against a live ticket. Confirm:

```sql
select i.reference, i.kitchen_ticket_id, i.location_id, t.location_id as ticket_location
  from incidents i join kitchen_tickets t on t.id = i.kitchen_ticket_id
 order by i.created_at desc limit 1;
-- i.location_id must equal ticket_location
```

- [ ] **Step 5: Commit**

```bash
git add apps/kds/src/components/ReportTicketIssueDialog.tsx apps/kds/src/components/TicketCard.tsx apps/kds/src/app/page.tsx
git commit -m "feat(kds): report an issue against a kitchen ticket"
```

---

### Task 10: Dashboard queue and detail

**Files:**

- Create: `apps/web/src/app/(dashboard)/incidents/page.tsx`
- Create: `apps/web/src/app/(dashboard)/incidents/[id]/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/Sidebar.tsx`

- [ ] **Step 1: Build the queue**

Table of incidents with filters for status, severity, type and assignee. Follow the existing dashboard list pages (`orders`, `tasks`) for layout, pagination and empty states rather than inventing a new one.

- [ ] **Step 2: Build the detail view**

Incident header, the `incident_events` timeline in order, assignment control, and a resolve form taking root cause and resolution notes.

- [ ] **Step 3: Add the nav entry, gated on the module**

In `Sidebar.tsx`, add Incidents alongside the other module-gated entries, hidden when the tenant lacks `incidents`. Follow exactly how `pos` and `orders` are gated there — do not invent a second gating mechanism.

- [ ] **Step 4: Verify in the browser**

Triage, assign and resolve one of the incidents created in Task 8. Confirm the timeline has a row per action:

```sql
select kind, actor_kind, at from incident_events
 where incident_id = '<id>' order by at;
```

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(dashboard)/incidents" "apps/web/src/app/(dashboard)/Sidebar.tsx"
git commit -m "feat(incidents): dashboard queue and detail view"
```

---

### Task 11: Reporting view

**Files:**

- Create: `apps/web/src/app/(dashboard)/incidents/reports/page.tsx`

- [ ] **Step 1: Build the view**

Three sections from `GET /api/incidents/reports/summary`: cost by type, **comps per staff member**, and recurrence.

- [ ] **Step 2: Make the per-staff table the prominent one**

This is not a nice-to-have. It is the control that makes the authorisation threshold safe — a cashier comping $9.99 all shift is invisible in every other view and obvious in this one. Sort it by total cost descending, so the outlier is the first row.

- [ ] **Step 3: Verify with real data**

Create six sub-threshold incidents from one staff member via the register, then confirm the table shows them as one row totalling $59.94.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(dashboard)/incidents/reports"
git commit -m "feat(incidents): reporting view with per-staff comp totals"
```

---

### Task 12: SLA breach scanner

> Split out from what was one oversized task. Breach detection, escalation rules
> and automation triggers are three deliverables a reviewer could accept or
> reject independently, so they are three tasks. This one must work on its own:
> an incident that breaches its SLA notifies the owner, exactly once.

**Files:**

- Create: `apps/api/src/workers/incident-sla-scanner.ts`
- Create: `apps/api/src/workers/incident-sla-scanner.test.ts`
- Modify: `apps/api/src/workers/index.ts`
- Modify: `supabase/migrations/0199_incidents.sql`

**Interfaces:**

- Consumes: `createBullMQConnection` from `lib/bullmq-connection.js`; `getPausedTenants` from `lib/scanner-pause.js`; `notifyOwner` from `lib/notifications.js`.
- Produces: `scan(): Promise<void>`, `createIncidentSlaScanner(): { queue: Queue; worker: Worker }`.

- [ ] **Step 1: Add the breach marker column**

Append to `supabase/migrations/0199_incidents.sql`:

```sql
-- Set the first time the scanner notices a breach, so it notifies once rather
-- than on every tick. A scanner that re-notifies every 15 minutes gets muted,
-- and a muted SLA is decorative.
ALTER TABLE incidents ADD COLUMN IF NOT EXISTS sla_breached_at timestamptz;
```

Re-apply the migration. It is idempotent, so this is safe.

- [ ] **Step 2: Write the failing tests**

Create `apps/api/src/workers/incident-sla-scanner.test.ts`:

```ts
import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../routes/__test-support__/supabase-mock.js'

let store: MockStore = createStore()
const notifyOwner = jest.fn<() => Promise<void>>()
const getPausedTenants = jest.fn<() => Promise<Set<string>>>()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../lib/notifications.js', () => ({ notifyOwner }))
jest.unstable_mockModule('../lib/scanner-pause.js', () => ({ getPausedTenants }))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000sla0001'
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const { scan } = await import('./incident-sla-scanner.js')

const PAST = '2026-09-15T10:00:00.000Z'
const FUTURE = '2099-01-01T00:00:00.000Z'

function incident(overrides: Record<string, unknown> = {}) {
  return {
    id: 'inc-1',
    tenant_id: TENANT_ID,
    reference: 'INC-1001',
    severity: 'critical',
    status: 'open',
    sla_due_at: PAST,
    sla_breached_at: null,
    ...overrides,
  }
}

beforeEach(() => {
  store = createStore()
  notifyOwner.mockClear()
  getPausedTenants.mockClear()
  getPausedTenants.mockResolvedValue(new Set<string>())
  store.tables['incidents'] = []
})

describe('incident-sla-scanner', () => {
  it('selects only live incidents past their SLA', async () => {
    store.tables['incidents'] = [
      incident({ id: 'overdue-open' }),
      incident({ id: 'overdue-resolved', status: 'resolved' }),
      incident({ id: 'not-yet', sla_due_at: FUTURE }),
    ]

    await scan()

    expect(notifyOwner).toHaveBeenCalledTimes(1)
  })

  it('notifies once, not on every tick', async () => {
    store.tables['incidents'] = [incident()]

    await scan()
    await scan()

    expect(notifyOwner).toHaveBeenCalledTimes(1)
  })

  it('stamps sla_breached_at so the second run has nothing to find', async () => {
    store.tables['incidents'] = [incident()]

    await scan()

    expect(store.tables['incidents']![0]!['sla_breached_at']).toBeTruthy()
  })

  it('skips paused tenants like every other scanner', async () => {
    store.tables['incidents'] = [incident()]
    getPausedTenants.mockResolvedValue(new Set([TENANT_ID]))

    await scan()

    expect(notifyOwner).not.toHaveBeenCalled()
    // And it must not be marked breached, or unpausing would silently swallow it.
    expect(store.tables['incidents']![0]!['sla_breached_at']).toBeNull()
  })

  it('does not notify when nothing has breached', async () => {
    store.tables['incidents'] = [incident({ sla_due_at: FUTURE })]

    await scan()

    expect(notifyOwner).not.toHaveBeenCalled()
  })

  it('notifies each tenant separately rather than once for all', async () => {
    store.tables['incidents'] = [
      incident({ id: 'a', tenant_id: 'tenant-a' }),
      incident({ id: 'b', tenant_id: 'tenant-b' }),
    ]

    await scan()

    expect(notifyOwner).toHaveBeenCalledTimes(2)
  })
})
```

The paused-tenant assertion checks **both** halves: no notification _and_ no breach stamp. Stamping a paused tenant's incident would mean unpausing silently swallows the alert — the incident is already marked breached, so it never fires.

- [ ] **Step 3: Run them and watch them fail**

```bash
npm test --workspace=@nuatis/api -- src/workers/incident-sla-scanner.test.ts
```

Expected: FAIL — `Cannot find module './incident-sla-scanner.js'`.

- [ ] **Step 4: Write the scanner**

Create `apps/api/src/workers/incident-sla-scanner.ts`:

```ts
import { Queue, Worker } from 'bullmq'
import { getServiceClient } from '../lib/supabase.js'
import { notifyOwner } from '../lib/notifications.js'
import { createBullMQConnection } from '../lib/bullmq-connection.js'
import { getPausedTenants } from '../lib/scanner-pause.js'

const QUEUE_NAME = 'incident-sla-scanner'

interface BreachedRow {
  id: string
  tenant_id: string
  reference: string
  severity: string
}

export async function scan(): Promise<void> {
  console.info('[incident-sla-scanner] scanning for SLA breaches...')

  try {
    const supabase = getServiceClient()
    const pausedTenants = await getPausedTenants(QUEUE_NAME)
    const nowIso = new Date().toISOString()

    // sla_breached_at IS NULL is what makes this notify once. Without it the
    // same incident is re-reported every 15 minutes until someone resolves it.
    const { data, error } = await supabase
      .from('incidents')
      .select('id, tenant_id, reference, severity')
      .lt('sla_due_at', nowIso)
      .is('sla_breached_at', null)
      .not('status', 'in', '("resolved","cancelled")')

    if (error) {
      console.error('[incident-sla-scanner] query error:', error.message)
      return
    }

    const breached = ((data ?? []) as BreachedRow[]).filter(
      (row) => !pausedTenants.has(row.tenant_id)
    )

    if (breached.length === 0) {
      console.info('[incident-sla-scanner] no breaches')
      return
    }

    // Stamp BEFORE notifying. A crash between the two costs one missed
    // notification; the other order costs a duplicate on every tick forever,
    // which is how a team learns to ignore the alert.
    for (const row of breached) {
      await supabase.from('incidents').update({ sla_breached_at: nowIso }).eq('id', row.id)
    }

    // One notification per tenant, not per incident: a kitchen that falls
    // behind generates a dozen breaches at once and a dozen pushes is noise.
    const byTenant = new Map<string, BreachedRow[]>()
    for (const row of breached) {
      const list = byTenant.get(row.tenant_id) ?? []
      list.push(row)
      byTenant.set(row.tenant_id, list)
    }

    for (const [tenantId, rows] of byTenant) {
      const first = rows[0] as BreachedRow
      void notifyOwner(tenantId, 'incident_sla_breached', {
        pushTitle:
          rows.length === 1 ? `${first.reference} is overdue` : `${rows.length} incidents overdue`,
        pushBody:
          rows.length === 1
            ? `${first.reference} (${first.severity}) passed its response time.`
            : `${rows.length} incidents have passed their response time.`,
        pushUrl: '/incidents',
        // NOTE: no smsBody. notifyOwner's SMS branch is commented out pending a
        // personal phone field on users — passing one would be silently ignored.
      })
    }

    console.info(
      `[incident-sla-scanner] ${breached.length} breach(es) across ${byTenant.size} tenant(s)`
    )
  } catch (err) {
    console.error('[incident-sla-scanner] scan error:', err)
  }
}

export function createIncidentSlaScanner(): { queue: Queue; worker: Worker } {
  const connection = createBullMQConnection()

  const queue = new Queue(QUEUE_NAME, { connection, skipVersionCheck: true })
  const worker = new Worker(QUEUE_NAME, async () => scan(), { connection, skipVersionCheck: true })

  worker.on('failed', (job, err) => {
    console.error(`[incident-sla-scanner] job ${job?.id} failed:`, err)
  })

  return { queue, worker }
}
```

- [ ] **Step 5: Run the tests**

```bash
npm test --workspace=@nuatis/api -- src/workers/incident-sla-scanner.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 6: Register it on a 15-minute cron**

In `apps/api/src/workers/index.ts`:

```ts
import { createIncidentSlaScanner } from './incident-sla-scanner.js'
```

and alongside the other scanners:

```ts
const incidentSlaScanner = createIncidentSlaScanner()
await incidentSlaScanner.queue.add(
  'scan',
  {},
  { repeat: { pattern: '*/15 * * * *' }, jobId: 'incident-sla-scanner-15min' }
)
managed.push({ name: 'incident-sla-scanner', ...incidentSlaScanner })
console.info('[workers] incident-sla-scanner started, cron */15 * * * *')
```

Every 15 minutes, not the daily `0 9 * * *` the other scanners use. A one-hour critical SLA checked once a day is not an SLA.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/workers/incident-sla-scanner.ts apps/api/src/workers/incident-sla-scanner.test.ts apps/api/src/workers/index.ts supabase/migrations/0199_incidents.sql
git commit -m "feat(incidents): SLA breach scanner, notifying once per tenant"
```

---

### Task 13: Escalation rules

**Files:**

- Modify: `apps/api/src/workers/incident-sla-scanner.ts`
- Modify: `apps/api/src/workers/incident-sla-scanner.test.ts`

**Interfaces:**

- Consumes: `incident_rules` rows from Task 1.
- Produces: `applyRules(tenantId, incidentIds, when): Promise<void>` — exported from the scanner module for testing.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/workers/incident-sla-scanner.test.ts`:

```ts
describe('escalation rules', () => {
  beforeEach(() => {
    store.tables['incident_rules'] = []
    store.tables['incident_events'] = []
  })

  it('applies an assign_to rule on breach', async () => {
    store.tables['incidents'] = [incident({ severity: 'critical' })]
    store.tables['incident_rules'] = [
      {
        id: 'r1',
        tenant_id: TENANT_ID,
        when_event: 'breached',
        match_severity: 'critical',
        match_type_key: null,
        action: 'assign_to',
        target_user_id: 'user-oncall',
        delay_minutes: 0,
        enabled: true,
      },
    ]

    await scan()

    expect(store.tables['incidents']![0]!['assigned_to_user_id']).toBe('user-oncall')
  })

  it('ignores a rule belonging to another tenant', async () => {
    store.tables['incidents'] = [incident({ severity: 'critical' })]
    store.tables['incident_rules'] = [
      {
        id: 'r1',
        tenant_id: 'someone-else',
        when_event: 'breached',
        match_severity: 'critical',
        match_type_key: null,
        action: 'assign_to',
        target_user_id: 'their-user',
        delay_minutes: 0,
        enabled: true,
      },
    ]

    await scan()

    expect(store.tables['incidents']![0]!['assigned_to_user_id']).toBeNull()
  })

  it('ignores a disabled rule', async () => {
    store.tables['incidents'] = [incident({ severity: 'critical' })]
    store.tables['incident_rules'] = [
      {
        id: 'r1',
        tenant_id: TENANT_ID,
        when_event: 'breached',
        match_severity: 'critical',
        match_type_key: null,
        action: 'assign_to',
        target_user_id: 'user-oncall',
        delay_minutes: 0,
        enabled: false,
      },
    ]

    await scan()

    expect(store.tables['incidents']![0]!['assigned_to_user_id']).toBeNull()
  })

  it('does not overwrite an assignee a human already chose', async () => {
    store.tables['incidents'] = [
      incident({ severity: 'critical', assigned_to_user_id: 'user-dana' }),
    ]
    store.tables['incident_rules'] = [
      {
        id: 'r1',
        tenant_id: TENANT_ID,
        when_event: 'breached',
        match_severity: 'critical',
        match_type_key: null,
        action: 'assign_to',
        target_user_id: 'user-oncall',
        delay_minutes: 0,
        enabled: true,
      },
    ]

    await scan()

    expect(store.tables['incidents']![0]!['assigned_to_user_id']).toBe('user-dana')
  })

  it('matches on type_key as well as severity', async () => {
    store.tables['incidents'] = [incident({ severity: 'low', type_key: 'equipment' })]
    store.tables['incident_rules'] = [
      {
        id: 'r1',
        tenant_id: TENANT_ID,
        when_event: 'breached',
        match_severity: null,
        match_type_key: 'equipment',
        action: 'assign_to',
        target_user_id: 'user-maint',
        delay_minutes: 0,
        enabled: true,
      },
    ]

    await scan()

    expect(store.tables['incidents']![0]!['assigned_to_user_id']).toBe('user-maint')
  })

  it('writes an event so the timeline shows the rule acted, not a person', async () => {
    store.tables['incidents'] = [incident({ severity: 'critical' })]
    store.tables['incident_rules'] = [
      {
        id: 'r1',
        tenant_id: TENANT_ID,
        when_event: 'breached',
        match_severity: 'critical',
        match_type_key: null,
        action: 'assign_to',
        target_user_id: 'user-oncall',
        delay_minutes: 0,
        enabled: true,
      },
    ]

    await scan()

    const events = store.tables['incident_events'] ?? []
    expect(events).toHaveLength(1)
    expect(events[0]!['actor_kind']).toBe('system')
  })
})
```

The "does not overwrite a human's assignee" case matters most: a rule that reassigns work someone already picked up is how automation gets turned off.

- [ ] **Step 2: Run them and watch them fail**

```bash
npm test --workspace=@nuatis/api -- src/workers/incident-sla-scanner.test.ts -t "escalation rules"
```

Expected: FAIL — nothing applies rules yet.

- [ ] **Step 3: Implement rule evaluation**

Add to `apps/api/src/workers/incident-sla-scanner.ts`, and call it from `scan()` after the breach stamp:

```ts
interface RuleRow {
  id: string
  tenant_id: string
  when_event: string
  match_type_key: string | null
  match_severity: string | null
  action: string
  target_user_id: string | null
  enabled: boolean
}

interface IncidentForRules {
  id: string
  tenant_id: string
  severity: string
  type_key: string
  assigned_to_user_id: string | null
}

/**
 * Apply a tenant's escalation rules to incidents that just changed state.
 *
 * Rules are loaded tenant-scoped. A rule with a null match field matches
 * anything for that field, so a rule with both null applies to every incident
 * at this event.
 */
export async function applyRules(
  tenantId: string,
  incidents: IncidentForRules[],
  when: 'created' | 'breached' | 'unassigned'
): Promise<void> {
  const supabase = getServiceClient()

  const { data } = await supabase
    .from('incident_rules')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('when_event', when)
    .eq('enabled', true)

  const rules = (data ?? []) as RuleRow[]
  if (rules.length === 0) return

  for (const inc of incidents) {
    for (const rule of rules) {
      if (rule.match_severity && rule.match_severity !== inc.severity) continue
      if (rule.match_type_key && rule.match_type_key !== inc.type_key) continue

      if (rule.action === 'assign_to' && rule.target_user_id) {
        // Never take work off a person who already picked it up. A rule that
        // reassigns someone's incident out from under them is how a team
        // decides the automation is more trouble than it is worth.
        if (inc.assigned_to_user_id) continue

        await supabase
          .from('incidents')
          .update({ assigned_to_user_id: rule.target_user_id })
          .eq('id', inc.id)
          .eq('tenant_id', tenantId)

        await supabase.from('incident_events').insert({
          tenant_id: tenantId,
          incident_id: inc.id,
          actor_kind: 'system',
          actor_id: null,
          kind: 'assigned',
          detail: { by_rule: rule.id, assigned_to_user_id: rule.target_user_id },
        })

        // Keep the in-memory copy honest so a second matching rule sees it as
        // taken rather than assigning over it.
        inc.assigned_to_user_id = rule.target_user_id
      }
    }
  }
}
```

Widen the scanner's select to include `severity`, `type_key` and `assigned_to_user_id`, then call `applyRules(tenantId, rows, 'breached')` inside the per-tenant loop, before `notifyOwner`.

- [ ] **Step 4: Run the tests**

```bash
npm test --workspace=@nuatis/api -- src/workers/incident-sla-scanner.test.ts
```

Expected: PASS, 12 tests (6 from Task 12, 6 here).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/workers/incident-sla-scanner.ts apps/api/src/workers/incident-sla-scanner.test.ts
git commit -m "feat(incidents): escalation rules on SLA breach"
```

---

### Task 14: Automation triggers

**Files:**

- Modify: `apps/api/src/routes/pos/incidents.ts`
- Modify: `apps/api/src/routes/incidents.ts`
- Modify: `apps/api/src/workers/incident-sla-scanner.ts`
- Create: `apps/api/src/lib/incident-triggers.ts`
- Create: `apps/api/src/lib/incident-triggers.test.ts`

**Interfaces:**

- Produces: `fireIncidentTrigger(tenantId, trigger, incident): void` — fire-and-forget, never throws.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/lib/incident-triggers.test.ts`:

```ts
import { jest, describe, it, expect, beforeEach } from '@jest/globals'

const enqueueCustomAutomation = jest.fn<() => Promise<void>>()
jest.unstable_mockModule('./custom-automation.js', () => ({ enqueueCustomAutomation }))

const { fireIncidentTrigger } = await import('./incident-triggers.js')

beforeEach(() => enqueueCustomAutomation.mockClear())

describe('fireIncidentTrigger', () => {
  it('enqueues the trigger with the incident payload', async () => {
    fireIncidentTrigger('tenant-1', 'incident_created', { id: 'inc-1', reference: 'INC-1001' })
    await Promise.resolve()

    expect(enqueueCustomAutomation).toHaveBeenCalledTimes(1)
  })

  it('never throws when the automation module is absent', async () => {
    enqueueCustomAutomation.mockRejectedValue(new Error('no automation module'))

    // A missing automation module must not fail the request that reported the
    // incident. The incident is the thing that matters; the trigger is a bonus.
    expect(() => fireIncidentTrigger('tenant-1', 'incident_created', { id: 'inc-1' })).not.toThrow()
    await Promise.resolve()
  })

  it('is fire-and-forget — it returns before the enqueue settles', () => {
    let settled = false
    enqueueCustomAutomation.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10))
      settled = true
    })

    fireIncidentTrigger('tenant-1', 'incident_breached', { id: 'inc-1' })

    expect(settled).toBe(false)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

```bash
npm test --workspace=@nuatis/api -- src/lib/incident-triggers.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Read the existing trigger dispatch before writing this**

Open `apps/api/src/workers/custom-automation-worker.ts` and the route that fires `inbound_webhook` (`routes/automation-webhook-public.ts`). Match whatever enqueue function they already use — do **not** invent a new dispatch path. If the function name differs from `enqueueCustomAutomation`, use the real one and update the test's mock to match.

- [ ] **Step 4: Write the module**

Create `apps/api/src/lib/incident-triggers.ts`:

```ts
/**
 * Emit an incident event into the automation engine.
 *
 * Deliberately fire-and-forget and deliberately silent on failure. Built-in
 * escalation rules (incident_rules) are what make the incidents module work on
 * its own; this is the extra reach for tenants who ALSO have the automation
 * module. A tenant without it simply has no listener, and that must never turn
 * into a failed incident report.
 */
export type IncidentTrigger = 'incident_created' | 'incident_breached'

export function fireIncidentTrigger(
  tenantId: string,
  trigger: IncidentTrigger,
  incident: Record<string, unknown>
): void {
  void (async () => {
    try {
      const { enqueueCustomAutomation } = await import('./custom-automation.js')
      await enqueueCustomAutomation(tenantId, trigger, { incident })
    } catch (err) {
      console.error(`[incident-triggers] ${trigger} failed:`, err)
    }
  })()
}
```

- [ ] **Step 5: Call it from the three places an incident changes state**

- `routes/pos/incidents.ts`, after the successful insert: `fireIncidentTrigger(authed.tenantId, 'incident_created', incident)`
- `routes/incidents.ts`, after the successful insert: the same
- `workers/incident-sla-scanner.ts`, after stamping a breach: `fireIncidentTrigger(row.tenant_id, 'incident_breached', row)`

- [ ] **Step 6: Run the full API suite**

```bash
npm test --workspace=@nuatis/api
```

Expected: green. The route tests from Tasks 5 and 6 must still pass — if a trigger failure breaks an incident report, the fire-and-forget is wrong.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/incident-triggers.ts apps/api/src/lib/incident-triggers.test.ts apps/api/src/routes/incidents.ts apps/api/src/routes/pos/incidents.ts apps/api/src/workers/incident-sla-scanner.ts
git commit -m "feat(incidents): emit automation triggers on create and breach"
```

---

## Final verification

Run before opening the PR. Every box names the command that proves it.

- [ ] `npm run typecheck --workspaces --if-present` — clean
- [ ] `npm run lint` — clean at `--max-warnings 0`
- [ ] `npm test --workspaces --if-present` — green
- [ ] Both Next builds succeed:
      `npm run build --workspace=apps/pos` and `--workspace=apps/kds`
- [ ] A cashier can report a $4.50 comp with no PIN and a $13.50 comp with one
- [ ] A cook can report an issue against a ticket, and it inherits the ticket's location
- [ ] A manager can triage, assign and resolve from the dashboard, and the timeline shows every step
- [ ] The per-staff report totals six $9.99 comps as $59.94 under one name
- [ ] An overdue incident notifies exactly once across two scanner runs
- [ ] A paused tenant's breached incident is neither notified nor stamped, so
      unpausing does not silently swallow it
- [ ] An escalation rule does not take work off a human who already picked it up
- [ ] A failing automation trigger does not fail the incident report that fired it
- [ ] A `pos_only` tenant can still report from the register but gets 403 from `/api/incidents`:
      `sql
update tenants set product = 'pos_only' where id = '<demo tenant>';
-- POST /api/pos/incidents  → 201
-- GET  /api/incidents      → 403
-- then set it back
`
- [ ] Migration 0199 applied to production and recorded in `supabase/migrations/README.md`
- [ ] Update the master checklist — tick Phase A boxes only where the proving command was actually run
