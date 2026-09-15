# Kitchen POS + KDS — Design

**Date:** 2026-09-10
**Slice:** 1 of 4 (Kitchen POS terminal + Kitchen Display System)
**Target:** Demo-ready for sales calls — real DB, real orders, mocked card auth

---

## 1. Decision: POS is a module of the nuatis platform

POS is built **inside the `nuatis` monorepo**, sharing the database, tenant model, auth, and
payment stack with the rest of the platform. The two standalone prototypes
(`~/Documents/Nuatis/Nuatis-KitchenPOS`, `~/Documents/Nuatis/Nuatis-POS`) become reference
material, not source.

### Why not separate repos

The competing option was keeping POS in its own repo to avoid cluttering `nuatis`. Rejected for
three reasons:

1. **Customer identity splits.** A merchant running nuatis booking _and_ nuatis POS would have
   two unrelated customer records for the same human — split loyalty, gift cards, package
   balances, and no-show history. That seam is visible on day one and is effectively unfixable
   later: merging two divergent tenant/customer schemas across live merchants is a rewrite,
   whereas carving a POS service out of a shared schema later is a refactor. The risk is
   asymmetric, so we share now.
2. **`@nuatis/shared` is a workspace package.** A separate repo must either publish it (release
   infrastructure we do not want) or duplicate its types, which reintroduces the drift we are
   avoiding.
3. **POS consumes the highest-churn API surfaces** — orders, payments, inventory. Cross-repo
   changes become two coordinated PRs that CI cannot check together.

The clutter concern is real but misaimed: `apps/` grows from 4 entries to 6, which is not
clutter. The actual clutter is `apps/api/src/routes/` — **231 files in one flat directory**.
This spec therefore introduces `apps/api/src/routes/pos/` as the first grouped route namespace.

### Selling POS standalone

A restaurant that only wants POS is served by a **plan and a module flag, not a fork**:

- add `'pos'` to `ModuleId` in `apps/api/src/config/module-registry.ts`
- add a POS-only plan to `PLANS` in `apps/api/src/config/stripe-plans.ts`

Such a merchant gets a narrower nav and a narrower bill on the same data model, and upgrading
to the full platform later is a module toggle — no migration, no re-onboarding. This is a
better standalone story than a separate stack provides.

---

## 2. Architecture

```
nuatis/
  apps/api/src/routes/pos/     ← POS routes, grouped (NOT added to the flat 231)
    menu.ts                      menu categories, items, modifier groups/options
    tickets.ts                   kitchen ticket lifecycle + bump
    drawer.ts                    cash drawer sessions and events
    terminal-auth.ts             PIN sign-in for a register
  apps/pos                     ← register terminal (restaurant vertical first)
  apps/kds                     ← kitchen display screen
  packages/pos-core            ← cart math, tender math, checkout state machine
```

`packages/pos-core` holds pure functions and the checkout state machine, shared by `apps/pos`
and reusable by the later service-vertical terminal. No React, no I/O — so it is unit-testable
in isolation and portable to server-side validation.

Two apps rather than one: the KDS runs on a fixed kitchen screen with no cart and a different
auth scope; the terminal runs on a register. Separate deployables, one API — the same pattern
`web`, `mobile`, and `ios` already follow.

---

## 3. Data model

Migrations start at **0195** (0194 is the current head).

### Reused as-is

`orders` (0138, `location_id` added in 0153) is a good fit for a POS ticket. It already has
`fulfillment_type` including `'dine_in'`, a `'ready'` status, `payment_status`, `amount_paid`,
and a generated `balance_due`. Also reused: `payments`, `refunds`, `inventory`, `contacts`,
`staff`, `locations`, `gift_cards`, `promo_codes`, `stripe_connect`.

### New tables

**Menu** (ported in shape from KitchenPOS `20260502120100_menu.sql`, rewritten to nuatis
conventions):

- `menu_categories` — tenant_id, name, sort_order, deleted_at
- `menu_items` — tenant_id, category_id, name, price, taxable, image_url, `kitchen_station`
- `modifier_groups` — tenant_id, name, min_select, max_select, required
- `modifier_options` — group_id, name, price_delta, sort_order
- `menu_item_modifier_groups` — junction (item_id, group_id, sort_order)

`menu_items.kitchen_station` is the routing key the KDS filters on.

**Kitchen tickets:**

- `kitchen_tickets` — tenant_id, location_id, order_id, station, status
  (`queued` / `in_progress` / `ready` / `bumped`), fired_at, bumped_at, bumped_by
- `kitchen_ticket_items` — ticket_id, order_item reference, name snapshot, quantity,
  modifier snapshot, per-item bump state

Tickets snapshot item names and modifiers at fire time so that editing the menu later does not
rewrite kitchen history.

**Cash drawer:**

- `cash_drawer_sessions` — tenant_id, location_id, staff_id, opened_at, closed_at,
  opening_float, counted_total, expected_total, variance
- `cash_events` — session_id, type (`sale` / `refund` / `paid_in` / `paid_out` / `drop`),
  amount, order_id, note

**Order additions** (ALTER on existing tables): tip amount, and split-tender legs recorded as
multiple `payments` rows against one order rather than a new table.

---

## 4. Conventions that must be honored

These are the places where copying the KitchenPOS prototype would introduce bugs.

### L1 — `orders.source` CHECK must be widened _(landmine)_

```sql
source text NOT NULL DEFAULT 'staff' CHECK (source IN ('staff','maya'))
```

POS orders need `source = 'pos'`. Inserting without widening this constraint fails at runtime,
not at build time. This is the same failure class as the `contact_source` enum bug that
silently broke four contact-creating routes. **Widen the constraint in the first POS
migration**, and add a test that creates an order with `source = 'pos'`.

### L2 — RLS uses `current_tenant_id()`, not the JWT path

nuatis policies read:

```sql
CREATE POLICY tenant_isolation ON <table> USING (tenant_id = current_tenant_id());
```

KitchenPOS uses `auth.jwt() -> 'app_metadata' ->> 'tenant_id'`. **Do not copy KitchenPOS
policies.** Every new POS table gets RLS enabled with the `current_tenant_id()` form, matching
the 56 policies already verified in production.

### L3 — Money is `numeric(10,2)` in the database, integer cents in application code

All 195 migrations use `numeric(10,2)` dollars, and `orders.balance_due` is a generated column
depending on that type. KitchenPOS uses `int` cents. **New POS tables use `numeric(10,2)`** for
schema consistency.

Inside `packages/pos-core`, all arithmetic is performed in **integer cents**, converting at the
API boundary. Floating-point arithmetic on dollar values is forbidden — it is the standard
source of penny-rounding errors in tender and split-payment math, and split tender makes those
errors visible immediately.

### L4 — Terminal auth follows the portalScope pattern

`apps/api/src/routes/mobile-auth.ts` mints:

```ts
{ sub: user.authjs_user_id, appUserId: user.id, role: user.role,
  vertical: tenant?.vertical, ...(role === 'staff' ? { portalScope: 'staff' } : {}) }
```

Terminal PIN sign-in mints the same shape with `portalScope: 'pos'` plus a `locationId` claim
scoping the register to one location. Per the established role-gate rule, a restricted-role
login uses its own claim and **never touches `requireAuth`'s role fallback**.

---

## 5. KDS live updates

`apps/api/src/lib/conversations-ws.ts` already provides an authenticated, tenant-scoped
WebSocket broadcast:

```ts
export function broadcastToTenant(tenantId: string, event: ConversationsWsEvent): void
```

The KDS reuses this rather than introducing Supabase Realtime — one live-update mechanism in
the codebase, not two.

**L5 — the broadcast is tenant-scoped, not location-scoped.** A multi-location restaurant would
have the kitchen at location A receiving location B's tickets. The fix is to include
`locationId` in the event payload and filter on the server before sending. Client-side
filtering is not acceptable even for the demo, because it leaks another location's order data
to the browser.

---

## 6. Module and plan registration

- `ModuleId` gains `'pos'`; `MODULES` gains a `ModuleDef` with `minPlan` and `defaultOn: false`.
- `PLANS` gains a POS-only plan whose `modules` array contains `pos` and `crm` but not the
  booking/pipeline suite.
- POS routes are guarded by a module check following the existing `requireOrders` pattern.

**L6 — `maya` and `crm` are `alwaysOn: true`.** A POS-only tenant currently cannot turn them
off. Resolution: `crm` stays on (POS genuinely needs a customer record for receipts, loyalty,
and gift cards) but CRM surfaces are hidden from POS-only nav; `maya` becomes genuinely
optional by removing its `alwaysOn` flag and relying on plan entitlement instead.

`requireOrders` is currently duplicated in `orders.ts` and `order-templates.ts`. Since this
slice adds several more module guards, the guard moves to shared middleware as part of the
work — a targeted improvement to code being touched, not a general refactor.

---

## 7. Scope

### In scope

Menu CRUD; order building with modifiers; send-to-kitchen; KDS display, bump, and station
routing; cash drawer open/close with variance; cash tender with change due; split tender;
tips; receipt generation; terminal PIN auth; `pos` module and POS-only plan.

### Out of scope for this slice

Real Stripe Terminal hardware (card auth is a simulated 2-second approval, with the payment
row written as if real so the Terminal SDK drops into a single seam later); offline queue and
service worker; multi-device cart sync; password reset; staff-invite email; per-denomination
drawer counting; the service-vertical terminal (salon, spa, and the rest — slice 2).

Nothing in the in-scope list is throwaway: every flow writes to real tables through real
endpoints.

---

## 8. Salvage from the prototypes

**Port:** the menu/modifier schema _shape_ from KitchenPOS (rewritten per L2 and L3); the
KitchenPOS menu CRUD route logic; `KdsScreen.tsx` from `Nuatis-POS/artifacts` as a visual
reference; the checkout state machine (`idle → tip → processing → receipt → completed`) and
split-tender design from the Nuatis-POS prototype, which the audit assessed as sound.

**Do not port:** KitchenPOS's `tenants`, `locations`, `staff_members`, `payments`, `refunds`,
`audit_log` tables or its auth routes — nuatis's equivalents are in production and better. Its
17-migration backend is a weaker parallel build of what already runs.

**Version control.** Neither prototype folder is a git repository; both resolve to a stray repo
in the home directory whose working tree shows unrelated mass deletions. Before porting, each
folder gets its own `git init` and an initial commit so the reference has a rollback point
independent of nuatis. The originals stay on disk untouched until the port is verified.

---

## 9. Testing

Follow existing conventions: `*.integration.test.ts` alongside routes, Jest, against the real
schema.

- `pos/menu.integration.test.ts` — CRUD, modifier group linkage, tenant isolation
- `pos/tickets.integration.test.ts` — fire to kitchen, station routing, bump, snapshot
  immutability after menu edit
- `pos/drawer.integration.test.ts` — open, events, close with correct variance
- `pos-core` unit tests — cart math, tax, tender, split-tender balance, change due, all in
  integer cents
- explicit regression test: order insert with `source = 'pos'` (guards L1)
- explicit regression test: KDS broadcast does not deliver location A's ticket to location B
  (guards L5)

---

## 10. Open risks

1. **Restaurant menu vs `services`.** nuatis models `services` (CPQ, migration 0012) and now
   also `menu_items`. These are genuinely different things — a quote line item versus a menu
   item with modifier groups — but the boundary needs watching so the two do not converge into
   a confusing overlap.
2. **Demo tenant data.** Per existing project history, demo seeding has needed cleanup before.
   The kitchen demo needs a seeded restaurant menu, and that seeding must be explicitly
   separated from production paths rather than firing on an empty store the way the prototype
   hooks did.
3. **Tips and Stripe Connect application fee.** Tips must not be included in the platform fee
   basis. Worth confirming against the live Connect configuration (migration 0190) before
   payments work begins.
