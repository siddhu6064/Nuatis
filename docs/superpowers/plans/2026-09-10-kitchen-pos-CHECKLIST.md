# Kitchen POS Backend — Verification Checklist

Companion to [the backend plan](2026-09-10-kitchen-pos-backend.md) and [the design spec](../specs/2026-09-10-kitchen-pos-kds-design.md).

**Status: backend complete.** Branch `feat/pos-kitchen-backend`, 17 commits, migrations live in production.

Every box below is ticked only if it was actually verified, and every command shows the output you should get. Run them yourself — that is the point of this document. Anything not done is left unticked and says why.

---

## The numbers

|                  |                                                                             |
| ---------------- | --------------------------------------------------------------------------- |
| Test suite       | **1779 passing / 223 suites** (baseline was 1635 / 212)                     |
| New tests        | **144** (plan estimated 85 — six bugs found in flight each earned coverage) |
| Migrations       | 0195–0198, **applied to production 2026-09-11**                             |
| New tables       | 9, all with RLS and a `current_tenant_id()` policy                          |
| Typecheck / lint | clean, `--max-warnings 0`                                                   |

```bash
npm run test --workspace=apps/api        # Tests: 1779 passed, 1779 total
npm run typecheck --workspace=apps/api   # no output
npx tsc --noEmit -p packages/pos-core    # no output
npm run lint                             # no output
```

> One caveat on the suite: two **pre-existing** flaky tests (`security-hardening-misc`, `voice/tenant-helpers`) are wall-clock timing assertions that failed once under parallel load and passed on re-run and in isolation. Not caused by this work — tracked as a separate task. If you get 1777, re-run before worrying.

---

## What shipped

| Phase | Contents                                                         | Tests                         |
| ----- | ---------------------------------------------------------------- | ----------------------------- |
| A     | `pos` module + `pos_only` product; migration 0195; menu CRUD     | 10 + 14                       |
| B     | `@nuatis/pos-core` — integer-cents money / cart / tender         | 41                            |
| C     | Migration 0196; location-scoped `/ws/pos`; ticket fire/list/bump | 7 + 6 + 19                    |
| D     | Migration 0197; drawer sessions / events / close                 | 22                            |
| E     | Migration 0198; scrypt PIN hashing; register sign-in             | 8 + 11                        |
| —     | `fix(auth)` portalScope confinement (see L4)                     | 6 of the 24 in `auth.test.ts` |

Exact per-file counts:

```bash
for f in config/pos-entitlement lib/pos-ws lib/pos-service-date lib/pos-pin \
         routes/pos/menu.integration routes/pos/tickets.integration \
         routes/pos/drawer.integration routes/pos/terminal-auth.integration; do
  printf "%-40s %s\n" "$f" "$(grep -cE '^\s*it\(' apps/api/src/$f.test.ts)"
done
```

```
config/pos-entitlement                   10
lib/pos-ws                                7
lib/pos-service-date                      6
lib/pos-pin                               8
routes/pos/menu.integration              14
routes/pos/tickets.integration           19
routes/pos/drawer.integration            22
routes/pos/terminal-auth.integration     11
```

---

## Landmine guards

The six things that make a task look finished while being broken. L1, L2 and L3 are now verified **against the production database**, not by reading files.

### L1 — `orders.source` accepts `'pos'` ✅

A POS order insert fails at _runtime_, not build time — the same class as the `contact_source` bug that silently broke four contact-creating routes.

```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'orders_source_check';
```

```
CHECK ((source = ANY (ARRAY['staff'::text, 'maya'::text, 'pos'::text])))
```

✅ Verified live 2026-09-11.

### L2 — RLS uses `current_tenant_id()`, never the JWT path ✅

The KitchenPOS prototype uses `auth.jwt() -> 'app_metadata' ->> 'tenant_id'`; copying it produces a policy that never matches.

```sql
SELECT count(*) FILTER (WHERE qual LIKE '%current_tenant_id%') AS correct,
       count(*) FILTER (WHERE qual LIKE '%app_metadata%')      AS wrong
FROM pg_policies WHERE schemaname='public' AND tablename IN
  ('menu_categories','menu_items','modifier_groups','modifier_options',
   'menu_item_modifier_groups','kitchen_tickets','kitchen_ticket_items',
   'cash_drawer_sessions','cash_events');
```

```
correct = 9, wrong = 0
```

✅ Verified live. (Source-level grep returns 10 and 1 — the extra hits are the explanatory comment in 0195's header, not policies.)

### L3 — money is `numeric(10,2)` in SQL, integer cents in TypeScript ✅

`orders.balance_due` is a generated numeric column; int cents in the schema would break it.

```bash
grep -n "_cents" supabase/migrations/019[5-8]*.sql   # no output
```

✅ No cents columns. All arithmetic in `packages/pos-core` is integer cents.

### L4 — restricted-scope confinement ⚠️ **guard rewritten — read this**

The original guard said _"`lib/auth.ts` must have zero diff."_ **That guard was wrong, and satisfying it would have shipped a security hole.**

The existing gate only confined `portalScope === 'staff'`:

```ts
if (payload['portalScope'] === 'staff' && !req.originalUrl.startsWith('/api/staff-portal')) {
```

Any other scope fell through the branch and reached the **entire API**. The POS register token would have been able to read `/api/contacts`, `/api/invoices`, and every admin route.

So `auth.ts` **does** have a diff — 37 insertions, 9 deletions — generalising this to a scope→prefix map that **fails closed** on unrecognised scopes and matches on path-segment boundaries (`/api/pos` must not admit `/api/posturing`).

What the guard actually protects is the **`role` fallback**, which many older and test tokens rely on. That is untouched:

```bash
git diff main -- apps/api/src/lib/auth.ts | grep -E "^[-+].*role.*\?\?"   # no output
npm run test --workspace=apps/api -- staff-portal mobile-auth             # 21 passed
```

✅ Role fallback untouched; staff-portal and mobile-auth suites unaffected; 6 new tests cover pos confinement both directions, the staff/pos crossover, fail-closed on unknown scope, and the segment boundary.

### L5 — kitchen tickets never cross locations ✅

Filtering is server-side. Client-side filtering would still ship another location's order data to the browser.

Verified by **deliberately breaking it**: making the `pos-ws` lookup ignore `locationId` failed exactly the cross-location test and nothing else, then restored.

```bash
npm run test --workspace=apps/api -- pos-ws   # 7 passed
```

✅ Also covered: a crafted tenant id cannot collide into another bucket (clients are a nested Map, not a `${tenant}:${location}` string key).

### L6 — `pos_only` entitlement ✅

Dissolved during planning: `alwaysOn` only hides settings-UI toggle rows, it does not drive entitlement. `product = 'pos_only'` mirrors the existing `maya_only`.

```bash
git diff main -- apps/api/src/config/module-registry.ts | grep alwaysOn   # no output
```

✅ No `alwaysOn` changes.

---

## Migrations — applied to production

Applied 2026-09-11 to `zhykavqqvvvpfpgtipzp`, the project's **only** Supabase database. These migrations FK into `tenants`, `users`, `orders`, `locations`, `order_line_items` and ALTER `orders`, `order_line_items`, `staff_members` — they cannot target a separate database.

- [x] Pre-flight: zero table collisions, zero column collisions, all 6 FK targets present, `current_tenant_id()` present
- [x] 0195 applied and verified before 0196 (and so on through 0198)
- [x] 9/9 tables created, 9/9 `rowsecurity = true`, 9 policies
- [x] Both unique indexes present (`idx_kitchen_tickets_number_per_day`, `idx_one_open_drawer_per_location`)
- [x] `staff_members.pos_pin_hash` + `pos_location_ids` present
- [x] Supabase security advisors report **no new findings** from these migrations

```sql
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname='public' AND tablename IN
  ('menu_categories','menu_items','modifier_groups','modifier_options',
   'menu_item_modifier_groups','kitchen_tickets','kitchen_ticket_items',
   'cash_drawer_sessions','cash_events');
```

All 9 rows `rowsecurity = true`. Next migration number is **0199**.

> Note: no scratch/staging database exists — there is one Supabase project and it is production. The earlier plan assumed a scratch DB; that assumption was false and is recorded here rather than silently ticked.

---

## Bugs found and fixed that the plan did not anticipate

1. **portalScope confined only `staff`** — every other scope reached the whole API. See L4. (`fix(auth)`, its own commit.)
2. **Cross-tenant foreign keys in menu routes** — `getServiceClient()` uses the service-role key, which **bypasses RLS**, so the app-level filter is the real boundary. `POST /items`, `POST /modifier-options` and the link endpoint accepted foreign-tenant ids unchecked. Added an `ownsRow()` guard, plus positive tests so a blanket-reject regression cannot hide.
3. **False 204 on delete** — an update matching nothing returns no error, so deleting another tenant's item reported success. Now `.select()`s and 404s on empty.
4. **`fired_at::date` in a unique index** — `date(timestamptz)` is STABLE, so Postgres rejects it outright (verified against the live catalog). Pinning to UTC instead would reset ticket numbers at 7–8pm US Eastern, mid dinner service. Replaced with a tenant-timezone `service_date` column and `lib/pos-service-date.ts`.
5. **Two float-rounding hazards in `toCents`** — negative half-rounding toward zero, and `8.285 × 100 = 828.4999…` silently losing a cent.
6. **Web module list divergence** — `ModuleSettings.tsx` hand-mirrors the API registry, so `pos` could never have been toggled on in settings.

Also: `.build/` was untracked and unignored, so a broad `git add -A` swept in 2271 iOS build artifacts. Caught, reset, recommitted by path, and gitignored.

---

## Scope of the diff

```bash
git diff main --name-only | cut -d/ -f1-2 | sort -u
```

```
.gitignore              # Swift build output, so the sweep cannot recur
apps/api                # routes/pos/, lib/pos-*, config, index.ts, jest.config.ts
apps/web                # ModuleSettings.tsx only — the mirrored module list (bug 6)
docs/superpowers        # spec, plan, this checklist
package-lock.json       # @nuatis/pos-core workspace link
packages/pos-core       # new package
supabase/migrations     # 0195–0198
```

The plan expected `apps/api` + `packages/pos-core` + `supabase/migrations` only; `apps/web`, `.gitignore` and `package-lock.json` are the additions, each explained above.

---

## Still to do — before a demo can run

None of this is done. It is not part of the backend plan, but nothing is demonstrable without it.

- [ ] `pos` module enabled on the demo tenant, or the tenant put on a plan that grants it
- [ ] Demo tenant has at least one `location` row — **every POS route requires `location_id`**
- [ ] A restaurant menu seeded, with `kitchen_station` set on items so KDS routing is visible
- [ ] Seeding kept out of production paths — the prototype seeded demo data from inside hooks on an empty store, which would fire on a real merchant's first load
- [ ] At least one `staff_members` row with `pos_pin_hash` and `pos_location_ids`, or nobody can sign in to the register

## Still to do — next slices

- [ ] **Follow-up plan: `apps/pos` + `apps/kds`** — register UI, kitchen display, checkout state machine, receipt rendering, demo menu seeding
- [ ] **Slice 2: service verticals** — salon / spa / nail_bar and the rest on the shared terminal
- [ ] Archive `Nuatis-KitchenPOS` and `Nuatis-POS` once the menu-schema and checkout-state-machine ports are both verified

Out of scope for demo-ready, per the spec: real Stripe Terminal hardware, offline queue, multi-device cart sync, password reset, staff-invite email, per-denomination drawer counting.

---

## Open risks

- [ ] **Tips and the Connect application fee** — `orders.tip_amount` is deliberately separate from subtotal/tax so tips can be excluded from the platform fee basis. Confirm against the live Connect config (migration 0190) **before** payment work begins in the follow-up plan.
- [ ] **Pre-existing security advisories**, unrelated to POS but surfaced while verifying: `campaign_performance` view is SECURITY DEFINER (ERROR level); `match_knowledge()` is SECURITY DEFINER and executable by the **`anon`** role via `/rest/v1/rpc/`; 7 functions with mutable `search_path`; leaked-password protection disabled.
- [ ] **Two flaky timing tests** — `security-hardening-misc` and `voice/tenant-helpers`. Pre-existing; will keep failing CI intermittently.
- [ ] **`services` vs `menu_items`** — genuinely different things (CPQ quote line vs menu item with modifier groups). Watch that they do not converge into a confusing overlap.
- [ ] **`requireOrders` duplication** — reimplemented in both `orders.ts` and `order-templates.ts` despite `requireModule` existing in `lib/auth.ts`. Untouched here (unrelated refactor); worth a separate cleanup.
- [ ] **`routes/` is 231 flat files.** `routes/pos/` is the first grouped namespace — precedent for breaking up the rest.
