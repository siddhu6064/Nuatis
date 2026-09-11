# Kitchen POS Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server side of Kitchen POS inside the nuatis monorepo — menu schema, kitchen tickets with station routing, cash drawer, tender math, and terminal PIN auth — so the two frontends (a later plan) are built against a proven API.

**Architecture:** POS ships as a module of the existing nuatis platform, reusing `orders`, `order_line_items`, `order_payments`, `contacts`, `locations`, and the entitlement system. New POS routes live in a grouped `apps/api/src/routes/pos/` namespace rather than joining the 231 flat files in `routes/`. Pure cart and tender arithmetic lives in a new `packages/pos-core` workspace package with no React and no I/O.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Express, Supabase/Postgres with RLS, Jest with `unstable_mockModule`, `jose` for JWTs, `ws` for WebSockets.

**Spec:** `docs/superpowers/specs/2026-09-10-kitchen-pos-kds-design.md`

**Scope:** Backend only. The `apps/pos` terminal and `apps/kds` display are a separate plan written after this one lands.

## Global Constraints

- Migrations are numbered sequentially starting at **0195** (0194 is the current head). One migration file per task; never renumber an existing file.
- RLS on every new table: `CREATE POLICY tenant_isolation ON <table> USING (tenant_id = current_tenant_id());` — never the `auth.jwt() -> 'app_metadata'` form used by the KitchenPOS prototype.
- Money columns are `numeric(10,2)` (dollars) to match all 195 existing migrations. Money arithmetic in TypeScript is performed in **integer cents**; floating-point arithmetic on dollar values is forbidden.
- All new API routes mount under `/api/pos/...` and are guarded by `requireAuth` then a `pos` module check.
- ESM: every relative import ends in `.js`, including imports of `.ts` source files.
- Tests use the in-memory mock Supabase (`__test-support__/supabase-mock.ts`), not a live database.
- Test command: `npm run test --workspace=apps/api`
- Typecheck command: `npm run typecheck --workspace=apps/api`
- Lint runs with `--max-warnings 0`. Unused variables and missing return types fail the build.
- A pre-commit hook runs Prettier on staged files. Let it reformat; do not fight it.
- Commit after every task. Never use `--no-verify` on nuatis commits.

---

### Task 1: Register the `pos` module and the `pos_only` product

Entitlement is decided by `defaultEntitlement(module, plan, product)` in `stripe-plans.ts`, not by the `alwaysOn` flag in the module registry (`alwaysOn` only controls whether a toggle row renders in the settings UI). A POS-only merchant is therefore expressed as `product = 'pos_only'`, mirroring the existing `'maya_only'` product — no registry surgery required.

**Files:**

- Modify: `apps/api/src/config/module-registry.ts`
- Modify: `apps/api/src/config/stripe-plans.ts`
- Test: `apps/api/src/config/pos-entitlement.test.ts` (create)

**Interfaces:**

- Consumes: nothing (first task).
- Produces: module id `'pos'` accepted by `isModuleEnabled(tenantId, 'pos')` and by the `PUT /api/settings/modules` allow-list; product value `'pos_only'` understood by `defaultEntitlement`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/config/pos-entitlement.test.ts`:

```ts
import { describe, it, expect } from '@jest/globals'
import { defaultEntitlement, TIER_GATED } from './stripe-plans.js'
import { VALID_MODULE_IDS, getModuleDef } from './module-registry.js'

describe('pos module registration', () => {
  it('is a valid module id', () => {
    expect(VALID_MODULE_IDS).toContain('pos')
  })

  it('has a module definition', () => {
    const def = getModuleDef('pos')
    expect(def).toBeDefined()
    expect(def?.defaultOn).toBe(false)
  })

  it('is tier-gated, not a base-suite freebie', () => {
    expect(TIER_GATED.has('pos')).toBe(true)
  })
})

describe('pos_only product', () => {
  it('grants pos', () => {
    expect(defaultEntitlement('pos', null, 'pos_only')).toBe(true)
  })

  it('grants crm — POS needs a customer record for receipts and gift cards', () => {
    expect(defaultEntitlement('crm', null, 'pos_only')).toBe(true)
  })

  it('does NOT grant maya', () => {
    expect(defaultEntitlement('maya', null, 'pos_only')).toBe(false)
  })

  it('does NOT grant scheduling', () => {
    expect(defaultEntitlement('scheduling', null, 'pos_only')).toBe(false)
  })

  it('does not leak pos to a suite tenant on a plan that omits it', () => {
    expect(defaultEntitlement('pos', 'core', 'suite')).toBe(false)
  })

  it('grants pos to a suite tenant on the scale plan', () => {
    expect(defaultEntitlement('pos', 'scale', 'suite')).toBe(true)
  })

  it('still restricts maya_only to maya', () => {
    expect(defaultEntitlement('pos', null, 'maya_only')).toBe(false)
    expect(defaultEntitlement('maya', null, 'maya_only')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- pos-entitlement`
Expected: FAIL — `VALID_MODULE_IDS` does not contain `'pos'`.

- [ ] **Step 3: Add `pos` to the module registry**

In `apps/api/src/config/module-registry.ts`, add `| 'pos'` to the `ModuleId` union (after `'orders'`), and insert this entry into the `MODULES` array immediately after the `orders` entry:

```ts
  {
    id: 'pos',
    label: 'Point of Sale',
    description:
      'Register, kitchen display, and cash drawer for in-person sales.',
    minPlan: 'scale',
    defaultOn: false,
  },
```

- [ ] **Step 4: Add `pos` to `TIER_GATED` and teach `defaultEntitlement` about `pos_only`**

In `apps/api/src/config/stripe-plans.ts`, add `'pos'` to the `TIER_GATED` set, add `'pos'` to the `scale` plan's `modules` array, and add the `pos_only` branch as the **second** line of `defaultEntitlement` (immediately after the `maya_only` branch, before the `BASE_SUITE` check — otherwise `BASE_SUITE.has('crm')` would return true for every product and the ordering would not be exercised):

```ts
export function defaultEntitlement(
  module: string,
  plan: string | null,
  product: string | null
): boolean {
  if (product === 'maya_only') return module === 'maya' // maya_only = maya only
  // pos_only = the register plus the customer record it depends on (receipts,
  // gift cards, loyalty). Deliberately excludes maya/scheduling/pipeline so a
  // POS-only merchant is not billed for or shown the rest of the suite.
  if (product === 'pos_only') return module === 'pos' || module === 'crm'
  if (BASE_SUITE.has(module)) return true // suite base features
  if (TIER_GATED.has(module)) {
    const p = plan && PLANS[plan as PlanKey]
    return p ? (p.modules as readonly string[]).includes(module) : false // unknown plan → fail closed
  }
  return false // unknown module → fail closed
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace=apps/api -- pos-entitlement`
Expected: PASS, 9 tests.

- [ ] **Step 6: Run the existing suite to check nothing regressed**

Run: `npm run test --workspace=apps/api -- settings-modules verticals`
Expected: PASS. The `settings-modules` route derives its allow-list from `VALID_MODULE_IDS`, so adding a module must not break it.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck --workspace=apps/api
git add apps/api/src/config/module-registry.ts apps/api/src/config/stripe-plans.ts apps/api/src/config/pos-entitlement.test.ts
git commit -m "feat(pos): register pos module and pos_only product"
```

---

### Task 2: Migration 0195 — menu schema and orders adaptations

The menu schema is ported in _shape_ from the KitchenPOS prototype (`Nuatis-KitchenPOS/supabase/migrations/20260502120100_menu.sql`) but rewritten: `current_tenant_id()` RLS instead of the JWT path, and `numeric(10,2)` instead of `int` cents.

This migration also widens `orders.source`. The existing constraint is `CHECK (source IN ('staff','maya'))` — a POS order insert fails at runtime with a constraint violation, not at build time. This is the same failure class as the `contact_source` enum bug that silently broke four contact-creating routes.

**Files:**

- Create: `supabase/migrations/0195_pos_menu.sql`
- Test: `apps/api/src/routes/pos/menu.integration.test.ts` (created in Task 3; this task's verification is SQL-level)

**Interfaces:**

- Consumes: existing `tenants`, `orders`, `order_line_items`, `locations`.
- Produces: tables `menu_categories`, `menu_items`, `modifier_groups`, `modifier_options`, `menu_item_modifier_groups`; columns `order_line_items.menu_item_id` and `order_line_items.modifiers`; `orders.source` accepting `'pos'`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0195_pos_menu.sql`:

```sql
-- 0195_pos_menu
-- Menu model for the POS module: categories, items, modifier groups/options,
-- and the item↔group junction. Ported in shape from the KitchenPOS prototype
-- but rewritten to nuatis conventions: current_tenant_id() RLS (not the
-- auth.jwt()->'app_metadata' form) and numeric(10,2) dollars (not int cents,
-- which would clash with orders.balance_due's generated numeric column).

CREATE TABLE menu_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  sort_order  integer NOT NULL DEFAULT 0,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE menu_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id      uuid NOT NULL REFERENCES menu_categories(id) ON DELETE CASCADE,
  name             text NOT NULL,
  price            numeric(10,2) NOT NULL DEFAULT 0,
  taxable          boolean NOT NULL DEFAULT true,
  image_url        text,
  -- Routing key the KDS filters on. NULL = no station, shows on every screen.
  kitchen_station  text,
  available        boolean NOT NULL DEFAULT true,
  sort_order       integer NOT NULL DEFAULT 0,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE modifier_groups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  min_select  integer NOT NULL DEFAULT 0,
  max_select  integer NOT NULL DEFAULT 1,
  required    boolean NOT NULL DEFAULT false,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT modifier_groups_select_range CHECK (min_select <= max_select)
);

CREATE TABLE modifier_options (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  group_id     uuid NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  name         text NOT NULL,
  price_delta  numeric(10,2) NOT NULL DEFAULT 0,
  sort_order   integer NOT NULL DEFAULT 0,
  deleted_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE menu_item_modifier_groups (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  item_id     uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  group_id    uuid NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  sort_order  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, group_id)
);

CREATE INDEX idx_menu_categories_tenant ON menu_categories(tenant_id);
CREATE INDEX idx_menu_items_tenant ON menu_items(tenant_id);
CREATE INDEX idx_menu_items_category ON menu_items(category_id);
CREATE INDEX idx_menu_items_station ON menu_items(tenant_id, kitchen_station);
CREATE INDEX idx_modifier_groups_tenant ON modifier_groups(tenant_id);
CREATE INDEX idx_modifier_options_group ON modifier_options(group_id);
CREATE INDEX idx_mimg_item ON menu_item_modifier_groups(item_id);
CREATE INDEX idx_mimg_group ON menu_item_modifier_groups(group_id);

ALTER TABLE menu_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON menu_categories USING (tenant_id = current_tenant_id());

ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON menu_items USING (tenant_id = current_tenant_id());

ALTER TABLE modifier_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modifier_groups USING (tenant_id = current_tenant_id());

ALTER TABLE modifier_options ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modifier_options USING (tenant_id = current_tenant_id());

ALTER TABLE menu_item_modifier_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON menu_item_modifier_groups USING (tenant_id = current_tenant_id());

-- ── orders adaptations ──────────────────────────────────────────────────────

-- orders.source was CHECK (source IN ('staff','maya')). A POS ticket insert
-- would fail at runtime with a constraint violation, not at build time — the
-- same failure mode as the contact_source enum bug that silently broke four
-- contact-creating routes. Widen it before any POS route writes an order.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_source_check;
ALTER TABLE orders ADD CONSTRAINT orders_source_check
  CHECK (source IN ('staff','maya','pos'));

-- A POS line references a menu item, not a CPQ service or an inventory item.
ALTER TABLE order_line_items
  ADD COLUMN IF NOT EXISTS menu_item_id uuid REFERENCES menu_items(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_order_line_items_menu_item
  ON order_line_items(menu_item_id);

-- Chosen modifiers are snapshotted onto the line, not joined at read time, so
-- editing or deleting a modifier later never rewrites a historical ticket or
-- receipt. Shape: [{ group_id, group_name, option_id, option_name, price_delta }]
ALTER TABLE order_line_items
  ADD COLUMN IF NOT EXISTS modifiers jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Tip is recorded on the order, separate from subtotal/tax, so it can be
-- excluded from the Stripe Connect application-fee basis.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS tip_amount numeric(10,2) NOT NULL DEFAULT 0;
```

- [ ] **Step 2: Verify the SQL parses and the source constraint actually changed**

Run against a scratch database (or the Supabase SQL editor on a branch — do **not** run against production):

```sql
-- after applying 0195
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'orders_source_check';
```

Expected: output contains `'pos'`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0195_pos_menu.sql
git commit -m "feat(pos): migration 0195 — menu schema, widen orders.source, line modifiers"
```

---

### Task 3: Menu CRUD routes

**Files:**

- Create: `apps/api/src/routes/pos/menu.ts`
- Create: `apps/api/src/routes/pos/menu.integration.test.ts`
- Modify: `apps/api/src/index.ts` (mount the router)

**Interfaces:**

- Consumes: `requireAuth`, `AuthenticatedRequest` from `../../lib/auth.js`; `isModuleEnabled` from `../../lib/modules.js`; `getServiceClient` from `../../lib/supabase.js`; tables from Task 2.
- Produces: `GET /api/pos/menu/tree`, `POST|PATCH|DELETE /api/pos/menu/categories`, `POST|PATCH|DELETE /api/pos/menu/items`, `POST|PATCH|DELETE /api/pos/menu/modifier-groups`, `POST /api/pos/menu/modifier-options`, `POST|DELETE /api/pos/menu/items/:itemId/modifier-groups/:groupId`. Default-exports an Express `Router`.
- Produces: `requirePos` middleware, exported for reuse by Tasks 5, 7, and 8.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routes/pos/menu.integration.test.ts`:

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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000pos0001'
const OTHER_TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000pos0002'
const USER_ID = 'user-pos-001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken(
    { sub: USER_ID, tenantId: TENANT_ID, role: 'owner', vertical: 'restaurant' },
    { secret: SECRET }
  )
}

// Sequential, not Promise.all — concurrent dynamic imports that share a newly
// common dependency can race in Jest's experimental VM-modules linker.
const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: menuRouter } = await import('./menu.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/pos/menu', menuRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  seedEntitledTenant(store, TENANT_ID, { modules: { pos: true } })
})

describe('POST /api/pos/menu/categories', () => {
  it('creates a category scoped to the caller tenant', async () => {
    const res = await request(makeApp())
      .post('/api/pos/menu/categories')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ name: 'Mains', sort_order: 1 })

    expect(res.status).toBe(201)
    expect(res.body.category.name).toBe('Mains')
    expect(res.body.category.tenant_id).toBe(TENANT_ID)
  })

  it('rejects a blank name', async () => {
    const res = await request(makeApp())
      .post('/api/pos/menu/categories')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ name: '   ' })

    expect(res.status).toBe(400)
  })
})

describe('pos module gate', () => {
  it('returns 403 when the pos module is disabled', async () => {
    seedEntitledTenant(store, TENANT_ID, { modules: { pos: false } })
    const res = await request(makeApp())
      .get('/api/pos/menu/tree')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(403)
  })
})

describe('GET /api/pos/menu/tree', () => {
  it('nests items under categories and modifier groups under items', async () => {
    store.tables['menu_categories'] = [
      { id: 'cat-1', tenant_id: TENANT_ID, name: 'Mains', sort_order: 0, deleted_at: null },
    ]
    store.tables['menu_items'] = [
      {
        id: 'item-1',
        tenant_id: TENANT_ID,
        category_id: 'cat-1',
        name: 'Burger',
        price: '12.00',
        taxable: true,
        kitchen_station: 'grill',
        available: true,
        sort_order: 0,
        deleted_at: null,
      },
    ]
    store.tables['modifier_groups'] = [
      {
        id: 'grp-1',
        tenant_id: TENANT_ID,
        name: 'Temperature',
        min_select: 1,
        max_select: 1,
        required: true,
        deleted_at: null,
      },
    ]
    store.tables['modifier_options'] = [
      {
        id: 'opt-1',
        tenant_id: TENANT_ID,
        group_id: 'grp-1',
        name: 'Medium',
        price_delta: '0.00',
        sort_order: 0,
        deleted_at: null,
      },
    ]
    store.tables['menu_item_modifier_groups'] = [
      { tenant_id: TENANT_ID, item_id: 'item-1', group_id: 'grp-1', sort_order: 0 },
    ]

    const res = await request(makeApp())
      .get('/api/pos/menu/tree')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.categories).toHaveLength(1)
    expect(res.body.categories[0].items).toHaveLength(1)
    expect(res.body.categories[0].items[0].modifier_groups).toHaveLength(1)
    expect(res.body.categories[0].items[0].modifier_groups[0].options[0].name).toBe('Medium')
  })

  it('excludes soft-deleted items', async () => {
    store.tables['menu_categories'] = [
      { id: 'cat-1', tenant_id: TENANT_ID, name: 'Mains', sort_order: 0, deleted_at: null },
    ]
    store.tables['menu_items'] = [
      {
        id: 'item-1',
        tenant_id: TENANT_ID,
        category_id: 'cat-1',
        name: 'Retired Burger',
        price: '12.00',
        taxable: true,
        kitchen_station: 'grill',
        available: true,
        sort_order: 0,
        deleted_at: '2026-01-01T00:00:00Z',
      },
    ]

    const res = await request(makeApp())
      .get('/api/pos/menu/tree')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.categories[0].items).toHaveLength(0)
  })

  it('does not return another tenant’s categories', async () => {
    store.tables['menu_categories'] = [
      { id: 'cat-x', tenant_id: OTHER_TENANT_ID, name: 'Theirs', sort_order: 0, deleted_at: null },
    ]

    const res = await request(makeApp())
      .get('/api/pos/menu/tree')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.categories).toHaveLength(0)
  })
})

describe('DELETE /api/pos/menu/items/:id', () => {
  it('soft-deletes rather than hard-deleting, so historical tickets keep resolving', async () => {
    store.tables['menu_items'] = [
      {
        id: 'item-1',
        tenant_id: TENANT_ID,
        category_id: 'cat-1',
        name: 'Burger',
        price: '12.00',
        taxable: true,
        kitchen_station: 'grill',
        available: true,
        sort_order: 0,
        deleted_at: null,
      },
    ]

    const res = await request(makeApp())
      .delete('/api/pos/menu/items/item-1')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(204)
    expect(store.tables['menu_items']).toHaveLength(1)
    expect(store.tables['menu_items'][0]!['deleted_at']).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- pos/menu`
Expected: FAIL — cannot resolve `./menu.js`.

- [ ] **Step 3: Implement the router**

Create `apps/api/src/routes/pos/menu.ts`:

```ts
import { Router, type Request, type Response, type NextFunction } from 'express'
import { getServiceClient } from '../../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../../lib/auth.js'
import { isModuleEnabled } from '../../lib/modules.js'

const router = Router()

/**
 * POS module gate. Mirrors the `requireOrders` pattern already used by
 * routes/orders.ts — entitlement only, no subscription_status opinion.
 * Exported so the ticket, drawer, and tender routers reuse one definition
 * instead of each declaring their own copy.
 */
export async function requirePos(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authed = req as AuthenticatedRequest
  const enabled = await isModuleEnabled(authed.tenantId, 'pos')
  if (!enabled) {
    res.status(403).json({ error: 'POS module is not enabled' })
    return
  }
  next()
}

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

interface MenuOption {
  id: string
  name: string
  price_delta: string
  sort_order: number
}

interface MenuGroup {
  id: string
  name: string
  min_select: number
  max_select: number
  required: boolean
  options: MenuOption[]
}

interface MenuItemNode {
  id: string
  name: string
  price: string
  taxable: boolean
  kitchen_station: string | null
  available: boolean
  sort_order: number
  modifier_groups: MenuGroup[]
}

// ── GET /api/pos/menu/tree ──────────────────────────────────────────────────
// One round trip per table rather than nested selects: the tree is small
// (a menu, not a catalogue) and the mock store used in tests supports only
// flat selects.
router.get('/tree', requireAuth, requirePos, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const supabase = getServiceClient()

  const [cats, items, groups, options, links] = await Promise.all([
    supabase.from('menu_categories').select('*').eq('tenant_id', authed.tenantId),
    supabase.from('menu_items').select('*').eq('tenant_id', authed.tenantId),
    supabase.from('modifier_groups').select('*').eq('tenant_id', authed.tenantId),
    supabase.from('modifier_options').select('*').eq('tenant_id', authed.tenantId),
    supabase.from('menu_item_modifier_groups').select('*').eq('tenant_id', authed.tenantId),
  ])

  const live = <T extends { deleted_at?: unknown }>(rows: T[] | null): T[] =>
    (rows ?? []).filter((r) => !r.deleted_at)

  const optionRows = live(
    (options.data as (MenuOption & { group_id: string; deleted_at: unknown })[] | null) ?? []
  )
  const groupRows = live(
    (groups.data as (Omit<MenuGroup, 'options'> & { deleted_at: unknown })[] | null) ?? []
  )
  const itemRows = live(
    (items.data as
      | (Omit<MenuItemNode, 'modifier_groups'> & { category_id: string; deleted_at: unknown })[]
      | null) ?? []
  )
  const catRows = live(
    (cats.data as { id: string; name: string; sort_order: number; deleted_at: unknown }[] | null) ??
      []
  )
  const linkRows =
    (links.data as { item_id: string; group_id: string; sort_order: number }[] | null) ?? []

  const optionsByGroup = new Map<string, MenuOption[]>()
  for (const o of optionRows) {
    const list = optionsByGroup.get(o.group_id) ?? []
    list.push({ id: o.id, name: o.name, price_delta: o.price_delta, sort_order: o.sort_order })
    optionsByGroup.set(o.group_id, list)
  }

  const groupById = new Map<string, MenuGroup>()
  for (const g of groupRows) {
    groupById.set(g.id, {
      id: g.id,
      name: g.name,
      min_select: g.min_select,
      max_select: g.max_select,
      required: g.required,
      options: (optionsByGroup.get(g.id) ?? []).sort((a, b) => a.sort_order - b.sort_order),
    })
  }

  const groupsByItem = new Map<string, MenuGroup[]>()
  for (const l of linkRows.sort((a, b) => a.sort_order - b.sort_order)) {
    const g = groupById.get(l.group_id)
    if (!g) continue
    const list = groupsByItem.get(l.item_id) ?? []
    list.push(g)
    groupsByItem.set(l.item_id, list)
  }

  const itemsByCategory = new Map<string, MenuItemNode[]>()
  for (const i of itemRows) {
    const list = itemsByCategory.get(i.category_id) ?? []
    list.push({
      id: i.id,
      name: i.name,
      price: i.price,
      taxable: i.taxable,
      kitchen_station: i.kitchen_station,
      available: i.available,
      sort_order: i.sort_order,
      modifier_groups: groupsByItem.get(i.id) ?? [],
    })
    itemsByCategory.set(i.category_id, list)
  }

  const categories = catRows
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((c) => ({
      id: c.id,
      name: c.name,
      sort_order: c.sort_order,
      items: (itemsByCategory.get(c.id) ?? []).sort((a, b) => a.sort_order - b.sort_order),
    }))

  res.json({ categories })
})

// ── POST /api/pos/menu/categories ───────────────────────────────────────────
router.post(
  '/categories',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const body = req.body as Record<string, unknown>
    const name = trimmedString(body['name'])
    if (!name) {
      res.status(400).json({ error: 'name is required' })
      return
    }
    const sortOrder = typeof body['sort_order'] === 'number' ? body['sort_order'] : 0

    const supabase = getServiceClient()
    const { data, error } = await supabase
      .from('menu_categories')
      .insert({ tenant_id: authed.tenantId, name, sort_order: sortOrder })
      .select()
      .single()

    if (error || !data) {
      res.status(500).json({ error: 'Failed to create category' })
      return
    }
    res.status(201).json({ category: data })
  }
)

// ── POST /api/pos/menu/items ────────────────────────────────────────────────
router.post(
  '/items',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const body = req.body as Record<string, unknown>
    const name = trimmedString(body['name'])
    const categoryId = trimmedString(body['category_id'])
    if (!name || !categoryId) {
      res.status(400).json({ error: 'name and category_id are required' })
      return
    }
    const price = typeof body['price'] === 'number' ? body['price'] : 0
    if (price < 0) {
      res.status(400).json({ error: 'price must not be negative' })
      return
    }

    const supabase = getServiceClient()
    const { data, error } = await supabase
      .from('menu_items')
      .insert({
        tenant_id: authed.tenantId,
        category_id: categoryId,
        name,
        price,
        taxable: body['taxable'] !== false,
        kitchen_station: trimmedString(body['kitchen_station']) || null,
        available: body['available'] !== false,
        sort_order: typeof body['sort_order'] === 'number' ? body['sort_order'] : 0,
      })
      .select()
      .single()

    if (error || !data) {
      res.status(500).json({ error: 'Failed to create item' })
      return
    }
    res.status(201).json({ item: data })
  }
)

// ── PATCH /api/pos/menu/items/:id ───────────────────────────────────────────
router.patch(
  '/items/:id',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const body = req.body as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    if (typeof body['name'] === 'string') patch['name'] = body['name'].trim()
    if (typeof body['price'] === 'number') patch['price'] = body['price']
    if (typeof body['taxable'] === 'boolean') patch['taxable'] = body['taxable']
    if (typeof body['available'] === 'boolean') patch['available'] = body['available']
    if (typeof body['kitchen_station'] === 'string') {
      patch['kitchen_station'] = body['kitchen_station'].trim() || null
    }
    if (typeof body['sort_order'] === 'number') patch['sort_order'] = body['sort_order']

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: 'No updatable fields supplied' })
      return
    }

    const supabase = getServiceClient()
    const { data, error } = await supabase
      .from('menu_items')
      .update(patch)
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .select()
      .single()

    if (error || !data) {
      res.status(404).json({ error: 'Item not found' })
      return
    }
    res.json({ item: data })
  }
)

// ── DELETE /api/pos/menu/items/:id ──────────────────────────────────────────
// Soft delete. Kitchen tickets and receipts snapshot their line text, but the
// menu_item_id FK on order_line_items must keep resolving for reporting.
router.delete(
  '/items/:id',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const { error } = await supabase
      .from('menu_items')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)

    if (error) {
      res.status(404).json({ error: 'Item not found' })
      return
    }
    res.status(204).send()
  }
)

// ── POST /api/pos/menu/modifier-groups ──────────────────────────────────────
router.post(
  '/modifier-groups',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const body = req.body as Record<string, unknown>
    const name = trimmedString(body['name'])
    if (!name) {
      res.status(400).json({ error: 'name is required' })
      return
    }
    const minSelect = typeof body['min_select'] === 'number' ? body['min_select'] : 0
    const maxSelect = typeof body['max_select'] === 'number' ? body['max_select'] : 1
    if (minSelect > maxSelect) {
      res.status(400).json({ error: 'min_select must not exceed max_select' })
      return
    }

    const supabase = getServiceClient()
    const { data, error } = await supabase
      .from('modifier_groups')
      .insert({
        tenant_id: authed.tenantId,
        name,
        min_select: minSelect,
        max_select: maxSelect,
        required: body['required'] === true,
      })
      .select()
      .single()

    if (error || !data) {
      res.status(500).json({ error: 'Failed to create modifier group' })
      return
    }
    res.status(201).json({ group: data })
  }
)

// ── POST /api/pos/menu/modifier-options ─────────────────────────────────────
router.post(
  '/modifier-options',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const body = req.body as Record<string, unknown>
    const name = trimmedString(body['name'])
    const groupId = trimmedString(body['group_id'])
    if (!name || !groupId) {
      res.status(400).json({ error: 'name and group_id are required' })
      return
    }

    const supabase = getServiceClient()
    const { data, error } = await supabase
      .from('modifier_options')
      .insert({
        tenant_id: authed.tenantId,
        group_id: groupId,
        name,
        price_delta: typeof body['price_delta'] === 'number' ? body['price_delta'] : 0,
        sort_order: typeof body['sort_order'] === 'number' ? body['sort_order'] : 0,
      })
      .select()
      .single()

    if (error || !data) {
      res.status(500).json({ error: 'Failed to create modifier option' })
      return
    }
    res.status(201).json({ option: data })
  }
)

// ── POST /api/pos/menu/items/:itemId/modifier-groups/:groupId ───────────────
router.post(
  '/items/:itemId/modifier-groups/:groupId',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const { error } = await supabase.from('menu_item_modifier_groups').insert({
      tenant_id: authed.tenantId,
      item_id: req.params['itemId'],
      group_id: req.params['groupId'],
      sort_order:
        typeof (req.body as Record<string, unknown>)['sort_order'] === 'number'
          ? ((req.body as Record<string, unknown>)['sort_order'] as number)
          : 0,
    })

    if (error) {
      res.status(500).json({ error: 'Failed to link modifier group' })
      return
    }
    res.status(201).json({ linked: true })
  }
)

// ── DELETE /api/pos/menu/items/:itemId/modifier-groups/:groupId ─────────────
router.delete(
  '/items/:itemId/modifier-groups/:groupId',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const { error } = await supabase
      .from('menu_item_modifier_groups')
      .delete()
      .eq('item_id', req.params['itemId'])
      .eq('group_id', req.params['groupId'])
      .eq('tenant_id', authed.tenantId)

    if (error) {
      res.status(500).json({ error: 'Failed to unlink modifier group' })
      return
    }
    res.status(204).send()
  }
)

// ── DELETE /api/pos/menu/categories/:id ─────────────────────────────────────
router.delete(
  '/categories/:id',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const supabase = getServiceClient()
    const { error } = await supabase
      .from('menu_categories')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)

    if (error) {
      res.status(404).json({ error: 'Category not found' })
      return
    }
    res.status(204).send()
  }
)

export default router
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=apps/api -- pos/menu`
Expected: PASS, 8 tests.

If `menu_item_modifier_groups` assertions fail because the mock store's builder lacks a needed method, extend `__test-support__/supabase-mock.ts` — it is documented as intentionally narrow and extended case-by-case.

- [ ] **Step 5: Mount the router**

In `apps/api/src/index.ts`, add the import alongside the other route imports:

```ts
import posMenuRouter from './routes/pos/menu.js'
```

and mount it near the other `app.use` calls:

```ts
app.use('/api/pos/menu', posMenuRouter)
```

- [ ] **Step 6: Typecheck, lint, and commit**

```bash
npm run typecheck --workspace=apps/api
npm run lint
git add apps/api/src/routes/pos/menu.ts apps/api/src/routes/pos/menu.integration.test.ts apps/api/src/index.ts
git commit -m "feat(pos): menu CRUD routes under /api/pos/menu"
```

---

### Task 4: `packages/pos-core` — money, cart, and tender arithmetic

Pure functions, no React, no I/O. All arithmetic in integer cents. This package is consumed by the terminal and the KDS in the follow-up plan, and by the tender route in Task 8 for server-side split-tender validation — the prototype checked the split balance client-side only.

**Files:**

- Create: `packages/pos-core/package.json`
- Create: `packages/pos-core/tsconfig.json`
- Create: `packages/pos-core/src/money.ts`
- Create: `packages/pos-core/src/cart.ts`
- Create: `packages/pos-core/src/tender.ts`
- Create: `packages/pos-core/src/index.ts`
- Create: `packages/pos-core/src/money.test.ts`
- Create: `packages/pos-core/src/cart.test.ts`
- Create: `packages/pos-core/src/tender.test.ts`
- Modify: `apps/api/package.json` (add the dependency)

**Interfaces:**

- Consumes: nothing.
- Produces:
  - `toCents(dollars: number | string): number`
  - `toDollars(cents: number): string`
  - `CartLine { menuItemId: string; name: string; unitPriceCents: number; quantity: number; taxable: boolean; modifiers: CartModifier[] }`
  - `CartModifier { optionId: string; name: string; priceDeltaCents: number }`
  - `lineTotalCents(line: CartLine): number`
  - `CartTotals { subtotalCents: number; taxCents: number; tipCents: number; totalCents: number }`
  - `cartTotals(lines: CartLine[], taxRateBps: number, tipCents: number): CartTotals`
  - `TenderLeg { method: 'cash' | 'card' | 'gift_card'; amountCents: number }`
  - `tenderBalanceCents(totalCents: number, legs: TenderLeg[]): number`
  - `changeDueCents(amountDueCents: number, tenderedCents: number): number`

- [ ] **Step 1: Scaffold the package**

Create `packages/pos-core/package.json`:

```json
{
  "name": "@nuatis/pos-core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  }
}
```

Create `packages/pos-core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 2: Write the failing money tests**

Create `packages/pos-core/src/money.test.ts`:

```ts
import { describe, it, expect } from '@jest/globals'
import { toCents, toDollars } from './money.js'

describe('toCents', () => {
  it('converts a dollar number', () => {
    expect(toCents(12.34)).toBe(1234)
  })

  it('converts a numeric string as returned by Postgres numeric columns', () => {
    expect(toCents('12.34')).toBe(1234)
  })

  it('rounds half away from zero rather than truncating', () => {
    expect(toCents(0.005)).toBe(1)
  })

  it('survives the classic float case 0.1 + 0.2', () => {
    expect(toCents(0.1) + toCents(0.2)).toBe(30)
  })

  it('handles zero and whole dollars', () => {
    expect(toCents(0)).toBe(0)
    expect(toCents('5')).toBe(500)
  })

  it('throws on a non-numeric string rather than silently yielding NaN', () => {
    expect(() => toCents('abc')).toThrow()
  })
})

describe('toDollars', () => {
  it('formats cents with two decimal places', () => {
    expect(toDollars(1234)).toBe('12.34')
  })

  it('pads single-digit cents', () => {
    expect(toDollars(5)).toBe('0.05')
  })

  it('round-trips with toCents', () => {
    expect(toCents(toDollars(98765))).toBe(98765)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm run test --workspace=apps/api -- pos-core` will not find it yet. Instead run from the repo root once Jest is configured for the package; for now:

Run: `npx tsc --noEmit -p packages/pos-core`
Expected: FAIL — `src/money.ts` does not exist.

- [ ] **Step 4: Implement `money.ts`**

Create `packages/pos-core/src/money.ts`:

```ts
/**
 * All POS arithmetic is performed in integer cents.
 *
 * The database stores money as numeric(10,2) for consistency with the rest of
 * the schema (orders.balance_due is a generated numeric column), and the
 * Supabase client hands those back as strings. Converting at the boundary and
 * computing in integers avoids the penny-rounding errors that floating-point
 * dollar arithmetic produces — errors that split tender makes immediately
 * visible to a cashier counting a drawer.
 */

export function toCents(dollars: number | string): number {
  const n = typeof dollars === 'string' ? Number(dollars) : dollars
  if (!Number.isFinite(n)) {
    throw new Error(`toCents: not a finite number: ${String(dollars)}`)
  }
  // Math.round is half-up for positives and half-down for negatives; adding the
  // sign back makes it half-away-from-zero, so a -0.005 refund line rounds to
  // -1 rather than 0.
  const sign = n < 0 ? -1 : 1
  return sign * Math.round(Math.abs(n) * 100)
}

export function toDollars(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`toDollars: expected integer cents, got ${cents}`)
  }
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}
```

- [ ] **Step 5: Run to verify money tests pass**

Run: `npx tsc --noEmit -p packages/pos-core`
Expected: PASS (no type errors). Test execution is wired in Step 10.

- [ ] **Step 6: Write the failing cart tests**

Create `packages/pos-core/src/cart.test.ts`:

```ts
import { describe, it, expect } from '@jest/globals'
import { lineTotalCents, cartTotals, type CartLine } from './cart.js'

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    menuItemId: 'item-1',
    name: 'Burger',
    unitPriceCents: 1200,
    quantity: 1,
    taxable: true,
    modifiers: [],
    ...overrides,
  }
}

describe('lineTotalCents', () => {
  it('multiplies unit price by quantity', () => {
    expect(lineTotalCents(line({ quantity: 3 }))).toBe(3600)
  })

  it('adds modifier deltas before multiplying by quantity', () => {
    const withCheese = line({
      quantity: 2,
      modifiers: [{ optionId: 'opt-1', name: 'Cheese', priceDeltaCents: 150 }],
    })
    expect(lineTotalCents(withCheese)).toBe((1200 + 150) * 2)
  })

  it('supports a negative modifier delta', () => {
    const noBun = line({
      modifiers: [{ optionId: 'opt-2', name: 'No bun', priceDeltaCents: -100 }],
    })
    expect(lineTotalCents(noBun)).toBe(1100)
  })
})

describe('cartTotals', () => {
  it('returns zeros for an empty cart', () => {
    expect(cartTotals([], 875, 0)).toEqual({
      subtotalCents: 0,
      taxCents: 0,
      tipCents: 0,
      totalCents: 0,
    })
  })

  it('taxes only taxable lines', () => {
    const lines = [
      line({ unitPriceCents: 1000, taxable: true }),
      line({ menuItemId: 'item-2', name: 'Gift card', unitPriceCents: 2000, taxable: false }),
    ]
    // taxable base 1000 cents at 8.75% = 87.5 → 88 (half away from zero)
    const totals = cartTotals(lines, 875, 0)
    expect(totals.subtotalCents).toBe(3000)
    expect(totals.taxCents).toBe(88)
    expect(totals.totalCents).toBe(3088)
  })

  it('adds the tip to the total but never to the tax base', () => {
    const totals = cartTotals([line({ unitPriceCents: 1000 })], 1000, 500)
    expect(totals.taxCents).toBe(100)
    expect(totals.tipCents).toBe(500)
    expect(totals.totalCents).toBe(1000 + 100 + 500)
  })

  it('computes tax on the summed base, not per line, so rounding happens once', () => {
    // Three lines of 3.33 each: per-line 10% rounding would give 33+33+33=99,
    // but the correct single-rounding answer on 9.99 is 100.
    const lines = [
      line({ unitPriceCents: 333 }),
      line({ menuItemId: 'i2', unitPriceCents: 333 }),
      line({ menuItemId: 'i3', unitPriceCents: 333 }),
    ]
    expect(cartTotals(lines, 1000, 0).taxCents).toBe(100)
  })

  it('rejects a negative tip', () => {
    expect(() => cartTotals([], 0, -1)).toThrow()
  })
})
```

- [ ] **Step 7: Implement `cart.ts`**

Create `packages/pos-core/src/cart.ts`:

```ts
export interface CartModifier {
  optionId: string
  name: string
  priceDeltaCents: number
}

export interface CartLine {
  menuItemId: string
  name: string
  unitPriceCents: number
  quantity: number
  taxable: boolean
  modifiers: CartModifier[]
}

export interface CartTotals {
  subtotalCents: number
  taxCents: number
  tipCents: number
  totalCents: number
}

export function lineTotalCents(line: CartLine): number {
  const modifierDelta = line.modifiers.reduce((sum, m) => sum + m.priceDeltaCents, 0)
  return (line.unitPriceCents + modifierDelta) * line.quantity
}

/**
 * Tax is computed once on the summed taxable base rather than per line, so a
 * cart rounds a single time. Rounding each line independently drifts by a cent
 * per line against what the customer expects from the printed subtotal.
 *
 * `taxRateBps` is basis points: 875 = 8.75%.
 * The tip is added to the total but never enters the tax base — and it must
 * likewise be excluded from the Stripe Connect application-fee basis upstream.
 */
export function cartTotals(lines: CartLine[], taxRateBps: number, tipCents: number): CartTotals {
  if (tipCents < 0) throw new Error('cartTotals: tipCents must not be negative')
  if (taxRateBps < 0) throw new Error('cartTotals: taxRateBps must not be negative')

  let subtotalCents = 0
  let taxableBaseCents = 0
  for (const line of lines) {
    const total = lineTotalCents(line)
    subtotalCents += total
    if (line.taxable) taxableBaseCents += total
  }

  const taxCents = Math.round((taxableBaseCents * taxRateBps) / 10000)

  return {
    subtotalCents,
    taxCents,
    tipCents,
    totalCents: subtotalCents + taxCents + tipCents,
  }
}
```

- [ ] **Step 8: Write the failing tender tests**

Create `packages/pos-core/src/tender.test.ts`:

```ts
import { describe, it, expect } from '@jest/globals'
import { tenderBalanceCents, changeDueCents, type TenderLeg } from './tender.js'

describe('tenderBalanceCents', () => {
  it('returns the full total when nothing is tendered', () => {
    expect(tenderBalanceCents(5000, [])).toBe(5000)
  })

  it('subtracts each leg', () => {
    const legs: TenderLeg[] = [
      { method: 'cash', amountCents: 2000 },
      { method: 'card', amountCents: 1500 },
    ]
    expect(tenderBalanceCents(5000, legs)).toBe(1500)
  })

  it('returns zero on an exact split', () => {
    const legs: TenderLeg[] = [
      { method: 'cash', amountCents: 2500 },
      { method: 'card', amountCents: 2500 },
    ]
    expect(tenderBalanceCents(5000, legs)).toBe(0)
  })

  it('returns a negative balance on over-tender rather than clamping', () => {
    expect(tenderBalanceCents(5000, [{ method: 'cash', amountCents: 6000 }])).toBe(-1000)
  })

  it('rejects a negative leg amount', () => {
    expect(() => tenderBalanceCents(5000, [{ method: 'cash', amountCents: -1 }])).toThrow()
  })
})

describe('changeDueCents', () => {
  it('returns the over-tendered amount', () => {
    expect(changeDueCents(4750, 6000)).toBe(1250)
  })

  it('returns zero on exact tender', () => {
    expect(changeDueCents(4750, 4750)).toBe(0)
  })

  it('returns zero on under-tender — change is never negative', () => {
    expect(changeDueCents(4750, 2000)).toBe(0)
  })
})
```

- [ ] **Step 9: Implement `tender.ts` and `index.ts`**

Create `packages/pos-core/src/tender.ts`:

```ts
export type TenderMethod = 'cash' | 'card' | 'gift_card'

export interface TenderLeg {
  method: TenderMethod
  amountCents: number
}

/**
 * Remaining balance after the supplied legs. Negative means over-tender
 * (cash back is owed); the caller decides what to do about it rather than
 * having the sign clamped away here.
 */
export function tenderBalanceCents(totalCents: number, legs: TenderLeg[]): number {
  let paid = 0
  for (const leg of legs) {
    if (leg.amountCents < 0) {
      throw new Error('tenderBalanceCents: leg amountCents must not be negative')
    }
    paid += leg.amountCents
  }
  return totalCents - paid
}

export function changeDueCents(amountDueCents: number, tenderedCents: number): number {
  return Math.max(0, tenderedCents - amountDueCents)
}
```

Create `packages/pos-core/src/index.ts`:

```ts
export { toCents, toDollars } from './money.js'
export {
  lineTotalCents,
  cartTotals,
  type CartLine,
  type CartModifier,
  type CartTotals,
} from './cart.js'
export { tenderBalanceCents, changeDueCents, type TenderLeg, type TenderMethod } from './tender.js'
```

- [ ] **Step 10: Wire the package into the api workspace and run the tests**

In `apps/api/package.json`, add to `dependencies`:

```json
    "@nuatis/pos-core": "*",
```

The api Jest config does **not** resolve workspace packages through `node_modules` — it maps them to TypeScript source. In `apps/api/jest.config.ts`, add a second `moduleNameMapper` entry next to the existing `@nuatis/shared` one:

```ts
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@nuatis/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@nuatis/pos-core$': '<rootDir>/../../packages/pos-core/src/index.ts',
  },
```

Jest's `rootDir` is `apps/api`, so its default `testMatch` will not discover the test files that live in `packages/pos-core/src`. Add the package to `roots` so they run in the same suite:

```ts
  roots: ['<rootDir>/src', '<rootDir>/../../packages/pos-core/src'],
```

Then install and run:

```bash
npm install
npm run test --workspace=apps/api -- pos-core
```

Expected: PASS, 20 tests.

- [ ] **Step 11: Typecheck and commit**

```bash
npx tsc --noEmit -p packages/pos-core
npm run typecheck --workspace=apps/api
git add packages/pos-core apps/api/package.json package-lock.json
git commit -m "feat(pos): add @nuatis/pos-core with integer-cents money, cart, and tender math"
```

---

### Task 5: Migration 0196 — kitchen tickets

**Files:**

- Create: `supabase/migrations/0196_pos_kitchen_tickets.sql`

**Interfaces:**

- Consumes: `orders`, `locations`, `tenants`, `order_line_items` from Task 2.
- Produces: tables `kitchen_tickets`, `kitchen_ticket_items`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0196_pos_kitchen_tickets.sql`:

```sql
-- 0196_pos_kitchen_tickets
-- Kitchen tickets fired from a POS order, routed to a station, displayed and
-- bumped on the KDS.

CREATE TABLE kitchen_tickets (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- NOT NULL: a ticket with no location cannot be routed to a kitchen screen
  -- without leaking across a multi-location tenant.
  location_id  uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  order_id     uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  -- NULL station = unrouted; every KDS screen shows it.
  station      text,
  status       text NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','in_progress','ready','bumped')),
  ticket_number integer NOT NULL,
  fired_at     timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  ready_at     timestamptz,
  bumped_at    timestamptz,
  bumped_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kitchen_ticket_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ticket_id          uuid NOT NULL REFERENCES kitchen_tickets(id) ON DELETE CASCADE,
  order_line_item_id uuid REFERENCES order_line_items(id) ON DELETE SET NULL,
  -- Name and modifiers are snapshotted at fire time. Renaming or deleting a
  -- menu item later must never rewrite what the kitchen was told to cook.
  name               text NOT NULL,
  quantity           numeric(10,2) NOT NULL DEFAULT 1,
  modifiers          jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes              text,
  status             text NOT NULL DEFAULT 'queued'
                       CHECK (status IN ('queued','ready','bumped')),
  sort_order         integer NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_kitchen_tickets_tenant ON kitchen_tickets(tenant_id);
CREATE INDEX idx_kitchen_tickets_location_status
  ON kitchen_tickets(location_id, status);
CREATE INDEX idx_kitchen_tickets_order ON kitchen_tickets(order_id);
CREATE INDEX idx_kitchen_ticket_items_ticket ON kitchen_ticket_items(ticket_id);

-- Ticket numbers restart per location per day. Enforced here rather than in
-- application code so two registers firing simultaneously cannot collide.
CREATE UNIQUE INDEX idx_kitchen_tickets_number_per_day
  ON kitchen_tickets(location_id, ticket_number, (fired_at::date));

ALTER TABLE kitchen_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kitchen_tickets USING (tenant_id = current_tenant_id());

ALTER TABLE kitchen_ticket_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON kitchen_ticket_items USING (tenant_id = current_tenant_id());
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0196_pos_kitchen_tickets.sql
git commit -m "feat(pos): migration 0196 — kitchen tickets and ticket items"
```

---

### Task 6: Location-scoped POS WebSocket

`conversations-ws.ts` keys clients by tenant only. Broadcasting kitchen tickets through it would deliver location A's tickets to location B's kitchen screen — a cross-location data leak, not merely a display annoyance. This task adds a sibling module keyed by tenant **and** location, following the same `noServer: true` pattern and the same message-based auth handshake, without modifying the working conversations socket.

**Files:**

- Create: `apps/api/src/lib/pos-ws.ts`
- Create: `apps/api/src/lib/pos-ws.test.ts`
- Modify: `apps/api/src/index.ts` (register the upgrade path)

**Interfaces:**

- Consumes: `ws`, `jose`.
- Produces:
  - `initPosWs(): WebSocketServer`
  - `broadcastToLocation(tenantId: string, locationId: string, event: PosWsEvent): void`
  - `PosWsEvent = { type: 'ticket.fired' | 'ticket.updated' | 'ticket.bumped'; ticket: unknown }`
  - `__resetPosWsClientsForTest(): void`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/pos-ws.test.ts`:

```ts
import { jest, describe, it, expect, beforeEach } from '@jest/globals'

const { broadcastToLocation, __registerPosWsClientForTest, __resetPosWsClientsForTest } =
  await import('./pos-ws.js')

interface FakeSocket {
  readyState: number
  sent: string[]
  send: (data: string) => void
}

function fakeSocket(): FakeSocket {
  const sock: FakeSocket = {
    readyState: 1, // WebSocket.OPEN
    sent: [],
    send(data: string) {
      this.sent.push(data)
    },
  }
  return sock
}

const TENANT_A = 'tenant-a'
const TENANT_B = 'tenant-b'
const LOC_1 = 'loc-1'
const LOC_2 = 'loc-2'

beforeEach(() => {
  __resetPosWsClientsForTest()
})

describe('broadcastToLocation', () => {
  it('delivers to a client at the same tenant and location', () => {
    const sock = fakeSocket()
    __registerPosWsClientForTest(TENANT_A, LOC_1, sock as never)

    broadcastToLocation(TENANT_A, LOC_1, { type: 'ticket.fired', ticket: { id: 't1' } })

    expect(sock.sent).toHaveLength(1)
    expect(JSON.parse(sock.sent[0]!).type).toBe('ticket.fired')
  })

  it('does NOT deliver location 1 tickets to a location 2 screen', () => {
    const loc1 = fakeSocket()
    const loc2 = fakeSocket()
    __registerPosWsClientForTest(TENANT_A, LOC_1, loc1 as never)
    __registerPosWsClientForTest(TENANT_A, LOC_2, loc2 as never)

    broadcastToLocation(TENANT_A, LOC_1, { type: 'ticket.fired', ticket: { id: 't1' } })

    expect(loc1.sent).toHaveLength(1)
    expect(loc2.sent).toHaveLength(0)
  })

  it('does NOT deliver across tenants even for a colliding location id', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    __registerPosWsClientForTest(TENANT_A, LOC_1, a as never)
    __registerPosWsClientForTest(TENANT_B, LOC_1, b as never)

    broadcastToLocation(TENANT_A, LOC_1, { type: 'ticket.fired', ticket: { id: 't1' } })

    expect(a.sent).toHaveLength(1)
    expect(b.sent).toHaveLength(0)
  })

  it('skips sockets that are not OPEN', () => {
    const closing = fakeSocket()
    closing.readyState = 2 // CLOSING
    __registerPosWsClientForTest(TENANT_A, LOC_1, closing as never)

    broadcastToLocation(TENANT_A, LOC_1, { type: 'ticket.fired', ticket: { id: 't1' } })

    expect(closing.sent).toHaveLength(0)
  })

  it('is a no-op when nobody is listening', () => {
    expect(() =>
      broadcastToLocation(TENANT_A, LOC_1, { type: 'ticket.fired', ticket: { id: 't1' } })
    ).not.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- pos-ws`
Expected: FAIL — cannot resolve `./pos-ws.js`.

- [ ] **Step 3: Implement `pos-ws.ts`**

Create `apps/api/src/lib/pos-ws.ts`:

```ts
import { WebSocketServer, WebSocket } from 'ws'
import { jwtVerify } from 'jose'

/**
 * POS live updates, keyed by tenant AND location.
 *
 * Deliberately a sibling of conversations-ws.ts rather than an extension of
 * it: that socket keys clients by tenant only, which for a multi-location
 * restaurant would deliver location A's kitchen tickets to location B's
 * screen. That is a cross-location data leak, so the filtering happens here
 * on the server — never on the client.
 */

export interface PosWsEvent {
  type: 'ticket.fired' | 'ticket.updated' | 'ticket.bumped'
  ticket: unknown
}

// `${tenantId}:${locationId}` → connected clients
const locationClients = new Map<string, Set<WebSocket>>()

function key(tenantId: string, locationId: string): string {
  return `${tenantId}:${locationId}`
}

function addClient(tenantId: string, locationId: string, ws: WebSocket): void {
  const k = key(tenantId, locationId)
  if (!locationClients.has(k)) locationClients.set(k, new Set())
  locationClients.get(k)!.add(ws)
}

function removeClient(tenantId: string, locationId: string, ws: WebSocket): void {
  const k = key(tenantId, locationId)
  const set = locationClients.get(k)
  if (!set) return
  set.delete(ws)
  if (set.size === 0) locationClients.delete(k)
}

export function broadcastToLocation(tenantId: string, locationId: string, event: PosWsEvent): void {
  const clients = locationClients.get(key(tenantId, locationId))
  if (!clients || clients.size === 0) return
  const payload = JSON.stringify(event)
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload)
  }
}

export function initPosWs(): WebSocketServer {
  // noServer:true — upgrade routing is handled centrally in index.ts so the ws
  // library never subscribes to the HTTP server's upgrade event itself.
  const wss = new WebSocketServer({ noServer: true })

  wss.on('connection', (ws: WebSocket) => {
    let clientTenantId: string | null = null
    let clientLocationId: string | null = null

    // The upgrade itself carries no credentials, so the first message must be
    // an auth frame. Anything else closes the socket.
    ws.on('message', (raw) => {
      void (async () => {
        if (clientTenantId && clientLocationId) return // already authenticated

        let msg: { type?: string; token?: string; tenantId?: string; locationId?: string }
        try {
          msg = JSON.parse(String(raw)) as typeof msg
        } catch {
          ws.close(1008, 'Invalid message')
          return
        }

        if (!msg.token || msg.type !== 'auth' || !msg.tenantId || !msg.locationId) {
          ws.close(1008, 'Auth required')
          return
        }

        const secret = process.env['AUTH_SECRET']
        if (!secret) {
          ws.close(1011, 'Server misconfigured')
          return
        }

        try {
          const { payload } = await jwtVerify(msg.token, new TextEncoder().encode(secret), {
            audience: 'nuatis-api',
          })
          const tokenTenantId = (payload['tenantId'] ?? payload['org_id']) as string | undefined
          if (!tokenTenantId || tokenTenantId !== msg.tenantId) {
            ws.close(1008, 'Tenant mismatch')
            return
          }
          // A terminal token is scoped to one location; a staff token is not.
          // If the token carries a locationId it must match the requested one.
          const tokenLocationId = payload['locationId'] as string | undefined
          if (tokenLocationId && tokenLocationId !== msg.locationId) {
            ws.close(1008, 'Location mismatch')
            return
          }
        } catch {
          ws.close(1008, 'Invalid token')
          return
        }

        clientTenantId = msg.tenantId
        clientLocationId = msg.locationId
        addClient(clientTenantId, clientLocationId, ws)
        ws.send(JSON.stringify({ type: 'auth.ok' }))
      })()
    })

    ws.on('close', () => {
      if (clientTenantId && clientLocationId) {
        removeClient(clientTenantId, clientLocationId, ws)
      }
    })

    ws.on('error', () => {
      if (clientTenantId && clientLocationId) {
        removeClient(clientTenantId, clientLocationId, ws)
      }
    })
  })

  return wss
}

/** Test seam — register a socket without performing the auth handshake. */
export function __registerPosWsClientForTest(
  tenantId: string,
  locationId: string,
  ws: WebSocket
): void {
  addClient(tenantId, locationId, ws)
}

/** Test seam — clear all registered clients between tests. */
export function __resetPosWsClientsForTest(): void {
  locationClients.clear()
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=apps/api -- pos-ws`
Expected: PASS, 5 tests.

- [ ] **Step 5: Register the upgrade path**

In `apps/api/src/index.ts`, add the import:

```ts
import { initPosWs } from './lib/pos-ws.js'
```

Next to `const conversationsWss = initConversationsWs()`, add:

```ts
const posWss = initPosWs()
```

In the `server.on('upgrade', ...)` router, add a branch after the `/ws/conversations` branch:

```ts
  } else if (pathname === '/ws/pos') {
    posWss.handleUpgrade(req, socket, head, (ws) => {
      posWss.emit('connection', ws, req)
    })
```

And in the `server.listen` callback, next to the existing socket log lines:

```ts
console.info(`POS WebSocket listening at ws://localhost:${PORT}/ws/pos`)
```

Update the comment above the upgrade router — it currently says "All three WebSocket paths" — to say "All four WebSocket paths".

- [ ] **Step 6: Typecheck, lint, and commit**

```bash
npm run typecheck --workspace=apps/api
npm run lint
git add apps/api/src/lib/pos-ws.ts apps/api/src/lib/pos-ws.test.ts apps/api/src/index.ts
git commit -m "feat(pos): location-scoped POS websocket at /ws/pos"
```

---

### Task 7: Kitchen ticket routes — fire, list, bump

**Files:**

- Create: `apps/api/src/routes/pos/tickets.ts`
- Create: `apps/api/src/routes/pos/tickets.integration.test.ts`
- Modify: `apps/api/src/index.ts` (mount the router)

**Interfaces:**

- Consumes: `requirePos` from `./menu.js`; `broadcastToLocation` from `../../lib/pos-ws.js`; tables from Tasks 2 and 5.
- Produces: `POST /api/pos/tickets/fire`, `GET /api/pos/tickets`, `PATCH /api/pos/tickets/:id/status`. Default-exports an Express `Router`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routes/pos/tickets.integration.test.ts`:

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

const broadcastToLocation = jest.fn()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))
jest.unstable_mockModule('../../lib/pos-ws.js', () => ({
  broadcastToLocation,
  initPosWs: () => ({}),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000tkt0001'
const LOCATION_ID = 'bbbbbbbb-0000-0000-0000-00000loc0001'
const ORDER_ID = 'cccccccc-0000-0000-0000-00000ord0001'
const USER_ID = 'user-tkt-001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken(
    { sub: USER_ID, tenantId: TENANT_ID, role: 'owner', vertical: 'restaurant' },
    { secret: SECRET }
  )
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: ticketsRouter } = await import('./tickets.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/pos/tickets', ticketsRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  seedEntitledTenant(store, TENANT_ID, { modules: { pos: true } })
  broadcastToLocation.mockClear()
  store.tables['orders'] = [
    {
      id: ORDER_ID,
      tenant_id: TENANT_ID,
      location_id: LOCATION_ID,
      order_number: 'POS-1',
      status: 'confirmed',
      source: 'pos',
    },
  ]
  store.tables['order_line_items'] = [
    {
      id: 'line-1',
      order_id: ORDER_ID,
      tenant_id: TENANT_ID,
      menu_item_id: 'item-1',
      description: 'Burger',
      quantity: 2,
      unit_price: '12.00',
      modifiers: [{ option_id: 'opt-1', option_name: 'Cheese', price_delta: '1.50' }],
      notes: 'no pickles',
    },
  ]
  store.tables['menu_items'] = [
    {
      id: 'item-1',
      tenant_id: TENANT_ID,
      category_id: 'cat-1',
      name: 'Burger',
      kitchen_station: 'grill',
      deleted_at: null,
    },
  ]
  store.tables['kitchen_tickets'] = []
  store.tables['kitchen_ticket_items'] = []
})

describe('POST /api/pos/tickets/fire', () => {
  it('creates one ticket per station with snapshotted line text', async () => {
    const res = await request(makeApp())
      .post('/api/pos/tickets/fire')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ order_id: ORDER_ID })

    expect(res.status).toBe(201)
    expect(res.body.tickets).toHaveLength(1)
    expect(res.body.tickets[0].station).toBe('grill')

    const items = store.tables['kitchen_ticket_items'] ?? []
    expect(items).toHaveLength(1)
    expect(items[0]!['name']).toBe('Burger')
    expect(items[0]!['notes']).toBe('no pickles')
  })

  it('broadcasts to the order’s location, not tenant-wide', async () => {
    await request(makeApp())
      .post('/api/pos/tickets/fire')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ order_id: ORDER_ID })

    expect(broadcastToLocation).toHaveBeenCalledTimes(1)
    const [tenantArg, locationArg, event] = broadcastToLocation.mock.calls[0] as [
      string,
      string,
      { type: string },
    ]
    expect(tenantArg).toBe(TENANT_ID)
    expect(locationArg).toBe(LOCATION_ID)
    expect(event.type).toBe('ticket.fired')
  })

  it('splits lines across stations into separate tickets', async () => {
    store.tables['menu_items']!.push({
      id: 'item-2',
      tenant_id: TENANT_ID,
      category_id: 'cat-1',
      name: 'Caesar Salad',
      kitchen_station: 'cold',
      deleted_at: null,
    })
    store.tables['order_line_items']!.push({
      id: 'line-2',
      order_id: ORDER_ID,
      tenant_id: TENANT_ID,
      menu_item_id: 'item-2',
      description: 'Caesar Salad',
      quantity: 1,
      unit_price: '9.00',
      modifiers: [],
      notes: null,
    })

    const res = await request(makeApp())
      .post('/api/pos/tickets/fire')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ order_id: ORDER_ID })

    expect(res.status).toBe(201)
    expect(res.body.tickets).toHaveLength(2)
    expect(res.body.tickets.map((t: { station: string }) => t.station).sort()).toEqual([
      'cold',
      'grill',
    ])
  })

  it('404s for an order belonging to another tenant', async () => {
    store.tables['orders'] = [
      {
        id: ORDER_ID,
        tenant_id: 'someone-else',
        location_id: LOCATION_ID,
        order_number: 'POS-1',
        status: 'confirmed',
        source: 'pos',
      },
    ]

    const res = await request(makeApp())
      .post('/api/pos/tickets/fire')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ order_id: ORDER_ID })

    expect(res.status).toBe(404)
  })

  it('400s when the order has no line items', async () => {
    store.tables['order_line_items'] = []

    const res = await request(makeApp())
      .post('/api/pos/tickets/fire')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ order_id: ORDER_ID })

    expect(res.status).toBe(400)
  })
})

describe('PATCH /api/pos/tickets/:id/status', () => {
  beforeEach(() => {
    store.tables['kitchen_tickets'] = [
      {
        id: 'tkt-1',
        tenant_id: TENANT_ID,
        location_id: LOCATION_ID,
        order_id: ORDER_ID,
        station: 'grill',
        status: 'queued',
        ticket_number: 1,
      },
    ]
  })

  it('bumps a ticket and broadcasts', async () => {
    const res = await request(makeApp())
      .patch('/api/pos/tickets/tkt-1/status')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ status: 'bumped' })

    expect(res.status).toBe(200)
    expect(res.body.ticket.status).toBe('bumped')
    expect(broadcastToLocation).toHaveBeenCalledWith(
      TENANT_ID,
      LOCATION_ID,
      expect.objectContaining({ type: 'ticket.bumped' })
    )
  })

  it('rejects an unknown status', async () => {
    const res = await request(makeApp())
      .patch('/api/pos/tickets/tkt-1/status')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ status: 'incinerated' })

    expect(res.status).toBe(400)
  })
})

describe('GET /api/pos/tickets', () => {
  it('requires a location_id so a request can never span locations', async () => {
    const res = await request(makeApp())
      .get('/api/pos/tickets')
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(400)
  })

  it('returns only tickets for the requested location', async () => {
    store.tables['kitchen_tickets'] = [
      {
        id: 'tkt-1',
        tenant_id: TENANT_ID,
        location_id: LOCATION_ID,
        order_id: ORDER_ID,
        station: 'grill',
        status: 'queued',
        ticket_number: 1,
      },
      {
        id: 'tkt-2',
        tenant_id: TENANT_ID,
        location_id: 'other-location',
        order_id: ORDER_ID,
        station: 'grill',
        status: 'queued',
        ticket_number: 1,
      },
    ]

    const res = await request(makeApp())
      .get(`/api/pos/tickets?location_id=${LOCATION_ID}`)
      .set('Authorization', `Bearer ${await makeToken()}`)

    expect(res.status).toBe(200)
    expect(res.body.tickets).toHaveLength(1)
    expect(res.body.tickets[0].id).toBe('tkt-1')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- pos/tickets`
Expected: FAIL — cannot resolve `./tickets.js`.

- [ ] **Step 3: Implement the router**

Create `apps/api/src/routes/pos/tickets.ts`:

```ts
import { Router, type Request, type Response } from 'express'
import { getServiceClient } from '../../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../../lib/auth.js'
import { broadcastToLocation } from '../../lib/pos-ws.js'
import { requirePos } from './menu.js'

const router = Router()

const TICKET_STATUSES = ['queued', 'in_progress', 'ready', 'bumped'] as const
type TicketStatus = (typeof TICKET_STATUSES)[number]

interface LineRow {
  id: string
  menu_item_id: string | null
  description: string
  quantity: number
  modifiers: unknown
  notes: string | null
}

// ── POST /api/pos/tickets/fire ──────────────────────────────────────────────
// Fires an order to the kitchen, one ticket per distinct station. Line text and
// modifiers are snapshotted onto the ticket items so a later menu edit cannot
// rewrite what the kitchen was told to cook.
router.post(
  '/fire',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const orderId =
      typeof (req.body as Record<string, unknown>)['order_id'] === 'string'
        ? ((req.body as Record<string, unknown>)['order_id'] as string)
        : ''
    if (!orderId) {
      res.status(400).json({ error: 'order_id is required' })
      return
    }

    const supabase = getServiceClient()

    const { data: order } = await supabase
      .from('orders')
      .select('id, tenant_id, location_id')
      .eq('id', orderId)
      .eq('tenant_id', authed.tenantId)
      .maybeSingle<{ id: string; tenant_id: string; location_id: string | null }>()

    if (!order) {
      res.status(404).json({ error: 'Order not found' })
      return
    }
    if (!order.location_id) {
      // A ticket with no location cannot be routed to a kitchen screen without
      // risking delivery to another location's display.
      res.status(400).json({ error: 'Order has no location_id; cannot route to a kitchen' })
      return
    }

    const { data: lines } = await supabase
      .from('order_line_items')
      .select('id, menu_item_id, description, quantity, modifiers, notes')
      .eq('order_id', orderId)
      .eq('tenant_id', authed.tenantId)

    const lineRows = (lines ?? []) as LineRow[]
    if (lineRows.length === 0) {
      res.status(400).json({ error: 'Order has no line items to fire' })
      return
    }

    const menuItemIds = lineRows
      .map((l) => l.menu_item_id)
      .filter((id): id is string => typeof id === 'string')

    const stationByMenuItem = new Map<string, string | null>()
    if (menuItemIds.length > 0) {
      const { data: menuItems } = await supabase
        .from('menu_items')
        .select('id, kitchen_station')
        .eq('tenant_id', authed.tenantId)
      for (const mi of (menuItems ?? []) as { id: string; kitchen_station: string | null }[]) {
        stationByMenuItem.set(mi.id, mi.kitchen_station)
      }
    }

    // Group lines by station. A line whose item has no station (or no menu item
    // at all) lands on the unrouted ticket, keyed by empty string.
    const linesByStation = new Map<string, LineRow[]>()
    for (const line of lineRows) {
      const station = (line.menu_item_id ? stationByMenuItem.get(line.menu_item_id) : null) ?? ''
      const list = linesByStation.get(station) ?? []
      list.push(line)
      linesByStation.set(station, list)
    }

    // Ticket numbers restart per location per day. The unique index added in
    // 0196 is the real guard against two registers colliding; this read is
    // only to pick the next number.
    const today = new Date().toISOString().slice(0, 10)
    const { data: todaysTickets } = await supabase
      .from('kitchen_tickets')
      .select('ticket_number, fired_at')
      .eq('tenant_id', authed.tenantId)
      .eq('location_id', order.location_id)
    let nextNumber =
      ((todaysTickets ?? []) as { ticket_number: number; fired_at?: string }[])
        .filter((t) => (t.fired_at ?? today).slice(0, 10) === today)
        .reduce((max, t) => Math.max(max, t.ticket_number), 0) + 1

    const created: unknown[] = []

    for (const [station, stationLines] of linesByStation) {
      const { data: ticket, error: ticketError } = await supabase
        .from('kitchen_tickets')
        .insert({
          tenant_id: authed.tenantId,
          location_id: order.location_id,
          order_id: order.id,
          station: station || null,
          status: 'queued',
          ticket_number: nextNumber,
        })
        .select()
        .single<{ id: string }>()

      if (ticketError || !ticket) {
        res.status(500).json({ error: 'Failed to create kitchen ticket' })
        return
      }
      nextNumber += 1

      const itemRows = stationLines.map((line, index) => ({
        tenant_id: authed.tenantId,
        ticket_id: ticket.id,
        order_line_item_id: line.id,
        name: line.description,
        quantity: line.quantity,
        modifiers: line.modifiers ?? [],
        notes: line.notes,
        status: 'queued',
        sort_order: index,
      }))

      const { error: itemsError } = await supabase.from('kitchen_ticket_items').insert(itemRows)
      if (itemsError) {
        res.status(500).json({ error: 'Failed to create kitchen ticket items' })
        return
      }

      const payload = { ...ticket, station: station || null, items: itemRows }
      created.push(payload)
      broadcastToLocation(authed.tenantId, order.location_id, {
        type: 'ticket.fired',
        ticket: payload,
      })
    }

    res.status(201).json({ tickets: created })
  }
)

// ── GET /api/pos/tickets?location_id=&status= ───────────────────────────────
// location_id is required, not optional: without it a KDS request would span
// every location in the tenant.
router.get('/', requireAuth, requirePos, async (req: Request, res: Response): Promise<void> => {
  const authed = req as AuthenticatedRequest
  const locationId = typeof req.query['location_id'] === 'string' ? req.query['location_id'] : ''
  if (!locationId) {
    res.status(400).json({ error: 'location_id is required' })
    return
  }

  const supabase = getServiceClient()
  let query = supabase
    .from('kitchen_tickets')
    .select('*')
    .eq('tenant_id', authed.tenantId)
    .eq('location_id', locationId)

  const status = req.query['status']
  if (typeof status === 'string' && (TICKET_STATUSES as readonly string[]).includes(status)) {
    query = query.eq('status', status)
  }

  const { data, error } = await query
  if (error) {
    res.status(500).json({ error: 'Failed to load tickets' })
    return
  }

  const tickets = (data ?? []) as { id: string }[]
  const ticketIds = tickets.map((t) => t.id)

  const { data: items } = await supabase
    .from('kitchen_ticket_items')
    .select('*')
    .eq('tenant_id', authed.tenantId)

  const itemsByTicket = new Map<string, unknown[]>()
  for (const item of (items ?? []) as { ticket_id: string }[]) {
    if (!ticketIds.includes(item.ticket_id)) continue
    const list = itemsByTicket.get(item.ticket_id) ?? []
    list.push(item)
    itemsByTicket.set(item.ticket_id, list)
  }

  res.json({
    tickets: tickets.map((t) => ({ ...t, items: itemsByTicket.get(t.id) ?? [] })),
  })
})

// ── PATCH /api/pos/tickets/:id/status ───────────────────────────────────────
router.patch(
  '/:id/status',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const status = (req.body as Record<string, unknown>)['status']
    if (typeof status !== 'string' || !(TICKET_STATUSES as readonly string[]).includes(status)) {
      res.status(400).json({
        error: `status must be one of: ${TICKET_STATUSES.join(', ')}`,
      })
      return
    }
    const nextStatus = status as TicketStatus

    const now = new Date().toISOString()
    const patch: Record<string, unknown> = { status: nextStatus }
    if (nextStatus === 'in_progress') patch['started_at'] = now
    if (nextStatus === 'ready') patch['ready_at'] = now
    if (nextStatus === 'bumped') {
      patch['bumped_at'] = now
      patch['bumped_by'] = authed.appUserId
    }

    const supabase = getServiceClient()
    const { data, error } = await supabase
      .from('kitchen_tickets')
      .update(patch)
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .select()
      .single<{ id: string; location_id: string }>()

    if (error || !data) {
      res.status(404).json({ error: 'Ticket not found' })
      return
    }

    broadcastToLocation(authed.tenantId, data.location_id, {
      type: nextStatus === 'bumped' ? 'ticket.bumped' : 'ticket.updated',
      ticket: data,
    })

    res.json({ ticket: data })
  }
)

export default router
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=apps/api -- pos/tickets`
Expected: PASS, 9 tests.

- [ ] **Step 5: Mount the router**

In `apps/api/src/index.ts`:

```ts
import posTicketsRouter from './routes/pos/tickets.js'
```

```ts
app.use('/api/pos/tickets', posTicketsRouter)
```

- [ ] **Step 6: Typecheck, lint, and commit**

```bash
npm run typecheck --workspace=apps/api
npm run lint
git add apps/api/src/routes/pos/tickets.ts apps/api/src/routes/pos/tickets.integration.test.ts apps/api/src/index.ts
git commit -m "feat(pos): kitchen ticket fire, list, and bump routes"
```

---

### Task 8: Migration 0197 — cash drawer sessions and events

**Files:**

- Create: `supabase/migrations/0197_pos_cash_drawer.sql`

**Interfaces:**

- Consumes: `tenants`, `locations`, `users`, `orders`.
- Produces: tables `cash_drawer_sessions`, `cash_events`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0197_pos_cash_drawer.sql`:

```sql
-- 0197_pos_cash_drawer
-- Cash drawer shift sessions and the individual cash movements within them.

CREATE TABLE cash_drawer_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id     uuid NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  opened_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  closed_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  opened_at       timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz,
  opening_float   numeric(10,2) NOT NULL DEFAULT 0,
  -- Counted by the cashier at close; NULL until then.
  counted_total   numeric(10,2),
  -- Computed at close from opening_float plus the session's cash events.
  expected_total  numeric(10,2),
  -- counted minus expected. Positive = over, negative = short.
  variance        numeric(10,2),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE cash_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id  uuid NOT NULL REFERENCES cash_drawer_sessions(id) ON DELETE CASCADE,
  type        text NOT NULL
                CHECK (type IN ('sale','refund','paid_in','paid_out','drop')),
  -- Always stored positive; `type` carries the direction. A single signed
  -- column invites double-negation bugs when summing a drawer.
  amount      numeric(10,2) NOT NULL CHECK (amount >= 0),
  order_id    uuid REFERENCES orders(id) ON DELETE SET NULL,
  recorded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cash_sessions_tenant ON cash_drawer_sessions(tenant_id);
CREATE INDEX idx_cash_sessions_location_open
  ON cash_drawer_sessions(location_id, closed_at);
CREATE INDEX idx_cash_events_session ON cash_events(session_id);

-- At most one open drawer per location. Partial unique index, so closed
-- sessions do not collide.
CREATE UNIQUE INDEX idx_one_open_drawer_per_location
  ON cash_drawer_sessions(location_id)
  WHERE closed_at IS NULL;

ALTER TABLE cash_drawer_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cash_drawer_sessions USING (tenant_id = current_tenant_id());

ALTER TABLE cash_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cash_events USING (tenant_id = current_tenant_id());
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0197_pos_cash_drawer.sql
git commit -m "feat(pos): migration 0197 — cash drawer sessions and events"
```

---

### Task 9: Cash drawer routes

**Files:**

- Create: `apps/api/src/routes/pos/drawer.ts`
- Create: `apps/api/src/routes/pos/drawer.integration.test.ts`
- Modify: `apps/api/src/index.ts` (mount the router)

**Interfaces:**

- Consumes: `requirePos` from `./menu.js`; `toCents`, `toDollars` from `@nuatis/pos-core`; tables from Task 8.
- Produces: `POST /api/pos/drawer/sessions`, `GET /api/pos/drawer/sessions/current`, `POST /api/pos/drawer/sessions/:id/events`, `POST /api/pos/drawer/sessions/:id/close`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/routes/pos/drawer.integration.test.ts`:

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

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000drw0001'
const LOCATION_ID = 'bbbbbbbb-0000-0000-0000-00000loc0001'
const USER_ID = 'user-drw-001'
const SECRET = process.env['AUTH_SECRET'] ?? 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

async function makeToken(): Promise<string> {
  return mintTestToken(
    { sub: USER_ID, tenantId: TENANT_ID, role: 'owner', vertical: 'restaurant' },
    { secret: SECRET }
  )
}

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: drawerRouter } = await import('./drawer.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/pos/drawer', drawerRouter)
  return app
}

beforeEach(() => {
  store = createStore()
  seedEntitledTenant(store, TENANT_ID, { modules: { pos: true } })
  store.tables['cash_drawer_sessions'] = []
  store.tables['cash_events'] = []
})

describe('POST /api/pos/drawer/sessions', () => {
  it('opens a session with an opening float', async () => {
    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ location_id: LOCATION_ID, opening_float: 150.0 })

    expect(res.status).toBe(201)
    expect(res.body.session.location_id).toBe(LOCATION_ID)
    expect(res.body.session.closed_at).toBeFalsy()
  })

  it('refuses to open a second drawer at the same location', async () => {
    store.tables['cash_drawer_sessions'] = [
      {
        id: 'sess-1',
        tenant_id: TENANT_ID,
        location_id: LOCATION_ID,
        opening_float: '100.00',
        closed_at: null,
      },
    ]

    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ location_id: LOCATION_ID, opening_float: 150.0 })

    expect(res.status).toBe(409)
  })

  it('requires a location_id', async () => {
    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ opening_float: 150.0 })

    expect(res.status).toBe(400)
  })
})

describe('POST /api/pos/drawer/sessions/:id/events', () => {
  beforeEach(() => {
    store.tables['cash_drawer_sessions'] = [
      {
        id: 'sess-1',
        tenant_id: TENANT_ID,
        location_id: LOCATION_ID,
        opening_float: '100.00',
        closed_at: null,
      },
    ]
  })

  it('records a sale event', async () => {
    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions/sess-1/events')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ type: 'sale', amount: 25.5 })

    expect(res.status).toBe(201)
    expect(store.tables['cash_events']).toHaveLength(1)
  })

  it('rejects a negative amount — direction comes from type, not sign', async () => {
    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions/sess-1/events')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ type: 'paid_out', amount: -20 })

    expect(res.status).toBe(400)
  })

  it('rejects an unknown event type', async () => {
    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions/sess-1/events')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ type: 'skim', amount: 20 })

    expect(res.status).toBe(400)
  })

  it('refuses to record against a closed session', async () => {
    store.tables['cash_drawer_sessions'] = [
      {
        id: 'sess-1',
        tenant_id: TENANT_ID,
        location_id: LOCATION_ID,
        opening_float: '100.00',
        closed_at: '2026-09-10T02:00:00Z',
      },
    ]

    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions/sess-1/events')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ type: 'sale', amount: 25.5 })

    expect(res.status).toBe(409)
  })
})

describe('POST /api/pos/drawer/sessions/:id/close', () => {
  beforeEach(() => {
    store.tables['cash_drawer_sessions'] = [
      {
        id: 'sess-1',
        tenant_id: TENANT_ID,
        location_id: LOCATION_ID,
        opening_float: '100.00',
        closed_at: null,
      },
    ]
    store.tables['cash_events'] = [
      { id: 'e1', tenant_id: TENANT_ID, session_id: 'sess-1', type: 'sale', amount: '50.00' },
      { id: 'e2', tenant_id: TENANT_ID, session_id: 'sess-1', type: 'refund', amount: '10.00' },
      { id: 'e3', tenant_id: TENANT_ID, session_id: 'sess-1', type: 'paid_out', amount: '5.00' },
      { id: 'e4', tenant_id: TENANT_ID, session_id: 'sess-1', type: 'paid_in', amount: '20.00' },
    ]
  })

  it('computes expected total from float plus signed event sum', async () => {
    // 100 + 50 sale - 10 refund - 5 paid_out + 20 paid_in = 155.00
    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions/sess-1/close')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ counted_total: 155.0 })

    expect(res.status).toBe(200)
    expect(res.body.session.expected_total).toBe('155.00')
    expect(res.body.session.variance).toBe('0.00')
  })

  it('reports a short drawer as a negative variance', async () => {
    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions/sess-1/close')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ counted_total: 150.0 })

    expect(res.status).toBe(200)
    expect(res.body.session.variance).toBe('-5.00')
  })

  it('reports an over drawer as a positive variance', async () => {
    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions/sess-1/close')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({ counted_total: 157.25 })

    expect(res.status).toBe(200)
    expect(res.body.session.variance).toBe('2.25')
  })

  it('requires counted_total', async () => {
    const res = await request(makeApp())
      .post('/api/pos/drawer/sessions/sess-1/close')
      .set('Authorization', `Bearer ${await makeToken()}`)
      .send({})

    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- pos/drawer`
Expected: FAIL — cannot resolve `./drawer.js`.

- [ ] **Step 3: Implement the router**

Create `apps/api/src/routes/pos/drawer.ts`:

```ts
import { Router, type Request, type Response } from 'express'
import { toCents, toDollars } from '@nuatis/pos-core'
import { getServiceClient } from '../../lib/supabase.js'
import { requireAuth, type AuthenticatedRequest } from '../../lib/auth.js'
import { requirePos } from './menu.js'

const router = Router()

const CASH_EVENT_TYPES = ['sale', 'refund', 'paid_in', 'paid_out', 'drop'] as const
type CashEventType = (typeof CASH_EVENT_TYPES)[number]

/**
 * Direction of each event type on the drawer balance. Amounts are stored
 * unsigned and the direction lives here, so summing a drawer cannot
 * double-negate a refund.
 */
const EVENT_SIGN: Record<CashEventType, 1 | -1> = {
  sale: 1,
  paid_in: 1,
  refund: -1,
  paid_out: -1,
  drop: -1,
}

// ── POST /api/pos/drawer/sessions ───────────────────────────────────────────
router.post(
  '/sessions',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const body = req.body as Record<string, unknown>
    const locationId = typeof body['location_id'] === 'string' ? body['location_id'] : ''
    if (!locationId) {
      res.status(400).json({ error: 'location_id is required' })
      return
    }
    const openingFloat = typeof body['opening_float'] === 'number' ? body['opening_float'] : 0
    if (openingFloat < 0) {
      res.status(400).json({ error: 'opening_float must not be negative' })
      return
    }

    const supabase = getServiceClient()

    // The partial unique index in 0197 is the authoritative guard; this check
    // exists to return 409 instead of a raw constraint error.
    const { data: existing } = await supabase
      .from('cash_drawer_sessions')
      .select('id, closed_at')
      .eq('tenant_id', authed.tenantId)
      .eq('location_id', locationId)
    const open = ((existing ?? []) as { id: string; closed_at: string | null }[]).find(
      (s) => !s.closed_at
    )
    if (open) {
      res.status(409).json({ error: 'A drawer is already open at this location' })
      return
    }

    const { data, error } = await supabase
      .from('cash_drawer_sessions')
      .insert({
        tenant_id: authed.tenantId,
        location_id: locationId,
        opened_by: authed.appUserId,
        opening_float: openingFloat,
      })
      .select()
      .single()

    if (error || !data) {
      res.status(500).json({ error: 'Failed to open drawer session' })
      return
    }
    res.status(201).json({ session: data })
  }
)

// ── GET /api/pos/drawer/sessions/current?location_id= ───────────────────────
router.get(
  '/sessions/current',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const locationId = typeof req.query['location_id'] === 'string' ? req.query['location_id'] : ''
    if (!locationId) {
      res.status(400).json({ error: 'location_id is required' })
      return
    }

    const supabase = getServiceClient()
    const { data } = await supabase
      .from('cash_drawer_sessions')
      .select('*')
      .eq('tenant_id', authed.tenantId)
      .eq('location_id', locationId)

    const open = ((data ?? []) as { closed_at: string | null }[]).find((s) => !s.closed_at)
    res.json({ session: open ?? null })
  }
)

// ── POST /api/pos/drawer/sessions/:id/events ────────────────────────────────
router.post(
  '/sessions/:id/events',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const body = req.body as Record<string, unknown>
    const type = body['type']
    if (typeof type !== 'string' || !(CASH_EVENT_TYPES as readonly string[]).includes(type)) {
      res.status(400).json({ error: `type must be one of: ${CASH_EVENT_TYPES.join(', ')}` })
      return
    }
    const amount = body['amount']
    if (typeof amount !== 'number' || amount < 0) {
      res.status(400).json({
        error: 'amount must be a non-negative number; direction is carried by type',
      })
      return
    }

    const supabase = getServiceClient()
    const { data: session } = await supabase
      .from('cash_drawer_sessions')
      .select('id, closed_at')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .maybeSingle<{ id: string; closed_at: string | null }>()

    if (!session) {
      res.status(404).json({ error: 'Drawer session not found' })
      return
    }
    if (session.closed_at) {
      res.status(409).json({ error: 'Drawer session is already closed' })
      return
    }

    const { data, error } = await supabase
      .from('cash_events')
      .insert({
        tenant_id: authed.tenantId,
        session_id: session.id,
        type,
        amount,
        order_id: typeof body['order_id'] === 'string' ? body['order_id'] : null,
        recorded_by: authed.appUserId,
        note: typeof body['note'] === 'string' ? body['note'] : null,
      })
      .select()
      .single()

    if (error || !data) {
      res.status(500).json({ error: 'Failed to record cash event' })
      return
    }
    res.status(201).json({ event: data })
  }
)

// ── POST /api/pos/drawer/sessions/:id/close ─────────────────────────────────
router.post(
  '/sessions/:id/close',
  requireAuth,
  requirePos,
  async (req: Request, res: Response): Promise<void> => {
    const authed = req as AuthenticatedRequest
    const body = req.body as Record<string, unknown>
    const countedTotal = body['counted_total']
    if (typeof countedTotal !== 'number') {
      res.status(400).json({ error: 'counted_total is required' })
      return
    }

    const supabase = getServiceClient()
    const { data: session } = await supabase
      .from('cash_drawer_sessions')
      .select('id, opening_float, closed_at')
      .eq('id', req.params['id'])
      .eq('tenant_id', authed.tenantId)
      .maybeSingle<{ id: string; opening_float: string; closed_at: string | null }>()

    if (!session) {
      res.status(404).json({ error: 'Drawer session not found' })
      return
    }
    if (session.closed_at) {
      res.status(409).json({ error: 'Drawer session is already closed' })
      return
    }

    const { data: events } = await supabase
      .from('cash_events')
      .select('type, amount, session_id')
      .eq('tenant_id', authed.tenantId)

    // Integer cents throughout — a drawer reconciled with float arithmetic
    // produces phantom one-cent variances that a cashier cannot explain.
    let expectedCents = toCents(session.opening_float)
    for (const e of (events ?? []) as { type: string; amount: string; session_id: string }[]) {
      if (e.session_id !== session.id) continue
      const sign = EVENT_SIGN[e.type as CashEventType]
      if (!sign) continue
      expectedCents += sign * toCents(e.amount)
    }

    const countedCents = toCents(countedTotal)
    const varianceCents = countedCents - expectedCents

    const { data, error } = await supabase
      .from('cash_drawer_sessions')
      .update({
        closed_at: new Date().toISOString(),
        closed_by: authed.appUserId,
        counted_total: toDollars(countedCents),
        expected_total: toDollars(expectedCents),
        variance: toDollars(varianceCents),
        notes: typeof body['notes'] === 'string' ? body['notes'] : null,
      })
      .eq('id', session.id)
      .eq('tenant_id', authed.tenantId)
      .select()
      .single()

    if (error || !data) {
      res.status(500).json({ error: 'Failed to close drawer session' })
      return
    }
    res.json({ session: data })
  }
)

export default router
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test --workspace=apps/api -- pos/drawer`
Expected: PASS, 11 tests.

- [ ] **Step 5: Mount the router**

In `apps/api/src/index.ts`:

```ts
import posDrawerRouter from './routes/pos/drawer.js'
```

```ts
app.use('/api/pos/drawer', posDrawerRouter)
```

- [ ] **Step 6: Typecheck, lint, and commit**

```bash
npm run typecheck --workspace=apps/api
npm run lint
git add apps/api/src/routes/pos/drawer.ts apps/api/src/routes/pos/drawer.integration.test.ts apps/api/src/index.ts
git commit -m "feat(pos): cash drawer session, event, and close routes"
```

---

### Task 10: Terminal PIN authentication

A register signs in with a numeric PIN rather than an email and password. The minted token follows the pattern established by `mobile-auth.ts`: a dedicated `portalScope` claim plus a `locationId` claim scoping the register to one location. Per the established role-gate rule, a restricted-role login uses its own claim and never touches `requireAuth`'s role fallback.

**Files:**

- Create: `supabase/migrations/0198_pos_terminal_pin.sql`
- Create: `apps/api/src/lib/pos-pin.ts`
- Create: `apps/api/src/lib/pos-pin.test.ts`
- Create: `apps/api/src/routes/pos/terminal-auth.ts`
- Create: `apps/api/src/routes/pos/terminal-auth.integration.test.ts`
- Modify: `apps/api/src/index.ts` (mount the router)

**Interfaces:**

- Consumes: `node:crypto` (`scrypt`, `randomBytes`, `timingSafeEqual`), `jose`, `getServiceClient`. Deliberately no new dependency — the repo has no bcrypt or argon2 package, because `mobile-auth.ts` delegates password checking to Supabase Auth rather than hashing locally. A PIN cannot go through Supabase Auth, so it is hashed here with Node's built-in scrypt.
- Produces: `POST /api/pos/terminal/sign-in` returning `{ token, staff: { id, name }, locationId }`.
- Produces: `hashPin(pin: string): Promise<string>` and `verifyPin(pin: string, stored: string): Promise<boolean>` in `apps/api/src/lib/pos-pin.ts`, used by the staff-admin UI in the follow-up plan to set a PIN.

The staff table is **`staff_members`** (migration 0049) and its columns are **`name`** and **`is_active`** — not `staff`, `full_name`, or `active`. Using the wrong names yields a route that compiles, typechecks, and returns 401 for every valid PIN.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0198_pos_terminal_pin.sql`:

```sql
-- 0198_pos_terminal_pin
-- PIN sign-in for a POS register. The PIN is a convenience credential for a
-- shared physical device, never a password: it is scrypt-hashed, scoped to a
-- location, and cannot authenticate anything outside the POS portal scope.

ALTER TABLE staff_members ADD COLUMN IF NOT EXISTS pos_pin_hash text;
ALTER TABLE staff_members
  ADD COLUMN IF NOT EXISTS pos_location_ids uuid[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_staff_members_pos_pin
  ON staff_members(tenant_id)
  WHERE pos_pin_hash IS NOT NULL;
```

- [ ] **Step 1b: Write the PIN hashing helper, test first**

Create `apps/api/src/lib/pos-pin.test.ts`:

```ts
import { describe, it, expect } from '@jest/globals'
import { hashPin, verifyPin } from './pos-pin.js'

describe('pos pin hashing', () => {
  it('verifies a correct pin', async () => {
    const stored = await hashPin('4821')
    expect(await verifyPin('4821', stored)).toBe(true)
  })

  it('rejects an incorrect pin', async () => {
    const stored = await hashPin('4821')
    expect(await verifyPin('0000', stored)).toBe(false)
  })

  it('salts — the same pin hashes differently every time', async () => {
    expect(await hashPin('4821')).not.toBe(await hashPin('4821'))
  })

  it('returns false rather than throwing on a malformed stored value', async () => {
    expect(await verifyPin('4821', 'not-a-real-hash')).toBe(false)
  })
})
```

Run it and watch it fail (`Cannot find module './pos-pin.js'`), then create `apps/api/src/lib/pos-pin.ts`:

```ts
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number
) => Promise<Buffer>

const KEY_LENGTH = 64

/**
 * Scrypt rather than bcrypt: this repo has no bcrypt or argon2 dependency,
 * because mobile-auth.ts delegates password checking to Supabase Auth. A PIN
 * cannot go through Supabase Auth, and Node ships scrypt in core — so this is
 * a correct KDF with no new dependency.
 *
 * Stored format: `scrypt$<saltHex>$<keyHex>`.
 */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const key = await scryptAsync(pin, salt, KEY_LENGTH)
  return `scrypt$${salt}$${key.toString('hex')}`
}

export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const salt = parts[1] as string
  const expected = Buffer.from(parts[2] as string, 'hex')
  // A truncated or non-hex stored value yields a short buffer; timingSafeEqual
  // throws on a length mismatch, so reject before calling it.
  if (expected.length !== KEY_LENGTH) return false
  const actual = await scryptAsync(pin, salt, KEY_LENGTH)
  return timingSafeEqual(actual, expected)
}
```

Run: `npm run test --workspace=apps/api -- pos-pin`
Expected: PASS, 4 tests.

- [ ] **Step 2: Write the failing test**

Create `apps/api/src/routes/pos/terminal-auth.integration.test.ts`:

```ts
import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import { jwtVerify } from 'jose'
import { hashPin } from '../../lib/pos-pin.js'
import {
  createStore,
  createMockSupabase,
  type MockStore,
} from '../__test-support__/supabase-mock.js'

let store: MockStore = createStore()

jest.unstable_mockModule('@supabase/supabase-js', () => ({
  createClient: () => createMockSupabase(store),
}))

const TENANT_ID = 'aaaaaaaa-0000-0000-0000-00000trm0001'
const LOCATION_ID = 'bbbbbbbb-0000-0000-0000-00000loc0001'
const OTHER_LOCATION_ID = 'bbbbbbbb-0000-0000-0000-00000loc0002'
const SECRET = 'test-secret-for-unit-tests-only-32ch'
process.env['AUTH_SECRET'] = SECRET
process.env['SUPABASE_URL'] = 'https://mock.supabase.co'
process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'mock-service-key'

const { default: express } = await import('express')
const { default: request } = await import('supertest')
const { default: terminalRouter } = await import('./terminal-auth.js')

function makeApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/pos/terminal', terminalRouter)
  return app
}

// async: hashPin is a real scrypt call, not a sync helper.
beforeEach(async () => {
  store = createStore()
  store.tables['staff_members'] = [
    {
      id: 'staff-1',
      tenant_id: TENANT_ID,
      name: 'Dana Cashier',
      pos_pin_hash: await hashPin('4821'),
      pos_location_ids: [LOCATION_ID],
      is_active: true,
    },
  ]
})

describe('POST /api/pos/terminal/sign-in', () => {
  it('mints a token for a correct PIN', async () => {
    const res = await request(makeApp())
      .post('/api/pos/terminal/sign-in')
      .send({ tenant_id: TENANT_ID, location_id: LOCATION_ID, pin: '4821' })

    expect(res.status).toBe(200)
    expect(res.body.staff.name).toBe('Dana Cashier')
    expect(typeof res.body.token).toBe('string')
  })

  it('stamps portalScope=pos and the location on the token', async () => {
    const res = await request(makeApp())
      .post('/api/pos/terminal/sign-in')
      .send({ tenant_id: TENANT_ID, location_id: LOCATION_ID, pin: '4821' })

    const { payload } = await jwtVerify(
      res.body.token as string,
      new TextEncoder().encode(SECRET),
      { audience: 'nuatis-api' }
    )
    expect(payload['portalScope']).toBe('pos')
    expect(payload['locationId']).toBe(LOCATION_ID)
    expect(payload['tenantId']).toBe(TENANT_ID)
  })

  it('rejects a wrong PIN', async () => {
    const res = await request(makeApp())
      .post('/api/pos/terminal/sign-in')
      .send({ tenant_id: TENANT_ID, location_id: LOCATION_ID, pin: '0000' })

    expect(res.status).toBe(401)
  })

  it('rejects a staff member not assigned to the requested location', async () => {
    const res = await request(makeApp())
      .post('/api/pos/terminal/sign-in')
      .send({ tenant_id: TENANT_ID, location_id: OTHER_LOCATION_ID, pin: '4821' })

    expect(res.status).toBe(401)
  })

  it('rejects an inactive staff member', async () => {
    store.tables['staff_members']![0]!['is_active'] = false

    const res = await request(makeApp())
      .post('/api/pos/terminal/sign-in')
      .send({ tenant_id: TENANT_ID, location_id: LOCATION_ID, pin: '4821' })

    expect(res.status).toBe(401)
  })

  it('returns the same error shape for a wrong PIN and an unknown tenant', async () => {
    const wrongPin = await request(makeApp())
      .post('/api/pos/terminal/sign-in')
      .send({ tenant_id: TENANT_ID, location_id: LOCATION_ID, pin: '0000' })
    const unknownTenant = await request(makeApp())
      .post('/api/pos/terminal/sign-in')
      .send({ tenant_id: 'no-such-tenant', location_id: LOCATION_ID, pin: '4821' })

    expect(wrongPin.status).toBe(unknownTenant.status)
    expect(wrongPin.body).toEqual(unknownTenant.body)
  })

  it('requires tenant_id, location_id, and pin', async () => {
    const res = await request(makeApp()).post('/api/pos/terminal/sign-in').send({ pin: '4821' })
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test --workspace=apps/api -- pos/terminal-auth`
Expected: FAIL — cannot resolve `./terminal-auth.js`.

- [ ] **Step 4: Implement the route**

Create `apps/api/src/routes/pos/terminal-auth.ts`:

```ts
import { Router, type Request, type Response } from 'express'
import { SignJWT } from 'jose'
import { getServiceClient } from '../../lib/supabase.js'
import { verifyPin } from '../../lib/pos-pin.js'

const router = Router()

interface StaffRow {
  id: string
  tenant_id: string
  name: string | null
  pos_pin_hash: string | null
  pos_location_ids: string[] | null
  is_active: boolean
}

// ── POST /api/pos/terminal/sign-in ──────────────────────────────────────────
// A register signs in with a numeric PIN. The PIN is a convenience credential
// for a shared physical device, not a password — the minted token carries
// portalScope 'pos' and is bound to one location, so it can never be used to
// reach the rest of the platform.
router.post('/sign-in', async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Record<string, unknown>
  const tenantId = typeof body['tenant_id'] === 'string' ? body['tenant_id'] : ''
  const locationId = typeof body['location_id'] === 'string' ? body['location_id'] : ''
  const pin = typeof body['pin'] === 'string' ? body['pin'] : ''

  if (!tenantId || !locationId || !pin) {
    res.status(400).json({ error: 'tenant_id, location_id, and pin are required' })
    return
  }

  const secret = process.env['AUTH_SECRET']
  if (!secret) {
    res.status(503).json({ error: 'Auth not configured' })
    return
  }

  const supabase = getServiceClient()
  const { data } = await supabase
    .from('staff_members')
    .select('id, tenant_id, name, pos_pin_hash, pos_location_ids, is_active')
    .eq('tenant_id', tenantId)

  const candidates = ((data ?? []) as StaffRow[]).filter(
    (s) => s.is_active && s.pos_pin_hash && (s.pos_location_ids ?? []).includes(locationId)
  )

  // Compare against every candidate even after a match so the response time
  // does not reveal how many staff share a location or where in the list a
  // matching PIN sits.
  let matched: StaffRow | null = null
  for (const candidate of candidates) {
    const ok = await verifyPin(pin, candidate.pos_pin_hash as string)
    if (ok && !matched) matched = candidate
  }

  if (!matched) {
    // Identical shape for a wrong PIN, an unknown tenant, and an unassigned
    // location — a terminal login must not be an enumeration oracle.
    res.status(401).json({ error: 'Invalid PIN' })
    return
  }

  const token = await new SignJWT({
    sub: `pos:${matched.id}`,
    tenantId: matched.tenant_id,
    staffId: matched.id,
    locationId,
    portalScope: 'pos',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('nuatis-web')
    .setAudience('nuatis-api')
    // A register sits on a counter all day; a short expiry would force a
    // re-PIN mid-service. One shift is the right ceiling.
    .setExpirationTime('12h')
    .sign(new TextEncoder().encode(secret))

  res.json({
    token,
    staff: { id: matched.id, name: matched.name },
    locationId,
  })
})

export default router
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test --workspace=apps/api -- pos/terminal-auth`
Expected: PASS, 7 tests.

- [ ] **Step 6: Mount the router**

In `apps/api/src/index.ts`:

```ts
import posTerminalAuthRouter from './routes/pos/terminal-auth.js'
```

```ts
app.use('/api/pos/terminal', posTerminalAuthRouter)
```

Mount it alongside the other POS routers. It is deliberately not behind `requireAuth` — it _is_ the authentication endpoint. Confirm it sits inside whatever rate-limiting middleware the other auth routes use; check how `mobile-auth` is mounted and match it:

```bash
grep -n "mobile-auth\|mobileAuthRouter" apps/api/src/index.ts
```

- [ ] **Step 7: Run the full suite**

Run: `npm run test --workspace=apps/api`
Expected: PASS. The pre-existing suite (737+ tests) plus roughly 60 new ones.

- [ ] **Step 8: Typecheck, lint, and commit**

```bash
npm run typecheck --workspace=apps/api
npm run lint
git add supabase/migrations/0198_pos_terminal_pin.sql apps/api/src/lib/pos-pin.ts apps/api/src/lib/pos-pin.test.ts apps/api/src/routes/pos/terminal-auth.ts apps/api/src/routes/pos/terminal-auth.integration.test.ts apps/api/src/index.ts
git commit -m "feat(pos): terminal PIN sign-in with pos portal scope"
```

---

## Verification

After every task lands, confirm the whole thing holds together:

- [ ] `npm run test --workspace=apps/api` — full suite passes
- [ ] `npm run typecheck --workspace=apps/api` — clean
- [ ] `npx tsc --noEmit -p packages/pos-core` — clean
- [ ] `npm run lint` — clean at `--max-warnings 0`
- [ ] Migrations 0195–0198 apply in order against a scratch database
- [ ] `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'orders_source_check';` contains `'pos'`
- [ ] Every new table reports `rowsecurity = true`:
  ```sql
  SELECT tablename, rowsecurity FROM pg_tables
  WHERE tablename IN ('menu_categories','menu_items','modifier_groups',
    'modifier_options','menu_item_modifier_groups','kitchen_tickets',
    'kitchen_ticket_items','cash_drawer_sessions','cash_events');
  ```

## What this plan deliberately leaves out

Covered by the follow-up frontend plan: `apps/pos` (the register), `apps/kds` (the kitchen display), receipt rendering and delivery, the checkout UI state machine, and demo menu seeding.

Out of scope entirely for the demo, per the spec: real Stripe Terminal hardware, an offline queue, multi-device cart sync, password reset, staff-invite email, and per-denomination drawer counting.

One spec deviation worth recording: the spec proposed reusing `conversations-ws.ts` for KDS updates. Task 6 instead adds a sibling `pos-ws.ts`, because the existing socket keys clients by tenant only and location filtering cannot be added to it without changing behavior for conversations. Same mechanism and same pattern, separate registry.
