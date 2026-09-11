# Kitchen POS — Master Checklist

Companion to [the backend plan](2026-09-10-kitchen-pos-backend.md) and [the design spec](../specs/2026-09-10-kitchen-pos-kds-design.md).

The plan holds the code. This holds the **gates** — what must be true before a task starts, what proves it finished, and the six landmines that make a task look done when it isn't.

**Target:** demo-ready for sales calls — real DB, real orders, mocked card auth.

---

## Progress

| Phase                  | Tasks   | Status |
| ---------------------- | ------- | ------ |
| Pre-flight             | —       | ☐      |
| A — Entitlement + menu | 1, 2, 3 | ☐      |
| B — Shared math        | 4       | ☐      |
| C — Kitchen            | 5, 6, 7 | ☐      |
| D — Cash               | 8, 9    | ☐      |
| E — Terminal auth      | 10      | ☐      |
| Landmine guards        | L1–L6   | ☐      |
| Final verification     | —       | ☐      |

**Expected on completion:** 4 migrations (0195–0198), 4 route files, 1 new package, 1 new lib, **78 new tests** on top of the existing 737+.

---

## Dependency order

```
1 (module) ──┬── 3 (menu routes) ── 7 (ticket routes)
             │                         │
2 (0195) ────┘                    6 (pos-ws) ┘
             │
             ├── 5 (0196) ────────────┘
             │
             ├── 8 (0197) ── 9 (drawer routes)
             │                    │
4 (pos-core) ────────────────────┘
             │
            10 (terminal auth)
```

- **Task 3 exports `requirePos`** — Tasks 7 and 9 import it. Task 3 must land first.
- **Task 4 exports `toCents`/`toDollars`** — Task 9 imports them for drawer reconciliation.
- **Task 6 exports `broadcastToLocation`** — Task 7 imports it.
- **Task 10 is independent** of everything except the `staff_members` table; it can be built in parallel if you're running work concurrently.

---

## Pre-flight

Before Task 1 touches anything:

- [ ] On a feature branch, not `main` — current branch is `feat/ios-scaffold`, which is unrelated work
  ```bash
  git checkout main && git pull && git checkout -b feat/pos-kitchen-backend
  ```
- [ ] Baseline is green — know what was already failing before you add to it
  ```bash
  npm run test --workspace=apps/api
  ```
- [ ] Record the baseline test count, so "78 new" can actually be verified at the end
- [ ] Confirm `0194` is still the migration head; if someone landed `0195` meanwhile, renumber this plan's migrations rather than colliding
  ```bash
  ls supabase/migrations | tail -3
  ```
- [ ] A scratch/branch database exists for applying migrations — **not production**

---

## Phase A — Entitlement and menu

### Task 1 — `pos` module + `pos_only` product

- [ ] `pos-entitlement.test.ts` passes (10 tests)
- [ ] `settings-modules` and `verticals` suites still pass — both derive from the registry you just changed
- [ ] `pos_only` grants `pos` and `crm`, denies `maya` and `scheduling`
- [ ] Committed

### Task 2 — Migration 0195

- [ ] 5 menu tables created, each with RLS enabled and a `current_tenant_id()` policy
- [ ] **L1 guard** — `orders_source_check` now includes `'pos'` (see Landmines)
- [ ] `order_line_items.menu_item_id` and `.modifiers` added
- [ ] `orders.tip_amount` added
- [ ] Applies cleanly against the scratch DB
- [ ] Committed

### Task 3 — Menu CRUD routes

- [ ] `pos/menu.integration.test.ts` passes (7 tests)
- [ ] `requirePos` is **exported** — Tasks 7 and 9 depend on it
- [ ] Tenant isolation test passes: another tenant's categories are not returned
- [ ] Delete is a **soft** delete — historical tickets must keep resolving
- [ ] Router mounted in `index.ts` at `/api/pos/menu`
- [ ] Committed

---

## Phase B — Shared math

### Task 4 — `@nuatis/pos-core`

- [ ] `packages/pos-core` scaffolded with `package.json` + `tsconfig.json`
- [ ] **Jest wiring done** — `moduleNameMapper` entry AND `roots` entry in `apps/api/jest.config.ts`. Without the `roots` entry the tests silently never run and the task looks finished
- [ ] 25 tests pass — money 9, cart 8, tender 8
- [ ] `0.1 + 0.2` float test passes
- [ ] Tax rounds **once on the summed base**, not per line
- [ ] Tip is excluded from the tax base
- [ ] `npx tsc --noEmit -p packages/pos-core` clean
- [ ] Committed

---

## Phase C — Kitchen

### Task 5 — Migration 0196

- [ ] `kitchen_tickets.location_id` is `NOT NULL` — a nullable location is how cross-location leaks start
- [ ] Per-location-per-day unique index on `ticket_number` exists
- [ ] RLS on both tables
- [ ] Committed

### Task 6 — Location-scoped WebSocket

- [ ] `pos-ws.test.ts` passes (5 tests)
- [ ] **L5 guard** — the cross-location test genuinely fails when you break the filter. Comment out the location key and confirm the test goes red before moving on
- [ ] Upgrade path `/ws/pos` registered in the central router in `index.ts`
- [ ] The "All three WebSocket paths" comment updated to four
- [ ] Existing `/ws/conversations` behavior untouched — `conversations-ws.ts` should have zero diff
- [ ] Committed

### Task 7 — Ticket fire / list / bump

- [ ] `pos/tickets.integration.test.ts` passes (9 tests)
- [ ] Lines split across stations produce **separate tickets**
- [ ] Ticket items snapshot `name` and `modifiers` — renaming a menu item afterwards must not rewrite the ticket
- [ ] `GET /tickets` **requires** `location_id` (400 without it)
- [ ] Broadcast goes to `broadcastToLocation`, never a tenant-wide send
- [ ] An order with no `location_id` is rejected, not fired
- [ ] Router mounted
- [ ] Committed

---

## Phase D — Cash

### Task 8 — Migration 0197

- [ ] `cash_events.amount` has `CHECK (amount >= 0)` — direction lives in `type`, not the sign
- [ ] Partial unique index enforces one open drawer per location
- [ ] RLS on both tables
- [ ] Committed

### Task 9 — Drawer routes

- [ ] `pos/drawer.integration.test.ts` passes (11 tests)
- [ ] Second open drawer at the same location returns **409**, not a raw constraint error
- [ ] Variance arithmetic verified in all three directions: balanced `0.00`, short `-5.00`, over `2.25`
- [ ] Reconciliation uses `toCents`/`toDollars` — no float arithmetic anywhere in the close path
- [ ] Events against a closed session return 409
- [ ] Router mounted
- [ ] Committed

---

## Phase E — Terminal auth

### Task 10 — PIN sign-in

- [ ] Migration 0198 targets **`staff_members`** (not `staff`)
- [ ] `pos-pin.test.ts` passes (4 tests)
- [ ] `pos-pin.ts` uses `node:crypto` scrypt — **no new dependency added to `package.json`**
- [ ] `terminal-auth.integration.test.ts` passes (7 tests)
- [ ] Route selects `name` and `is_active` — the real column names
- [ ] Token carries `portalScope: 'pos'` + `locationId` + `tenantId`
- [ ] **L4 guard** — `requireAuth`'s role fallback is untouched (`lib/auth.ts` has zero diff)
- [ ] Wrong PIN, unknown tenant, and unassigned location all return an **identical** response — no enumeration oracle
- [ ] Every candidate is compared even after a match — no early return
- [ ] Mounted alongside `mobile-auth`, inside the same rate limiting
- [ ] Committed

---

## Landmine guards

Each of these makes a task look finished while being broken. Verify explicitly, not by assumption.

- [ ] **L1 — `orders.source`** accepts `'pos'`. A POS order insert fails at _runtime_, not build time. Same class as the `contact_source` bug that silently broke four routes.

  ```sql
  SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'orders_source_check';
  ```

  Must contain `'pos'`.

- [ ] **L2 — RLS form.** Every new policy uses `current_tenant_id()`. The KitchenPOS prototype uses `auth.jwt() -> 'app_metadata' ->> 'tenant_id'`; copying it produces a policy that never matches.

  ```bash
  grep -c "current_tenant_id()" supabase/migrations/019[5-8]*.sql   # expect 9
  grep -c "app_metadata" supabase/migrations/019[5-8]*.sql          # expect 0
  ```

- [ ] **L3 — money units.** New columns are `numeric(10,2)`; TypeScript arithmetic is integer cents. `orders.balance_due` is a generated numeric column — int cents in the schema would break it.

  ```bash
  grep -n "price_cents\|_cents  *int\|amount_cents" supabase/migrations/019[5-8]*.sql   # expect no output
  ```

- [ ] **L4 — role gate.** Terminal auth uses its own `portalScope` claim. `lib/auth.ts` must have no diff on this branch.

  ```bash
  git diff main --stat -- apps/api/src/lib/auth.ts   # expect no output
  ```

- [ ] **L5 — location scoping.** Kitchen tickets never cross locations. Filtering is server-side; client-side filtering still ships another location's order data to the browser.
      Verify by breaking it: remove `locationId` from the `pos-ws.ts` key, confirm the cross-location test fails, restore.

- [ ] **L6 — `pos_only` entitlement.** Dissolved during planning: `alwaysOn` only hides settings-UI toggle rows, it does not drive entitlement. Confirm no one "fixed" it by editing `alwaysOn` on `maya`/`crm`.
  ```bash
  git diff main -- apps/api/src/config/module-registry.ts | grep alwaysOn   # expect no output
  ```

---

## Final verification

- [ ] `npm run test --workspace=apps/api` — full suite green
- [ ] New test count is **78** above the recorded baseline. If it's lower, a file isn't being discovered — most likely the `pos-core` `roots` entry
- [ ] `npm run typecheck --workspace=apps/api` — clean
- [ ] `npx tsc --noEmit -p packages/pos-core` — clean
- [ ] `npm run lint` — clean at `--max-warnings 0`
- [ ] Migrations 0195–0198 apply **in order** against a fresh scratch DB
- [ ] RLS enabled on all 9 new tables:
  ```sql
  SELECT tablename, rowsecurity FROM pg_tables
  WHERE tablename IN ('menu_categories','menu_items','modifier_groups',
    'modifier_options','menu_item_modifier_groups','kitchen_tickets',
    'kitchen_ticket_items','cash_drawer_sessions','cash_events');
  ```
  All 9 rows `rowsecurity = true`.
- [ ] All six landmine guards above checked
- [ ] `git diff main --stat` reviewed — nothing touched outside `apps/api`, `packages/pos-core`, `supabase/migrations`

---

## Before the demo can run

Not part of the plan's tasks, but required before anything is demonstrable — do not discover these on the day:

- [ ] Migrations 0195–0198 applied to the **live** database (this project's migrations are applied deliberately, not automatically — several have sat pending in the past)
- [ ] `pos` module enabled on the demo tenant, or the tenant put on a plan that grants it
- [ ] Demo tenant has at least one `location` row — every POS route requires `location_id`
- [ ] A restaurant menu seeded for the demo tenant, with `kitchen_station` set on items so KDS routing is visible
- [ ] **Seeding kept out of production paths** — the prototype seeded demo data from inside hooks on an empty store, which would fire on a real merchant's first load
- [ ] At least one `staff_members` row with a `pos_pin_hash` and `pos_location_ids`, or nobody can sign in to the register

---

## Not in this plan

Tracked so they don't get silently dropped:

- [ ] **Follow-up plan: `apps/pos` + `apps/kds`** — register UI, kitchen display, checkout state machine, receipt rendering, demo menu seeding. Written after this backend lands
- [ ] **Slice 2: service verticals** — salon/spa/nail_bar/etc. on the shared terminal
- [ ] Archive `Nuatis-KitchenPOS` and `Nuatis-POS` once the menu-schema and checkout-state-machine ports are both verified

Out of scope entirely for demo-ready, per the spec: real Stripe Terminal hardware, offline queue, multi-device cart sync, password reset, staff-invite email, per-denomination drawer counting.

---

## Open risks to revisit

- [ ] **`services` vs `menu_items`** — genuinely different things (CPQ quote line vs menu item with modifier groups). Watch that they don't converge into a confusing overlap
- [ ] **Tips and the Connect application fee** — tips must not enter the platform fee basis. Confirm against the live Connect config (migration 0190) before payment work begins in the follow-up plan
- [ ] **`requireOrders` duplication** — reimplemented in both `orders.ts` and `order-templates.ts` despite `requireModule` existing in `lib/auth.ts`. Not touched by this plan (unrelated refactor), but worth a separate cleanup
- [ ] **`routes/` is 231 flat files.** `routes/pos/` is the first grouped namespace — precedent for breaking up the rest later
