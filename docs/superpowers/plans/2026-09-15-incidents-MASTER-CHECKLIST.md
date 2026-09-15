# Incidents — Master Checklist

Covers both incident specs. Every box is **verifiable** — it names the command or
query that proves it, not a claim you have to trust. This format exists because
the POS checklist's first draft asserted five things that turned out to be false.

**Status: nothing implemented.** Every box below is unchecked and honest.

|       | Spec                                                                        | Plan                                              | Status                       |
| ----- | --------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------- |
| **A** | [Tenant core + POS surface](../specs/2026-09-15-incidents-tenant-design.md) | [14 tasks](./2026-09-15-incidents-tenant-plan.md) | approved, not started        |
| **B** | [Platform / internal ops](../specs/2026-09-15-incidents-platform-design.md) | not written                                       | **draft — 4 open decisions** |

---

## Progress — sub-project A

**0 / 14 tasks.** Tick a row only when its task's own tests pass and it is
committed. The phase sections below say what "done" actually means for each.

| Task | Deliverable                               | Phase | Done |
| ---- | ----------------------------------------- | ----- | ---- |
| 1    | Migration 0199 — incident schema          | A1    | [ ]  |
| 2    | Module registration + entitlement gate    | A1    | [ ]  |
| 3    | Core service module — SLA, threshold      | A2    | [ ]  |
| 4    | Incident type seeding                     | A2    | [ ]  |
| 5    | POS report route + manager PIN            | A3    | [ ]  |
| 6    | Dashboard routes — queue, triage, resolve | A2    | [ ]  |
| 7    | Reporting route — cost, per-staff, recur  | A5    | [ ]  |
| 8    | Register report dialog                    | A4    | [ ]  |
| 9    | KDS report action                         | A4    | [ ]  |
| 10   | Dashboard queue and detail                | A5    | [ ]  |
| 11   | Reporting view                            | A5    | [ ]  |
| 12   | SLA breach scanner                        | A6    | [ ]  |
| 13   | Escalation rules                          | A7    | [ ]  |
| 14   | Automation triggers                       | A8    | [ ]  |

**Dependency order.** 1 → 2 → 3 → 4 gate everything. After that: 5 and 6 are
independent of each other; 8 needs 5; 9 needs 5; 7 needs 6; 10 and 11 need 6
and 7; 12 → 13 → 14 are sequential and only need 1–3.

---

## Gate 0 — before any code

- [ ] **Branch created off `main`**, not off a merged feature branch.

- [ ] **Next migration number confirmed against the live database**, not guessed:

```sql
select max(name) from supabase_migrations.schema_migrations;
```

Expect `0198_pos_terminal_pin`. POS assumed 0195 was free and hit
`42P07: relation already exists`. If this returns something higher, renumber
before writing a line of SQL.

- [ ] **B's four open decisions resolved** — spec §8: on-call rota, tenant
      visibility, auto-detection, postmortem storage. **Blocks B only.** A is
      unblocked and depends on none of them, so do not hold A for this.

---

## Sub-project A — tenant core + POS surface

### Phase A1 — schema and module registration _(tasks 1–2)_

- [ ] Migration creates `incidents`, `incident_types`, `incident_rules`,
      `incident_events`, plus `tasks.incident_id`
- [ ] Every table has RLS using `current_tenant_id()` — **not** the
      `auth.jwt()->'app_metadata'` form (spec L2)
- [ ] `cost_cents` is `integer`, never `numeric` (spec L3)
- [ ] Migration is **idempotent** — applying it twice is a no-op. Non-negotiable:
      the POS migrations had to be rewritten after the fact.
- [ ] `incidents` registered in `config/stripe-plans.ts` scale plan + `TIER_GATED`
- [ ] `pos_only` does **not** imply `incidents` (spec §9)

**Proves it:**

```sql
select tablename, rowsecurity from pg_tables where tablename like 'incident%';
-- 4 rows, rowsecurity true on all

select data_type from information_schema.columns
 where table_name = 'incidents' and column_name = 'cost_cents';
-- integer
```

```bash
npm test --workspace=@nuatis/api -- src/lib/incident-module.test.ts   # 4 pass
```

### Phase A2 — core service and routes _(tasks 3, 4, 6)_

- [ ] SLA derivation, threshold rule and transition map are pure and tested
- [ ] Incident types seed **lazily on first read**, so tenants created before
      this shipped get them too
- [ ] `/api/incidents` — list with filters, detail with timeline, create, patch
- [ ] Every foreign key from a request body proven tenant-owned before write —
      `assigned_to_user_id`, `type_key` (spec L1)
- [ ] A no-op transition is refused, so no empty `incident_events` row is written
- [ ] Reference numbers `INC-####` per tenant, unique index as the real guard

**Proves it:**

```bash
npm test --workspace=@nuatis/api -- src/lib/incidents.test.ts               # 12 pass
npm test --workspace=@nuatis/api -- src/lib/incident-types.test.ts          #  5 pass
npm test --workspace=@nuatis/api -- src/routes/incidents.integration.test.ts # 10 pass
```

Integration tests must include **positive** cases. A blanket reject passes a
negative-only suite and proves nothing — the POS menu routes learned this.

### Phase A3 — POS route and authorisation _(task 5)_

- [ ] Lives under `/api/pos/*`. A register token carries `portalScope: 'pos'`,
      which `requireAuth` confines to that prefix (spec L4)
- [ ] Gated on `pos`, **not** on `incidents` — a `pos_only` merchant can log a
      comp without buying the module (spec §9)
- [ ] Below the threshold: no PIN required
- [ ] At or above: manager PIN required, stored as `authorised_by_staff_id`
- [ ] A non-manager PIN is refused at or above the threshold
- [ ] Zero cost never prompts
- [ ] The boundary case `cost == threshold` is tested explicitly, not assumed
- [ ] `requires_cost` types reject a zero amount
- [ ] The refusal message is **uniform** — never reveals whether the PIN was
      wrong or the staff member simply is not a manager

**Proves it:**

```bash
npm test --workspace=@nuatis/api -- src/routes/pos/incidents.integration.test.ts  # 12 pass
```

### Phase A4 — register and KDS surfaces _(tasks 8–9)_

- [ ] Register: "Report issue" against the current or a recent order
- [ ] KDS: report against a ticket, inheriting the ticket's `location_id` (spec L5)
- [ ] One dialog, not a wizard — this happens with a queue waiting
- [ ] The client threshold check mirrors the server's exactly, and the server
      remains authoritative

**Proves it:** browser verification with all three servers up, then:

```sql
select i.reference, i.cost_cents, i.authorised_by_staff_id,
       i.location_id, t.location_id as ticket_location
  from incidents i
  left join kitchen_tickets t on t.id = i.kitchen_ticket_id
 order by i.created_at desc limit 3;
-- a $4.50 row with authorised_by_staff_id null
-- a $13.50 row with authorised_by_staff_id set
-- a ticket-linked row where location_id = ticket_location
```

### Phase A5 — dashboard and reporting _(tasks 7, 10, 11)_

- [ ] `/incidents` queue: filter by status, severity, type, assignee
- [ ] Detail view shows the `incident_events` timeline in order
- [ ] Nav entry gated on the module, using the **existing** gating mechanism
- [ ] Reporting: cost by type this month
- [ ] Reporting groups by `type_key`, not label, so renaming a category does not
      change last month's numbers
- [ ] **Comps per staff member** — this is what makes the threshold safe, not
      optional (spec §4). Sorted by total descending, so the outlier is row one.
- [ ] Recurrence is a `GROUP BY`, not an engine (spec §7)

**Proves it:** create six $9.99 incidents from one staff member via the register,
then confirm the per-staff table shows one row, `count: 6`, `cost_cents: 5994`.
Individually invisible, collectively $59.94 — that is the whole point of the view.

### Phase A6 — SLA breach scanner _(task 12)_

- [ ] `sla_due_at` derived from severity at creation
- [ ] `incident-sla-scanner` modelled on `workers/invoice-overdue-scanner.ts`
- [ ] Runs every 15 minutes, not daily — a 1h critical SLA checked daily is not
      an SLA
- [ ] `getPausedTenants` honoured, like every other scanner
- [ ] A paused tenant's incident is **neither notified nor stamped** — stamping
      it means unpausing silently swallows the alert forever
- [ ] `sla_breached_at` stamped **before** notifying. A crash between the two
      costs one missed notification; the other order costs a duplicate every 15
      minutes forever, which is how a team learns to mute the alert.
- [ ] One notification per tenant, not per incident

**Proves it:**

```bash
npm test --workspace=@nuatis/api -- src/workers/incident-sla-scanner.test.ts  # 6 pass
```

The notify-once test runs `scan()` twice and asserts a single send.

### Phase A7 — escalation rules _(task 13)_

- [ ] `incident_rules` evaluated on breach, tenant-scoped
- [ ] A disabled rule does nothing
- [ ] Another tenant's rule never touches this tenant's incident
- [ ] A rule **never overwrites an assignee a human chose** — reassigning work
      out from under someone is how automation gets switched off
- [ ] Rule-driven changes write an `incident_events` row with `actor_kind: 'system'`,
      so the timeline shows a rule acted, not a person

**Proves it:**

```bash
npm test --workspace=@nuatis/api -- src/workers/incident-sla-scanner.test.ts  # 12 pass
```

### Phase A8 — automation triggers _(task 14)_

- [ ] `incident_created` / `incident_breached` emitted
- [ ] Fire-and-forget: a failing trigger never fails the incident report
- [ ] Works with the automation module absent
- [ ] Uses the **existing** dispatch path — read `custom-automation-worker.ts`
      first; do not invent a new one
- [ ] No UI offers SMS escalation. `notifyOwner`'s SMS branch is commented out
      pending a personal phone field on `users` (spec §7)

**Proves it:**

```bash
npm test --workspace=@nuatis/api    # full suite green, routes from tasks 5 and 6 still pass
```

---

## Sub-project B — platform / internal ops

> Blocked on Gate 0's third box. No plan written yet.

| Phase | Deliverable                                          | Done |
| ----- | ---------------------------------------------------- | ---- |
| B1    | Schema — no `tenant_id`, with the comment saying why | [ ]  |
| B2    | `/api/admin/incidents` + postmortem gate             | [ ]  |
| B3    | Admin console UI                                     | [ ]  |
| B4    | `notifyPlatformTeam` + ack-deadline scanner          | [ ]  |

- [ ] B1 — `platform_incidents` has **no `tenant_id`**, and the migration says
      why, so nobody "fixes" it (spec P1)
- [ ] B2 — behind the existing `requirePlatformOwner`; no new auth mode (spec P2)
- [ ] B2 — transition map blocks `resolved → closed` for SEV1/SEV2 without a
      postmortem (spec P4)
- [ ] B4 — `notifyPlatformTeam`, **never** `notifyOwner`. Getting this wrong
      emails every merchant about an internal outage (spec P3)

---

## Cross-cutting — must hold at every commit

- [ ] `npm run typecheck --workspaces --if-present` clean
- [ ] `npm run lint` clean at `--max-warnings 0`
- [ ] `npm test --workspaces --if-present` green
- [ ] CI green on the PR. Note CI builds `packages/*` that ship `dist/` before
      typechecking — a new built package must be added to that step, or every
      consumer fails with TS2307 (this exact thing broke PR #24).
- [ ] Stage **by path**. Never `git add -A` — it swept 2271 iOS artifacts once.
- [ ] Migration recorded in `supabase/migrations/README.md` with the
      "Applied to prod" column filled in.

---

## Final acceptance — before the PR

- [ ] A cashier reports a $4.50 comp with no PIN and a $13.50 comp with one
- [ ] A cook reports against a ticket and it inherits the ticket's location
- [ ] A manager triages, assigns and resolves, and the timeline shows every step
- [ ] The per-staff report totals six $9.99 comps as $59.94 under one name
- [ ] An overdue incident notifies exactly once across two scanner runs
- [ ] A paused tenant's breached incident is neither notified nor stamped
- [ ] An escalation rule does not take work off a human who already picked it up
- [ ] A failing automation trigger does not fail the incident report that fired it
- [ ] A `pos_only` tenant can still report from the register but gets 403 from
      the dashboard routes:

```sql
update tenants set product = 'pos_only' where id = '<demo tenant>';
-- POST /api/pos/incidents  → 201
-- GET  /api/incidents      → 403
update tenants set product = 'suite' where id = '<demo tenant>';   -- put it back
```

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
- **"`ownsRow` is importable from `routes/pos/menu.ts`."** It is not exported.
  Task 5 defines its own copy; widening a security helper's visibility belongs in
  its own commit.

---

## Open risks carried from the specs

- Threshold gaming is mitigated by reporting, not prevented (A §13)
- Tenant-editable types must keep `type_key` resolvable after deletion, or last
  month's report changes when someone renames a category (A §13)
- Two vocabularies for severity across A and B — deliberate, will confuse (B §12)
- The `pos` / `incidents` entitlement line is a guess until a real tenant tests it
  (A §13)
