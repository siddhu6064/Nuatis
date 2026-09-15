# Incidents — Master Checklist

Covers both incident specs. Every box is **verifiable** — it names the command or
query that proves it, not a claim you have to trust. This format exists because
the POS checklist's first draft asserted five things that turned out to be false.

**Status: nothing implemented.** Every box below is unchecked and honest.

|       | Spec                                                                        | Status                       |
| ----- | --------------------------------------------------------------------------- | ---------------------------- |
| **A** | [Tenant core + POS surface](../specs/2026-09-15-incidents-tenant-design.md) | approved, not started        |
| **B** | [Platform / internal ops](../specs/2026-09-15-incidents-platform-design.md) | **draft — 4 open decisions** |

---

## Gate 0 — before any code

- [ ] **B's four open decisions resolved** (spec §8: on-call rota, tenant
      visibility, auto-detection, postmortem storage). B cannot be planned until
      these are answered; A is unblocked and does not depend on them.
- [ ] **Next migration number confirmed against the live database**, not guessed:
      `sql
  select max(name) from supabase_migrations.schema_migrations;
  `
      POS assumed 0195 was free and hit `42P07: relation already exists`. Check
      first.
- [ ] **Branch created off `main`**, not off a merged feature branch.

---

## Sub-project A — tenant core + POS surface

### Phase A1 — schema and module registration

- [ ] Migration: `incidents`, `incident_types`, `incident_rules`,
      `incident_events`, plus `tasks.incident_id`
- [ ] Every table has RLS with `current_tenant_id()` — **not** the
      `auth.jwt()->'app_metadata'` form (spec L2)
- [ ] `cost_cents` is `integer`, never `numeric` (spec L3)
- [ ] Migration is **idempotent** — `IF NOT EXISTS`, `DROP POLICY IF EXISTS`.
      Non-negotiable: the POS migrations had to be rewritten after the fact.
- [ ] `incidents` module key registered in `config/stripe-plans.ts`
- [ ] `pos_only` does **not** imply `incidents` (spec §9)

**Proves it:**

```sql
select tablename, rowsecurity from pg_tables
 where tablename like 'incident%';                    -- all true
select column_name, data_type from information_schema.columns
 where table_name = 'incidents' and column_name = 'cost_cents';   -- integer
```

### Phase A2 — core API

- [ ] `/api/incidents` — dashboard CRUD, triage, assign, resolve
- [ ] `/api/pos/incidents` — register + KDS reporting
- [ ] **Two prefixes, one service module.** `portalScope: 'pos'` is confined to
      `/api/pos/*` by `requireAuth`; a register token cannot reach `/api/incidents`
      (spec L4)
- [ ] Every foreign key from a request body proven tenant-owned before write —
      `order_id`, `kitchen_ticket_id`, `assigned_to_user_id`, `type_key`
      (spec L1, `ownsRow()` pattern)
- [ ] Reference numbers `INC-####` per tenant, unique index as the real guard
      (spec L6)
- [ ] `incident_events` row written on every status change, assignment,
      authorisation and resolution

**Proves it:** integration tests including **positive** cases — a blanket reject
passes a negative-only test suite and proves nothing. The POS menu routes learned
this the hard way.

### Phase A3 — authorisation

- [ ] Per-tenant threshold, default $10
- [ ] Below threshold: no PIN required
- [ ] At or above: manager PIN required, stored as `authorised_by_staff_id`
- [ ] A non-manager PIN is refused at or above the threshold
- [ ] Zero-cost incidents never prompt
- [ ] PIN verification reuses `lib/pos-pin.ts` — no new credential

**Proves it:** four tests, one per row above. The boundary case (`cost == threshold`)
is explicitly tested, not assumed.

### Phase A4 — register and KDS surfaces

- [ ] Register: "Report issue" against the current or a recent order
- [ ] KDS: report against a ticket, inheriting the ticket's `location_id` (spec L5)
- [ ] One dialog, not a wizard — this happens with a queue waiting
- [ ] Both reuse `@nuatis/pos-web` rather than growing a second copy

**Proves it:** browser verification with all three servers up, plus a database
query showing the row with the right `order_id`/`kitchen_ticket_id` and reporter.

### Phase A5 — dashboard

- [ ] `/incidents` queue: filter by type, severity, status, assignee
- [ ] Triage, assign, resolve with root cause and resolution notes
- [ ] Reporting: cost by type this month
- [ ] **Comps per staff member** — this is what makes the threshold safe, not
      optional (spec §4)
- [ ] Recurrence: `GROUP BY type_key, location_id` over a trailing window — a
      query, not an engine (spec §7)

### Phase A6 — SLA breach scanner _(plan Task 12)_

- [ ] `sla_due_at` derived from severity at creation, per-tenant durations
- [ ] `incident-sla-scanner` modelled on `workers/invoice-overdue-scanner.ts`
- [ ] Runs every 15 minutes, not daily — a 1h critical SLA checked daily is not an SLA
- [ ] `getPausedTenants` honoured, like every other scanner
- [ ] A paused tenant's incident is **neither notified nor stamped**, so unpausing
      does not silently swallow it
- [ ] Breach notifies **once**, not on every scan tick — `sla_breached_at` stamped
      _before_ notifying
- [ ] One notification per tenant, not per incident

### Phase A7 — escalation rules _(plan Task 13)_

- [ ] `incident_rules` evaluated on breach, tenant-scoped
- [ ] A disabled rule does nothing
- [ ] Another tenant's rule never touches this tenant's incident
- [ ] A rule **never overwrites an assignee a human chose** — reassigning work
      out from under someone is how automation gets switched off
- [ ] Rule-driven changes write an `incident_events` row with `actor_kind: 'system'`

### Phase A8 — automation triggers _(plan Task 14)_

- [ ] `incident_created` / `incident_breached` emitted
- [ ] Fire-and-forget: a failing trigger never fails the incident report
- [ ] Works with the automation module absent
- [ ] Uses the existing dispatch path, not a new one
- [ ] No UI offers SMS escalation — `notifyOwner`'s SMS branch is commented out
      pending a personal phone field on `users` (A §7)

**Proves it:** frozen-clock tests for derivation and breach selection; a
notify-once test that runs the scanner twice and asserts a single send.

---

## Sub-project B — platform / internal ops

> Blocked on Gate 0. Do not start until §8 is answered.

### Phase B1 — schema

- [ ] `platform_incidents` with **no `tenant_id`**, and a migration comment saying
      why, so nobody "fixes" it (spec P1)
- [ ] `platform_incident_tenants`, `platform_incident_events`

### Phase B2 — API

- [ ] `/api/admin/incidents` behind the existing `requirePlatformOwner`
- [ ] No new auth mode, no superuser concept (spec P2)
- [ ] Transition map enforces the postmortem gate: SEV1/SEV2 cannot reach `closed`
      without a postmortem (spec P4)

### Phase B3 — admin console UI

- [ ] List, detail with timeline, postmortem editor
- [ ] Affected-tenant picker over the existing cross-tenant list

### Phase B4 — notifications

- [ ] `notifyPlatformTeam`, **never** `notifyOwner` (spec P3)
- [ ] Ack-deadline scanner

**Proves P3:** a test asserting no tenant-owner address is ever resolved. Getting
this wrong emails every merchant about an internal outage.

---

## Cross-cutting — must hold at every commit

- [ ] `npm run typecheck --workspaces --if-present` clean
- [ ] `npm run lint` clean at `--max-warnings 0`
- [ ] `npm test --workspaces --if-present` green
- [ ] CI green on the PR — and note CI builds `packages/*` that ship `dist/`
      before typechecking; a new built package must be added to that step
- [ ] Stage **by path**. Never `git add -A` — it swept 2271 iOS artifacts once
- [ ] Migrations recorded in `supabase/migrations/README.md` with an
      "Applied to prod" column

---

## Known-false temptations

Recorded because each one already cost time on the POS work.

- **"One incidents table with a scope column is simpler."** It is, until a tenant
  query forgets the predicate. Service-role bypasses RLS; the filter is the only
  boundary. (A §1)
- **"Comps should just refund the card."** There is no card payment — POS card
  approval is a `DEMO:` stub. (A §3)
- **"The SLA scanner needs a new job system."** There are 33 scanners on the
  BullMQ pattern already. (A §7)
- **"Recurrence needs a detection engine."** It is a `GROUP BY`. (A §7)
- **"Nuatis should dogfood the tenant module for its own outages."** That is how
  the leak in A §1 gets built. (B §12)

---

## Open risks carried from the specs

- Threshold gaming is mitigated by reporting, not prevented (A §13)
- Tenant-editable types must keep `type_key` resolvable after deletion, or last
  month's report changes when someone renames a category (A §13)
- Two vocabularies for severity across A and B — deliberate, will confuse (B §12)
- The `pos` / `incidents` entitlement line is a guess until a real tenant tests it
  (A §13)
