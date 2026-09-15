# Incidents — Master Checklist

Covers both incident specs. Every box is **verifiable** — it names the command or
query that proves it, not a claim you have to trust. This format exists because
the POS checklist's first draft asserted five things that turned out to be false.

**Status: 11 of 14 tasks done.** A box is ticked only when the command beside it
was actually run.

|       | Spec                                                                        | Plan                                              | Status                       |
| ----- | --------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------- |
| **A** | [Tenant core + POS surface](../specs/2026-09-15-incidents-tenant-design.md) | [14 tasks](./2026-09-15-incidents-tenant-plan.md) | approved, not started        |
| **B** | [Platform / internal ops](../specs/2026-09-15-incidents-platform-design.md) | not written                                       | **draft — 4 open decisions** |

---

## Progress — sub-project A

**14 / 14 tasks.** Tick a row only when its task's own tests pass and it is
committed. The phase sections below say what "done" actually means for each.

| Task | Deliverable                               | Phase | Done |
| ---- | ----------------------------------------- | ----- | ---- |
| 1    | Migration 0199 — incident schema          | A1    | [x]  |
| 2    | Module registration + entitlement gate    | A1    | [x]  |
| 3    | Core service module — SLA, threshold      | A2    | [x]  |
| 4    | Incident type seeding                     | A2    | [x]  |
| 5    | POS report route + manager PIN            | A3    | [x]  |
| 6    | Dashboard routes — queue, triage, resolve | A2    | [x]  |
| 7    | Reporting route — cost, per-staff, recur  | A5    | [x]  |
| 8    | Register report dialog                    | A4    | [x]  |
| 9    | KDS report action                         | A4    | [x]  |
| 10   | Dashboard queue and detail                | A5    | [x]  |
| 11   | Reporting view                            | A5    | [x]  |
| 12   | SLA breach scanner                        | A6    | [x]  |
| 13   | Escalation rules                          | A7    | [x]  |
| 14   | Automation triggers                       | A8    | [x]  |

**Dependency order.** 1 → 2 → 3 → 4 gate everything. After that: 5 and 6 are
independent of each other; 8 needs 5; 9 needs 5; 7 needs 6; 10 and 11 need 6
and 7; 12 → 13 → 14 are sequential and only need 1–3.

---

## Gate 0 — before any code

- [x] **Branch created off `main`**, not off a merged feature branch.

- [x] **Next migration number confirmed against the live database**, not guessed:

```sql
select name from supabase_migrations.schema_migrations
 where name ~ '^[0-9]{4}' order by substring(name from '^[0-9]{4}')::int desc limit 5;
```

Expect the top row to be `0198_pos_terminal_pin`, so 0199 is free. `max(name)` does **not** work — the table holds non-numeric names (`weekly_digest` sorts above `0198`). POS assumed 0195 was free and hit
`42P07: relation already exists`. If this returns something higher, renumber
before writing a line of SQL.

- [ ] **B's four open decisions resolved** — spec §8: on-call rota, tenant
      visibility, auto-detection, postmortem storage. **Blocks B only.** A is
      unblocked and depends on none of them, so do not hold A for this.

---

## Sub-project A — tenant core + POS surface

### Phase A1 — schema and module registration _(tasks 1–2)_

> **Phase complete.** Task 1 applied to production 2026-09-15; task 2 registers
> the module and its gate.
>
> `incidents` is tier-gated to the scale plan, and both production tenants are
> on `core`, so no existing tenant silently gained a module. Verified against
> the live database rather than assumed.
>
> **Demo tenant:** moved to the `scale` plan with all 15 modules explicitly
> enabled on 2026-09-15, so it will not 403 on `/api/incidents` during task 6
> verification. The other production tenant is untouched and still on `core`.
>
> Its `vertical` is `sales_crm` but it has 18 menu items and runs the restaurant
> POS, so the lazy seed would have given it the generic default types. Its six
> restaurant types were inserted directly instead of changing the vertical,
> which would ripple into CRM custom fields, booking and Maya prompts. Incident
> types are tenant-editable rows, so this is configuration, not a workaround.

- [x] Migration creates `incidents`, `incident_types`, `incident_rules`,
      `incident_events`, plus `tasks.incident_id`
- [x] Every table has RLS using `current_tenant_id()` — **not** the
      `auth.jwt()->'app_metadata'` form (spec L2)
- [x] `cost_cents` is `integer`, never `numeric` (spec L3)
- [x] Migration is **idempotent** — applying it twice is a no-op. Non-negotiable:
      the POS migrations had to be rewritten after the fact.
- [x] `incidents` registered in `config/stripe-plans.ts` scale plan + `TIER_GATED`
- [x] `pos_only` does **not** imply `incidents` (spec §9)

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

> **Phase complete.** Verified live as well as against the mock:
>
> - a `portalScope: 'pos'` token gets **403** on `/api/incidents` and 200 on
>   `/api/pos/incidents/types` — L4 confinement is real, not just configured
> - `triaged → triaged` refused, `resolved → open` refused
> - timeline read back as `reported → status_changed → status_changed`

- [x] SLA derivation, threshold rule and transition map are pure and tested
- [x] Incident types seed **lazily on first read**, so tenants created before
      this shipped get them too
- [x] Seeding falls back to evidence when the vertical has no list — a tenant
      with menu items gets the restaurant reasons, because `vertical` is
      self-declared at signup and routinely wrong
- [x] `/api/incidents` — list with filters, detail with timeline, create, patch
- [x] Every foreign key from a request body proven tenant-owned before write —
      `assigned_to_user_id`, `type_key` (spec L1)
- [x] A no-op transition is refused, so no empty `incident_events` row is written
- [x] Reference numbers `INC-####` per tenant, unique index as the real guard

**Proves it:**

```bash
npm test --workspace=@nuatis/api -- src/lib/incidents.test.ts               # 12 pass
npm test --workspace=@nuatis/api -- src/lib/incident-types.test.ts          #  5 pass
npm test --workspace=@nuatis/api -- src/routes/incidents.integration.test.ts # 10 pass
```

Integration tests must include **positive** cases. A blanket reject passes a
negative-only suite and proves nothing — the POS menu routes learned this.

### Phase A3 — POS route and authorisation _(task 5)_

> **Phase complete.** Migration 0200 was needed: `staff_members.role` is free
> text job titles, so "manager" is an explicit `pos_can_authorise` flag,
> defaulting to false. Verified against the live database as well as the mock —
> $4.50 no PIN → 201, $13.50 no PIN → 403, cashier's own PIN → 403, manager PIN
> → 201 with `authorised_by` recorded.

- [x] Lives under `/api/pos/*`. A register token carries `portalScope: 'pos'`,
      which `requireAuth` confines to that prefix (spec L4)
- [x] Gated on `pos`, **not** on `incidents` — a `pos_only` merchant can log a
      comp without buying the module (spec §9)
- [x] Below the threshold: no PIN required
- [x] At or above: manager PIN required, stored as `authorised_by_staff_id`
- [x] A non-manager PIN is refused at or above the threshold
- [x] Zero cost never prompts
- [x] The boundary case `cost == threshold` is tested explicitly, not assumed
- [x] `requires_cost` types reject a zero amount
- [x] The refusal message is **uniform** — never reveals whether the PIN was
      wrong or the staff member simply is not a manager

**Proves it:**

```bash
npm test --workspace=@nuatis/api -- src/routes/pos/incidents.integration.test.ts  # 12 pass
```

### Phase A4 — register and KDS surfaces _(tasks 8–9)_

> **Phase complete.**
>
> Register (task 8), verified in the browser: a $13.50 "Wrong item" showed
> "Over $10.00 — a manager has to approve this" and disabled Report; the
> cashier's own PIN was refused with the server's own wording and the dialog
> stayed open with the PIN cleared; the manager's PIN went through as INC-1013
> with `authorised_by` recorded as Carlos Mendez.
>
> KDS (task 9): reported INC-1015 against ticket #2 in one tap. The ticket-
> location check caught a real bug — the server was **not** deriving
> `location_id` from the ticket, so INC-1014 was written with a null location
> and would have dropped out of location-scoped reporting and recurrence
> entirely. Both the plan and the client comment claimed the server did this;
> neither was true until now. Fixed, two regression tests added, and the one
> orphaned row backfilled.

- [x] Register: "Report issue" against the current or a recent order
- [x] KDS: report against a ticket, inheriting the ticket's `location_id` (spec L5)
- [x] One dialog, not a wizard — this happens with a queue waiting
- [x] The client threshold check mirrors the server's exactly, and the server
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

> **Phase complete.** Verified in the browser as the demo tenant: the queue listed all 14
> incidents with severity, cost and status; INC-1013 triaged and then resolved
> through the UI, with Resolve correctly disabled until a root cause was
> entered; the database confirmed `root_cause`, `resolved_at` and a timeline of
> `reported → status_changed → status_changed`.
>
> **Known gap in the shared nav gate:** `Sidebar.tsx` uses
> `modules[m] !== false`, so an **absent** key reads as enabled. Every tenant
> provisioned through upgrade-to-suite gets explicit booleans, but a tenant
> whose `modules` predates this module will see Incidents in the nav and then
> meet a 403 from the API. The board handles that with a clear "not enabled on
> this plan" message rather than a broken screen. Changing the gate's semantics
> would affect every module and belongs in its own change.
>
> Proved live with the scenario the per-staff table exists for: six $9.99 comps
> from one cashier, every one under the $10 threshold and none prompting for a
> manager. The report shows Alex Brown at **$77.94 across 12 incidents** — one
> row, impossible to miss. Recurrence picked up both patterns at the location.

- [x] `/incidents` queue: filter by status, severity, type, assignee
- [x] Detail view shows the `incident_events` timeline in order
- [x] Nav entry gated on the module, using the **existing** gating mechanism
- [x] Reporting: cost by type this month
- [x] Reporting groups by `type_key`, not label, so renaming a category does not
      change last month's numbers
- [x] **Comps per staff member** — this is what makes the threshold safe, not
      optional (spec §4). Sorted by total descending, so the outlier is row one.
- [x] Recurrence is a `GROUP BY`, not an engine (spec §7)

**Proves it:** create six $9.99 incidents from one staff member via the register,
then confirm the per-staff table shows one row, `count: 6`, `cost_cents: 5994`.
Individually invisible, collectively $59.94 — that is the whole point of the view.

### Phase A6 — SLA breach scanner _(task 12)_

- [x] `sla_due_at` derived from severity at creation
- [x] `incident-sla-scanner` modelled on `workers/invoice-overdue-scanner.ts`
- [x] Runs every 15 minutes, not daily — a 1h critical SLA checked daily is not
      an SLA
- [x] `getPausedTenants` honoured, like every other scanner
- [x] A paused tenant's incident is **neither notified nor stamped** — stamping
      it means unpausing silently swallows the alert forever
- [x] `sla_breached_at` stamped **before** notifying. A crash between the two
      costs one missed notification; the other order costs a duplicate every 15
      minutes forever, which is how a team learns to mute the alert.
- [x] One notification per tenant, not per incident

**Proves it:**

```bash
npm test --workspace=@nuatis/api -- src/workers/incident-sla-scanner.test.ts  # 8 pass
```

The notify-once test runs `scan()` twice and asserts a single send.

### Phase A7 — escalation rules _(task 13)_

- [x] `incident_rules` evaluated on breach, tenant-scoped
- [x] A disabled rule does nothing
- [x] Another tenant's rule never touches this tenant's incident
- [x] A rule **never overwrites an assignee a human chose** — reassigning work
      out from under someone is how automation gets switched off
- [x] Rule-driven changes write an `incident_events` row with `actor_kind: 'system'`,
      so the timeline shows a rule acted, not a person
- [x] **`action: 'notify_owner'` actually notifies** — beyond the plan, which
      implemented only `assign_to` and would have left the schema's other
      action configurable but silent
- [x] **`delay_minutes` is waited out** — beyond the plan, which never read the
      column. "Escalate if nobody picks this up in 30 minutes" means nothing if
      the rule fires instantly. Needed the scanner to revisit already-breached
      incidents, with the append-only event log as the once-only guard.

**Proves it:**

```bash
npm test --workspace=@nuatis/api -- src/workers/incident-sla-scanner.test.ts  # 19 pass
```

### Phase A8 — automation triggers _(task 14)_

- [x] `incident_created` / `incident_breached` emitted — from both create
      routes and, once only, from the scanner's newly-breached rows
- [x] Fire-and-forget: a failing trigger never fails the incident report
- [x] Works with the automation module absent — no listeners means no work
- [x] **Not** the existing dispatch path, and deliberately so. The plan assumed
      `enqueueCustomAutomation` in `lib/custom-automation.js`; neither exists.
      The real engine is `runAction(supabase, automation, contact)`, and it is
      contact-centric: five of its seven actions write against a contact row,
      which an incident does not have. Incident triggers therefore run their
      own contact-free path supporting `create_task` (linked through
      `tasks.incident_id`) and `send_webhook`, and
      `routes/custom-automations.ts` **refuses to save** an incident-triggered
      automation with any other action rather than storing one that reads as
      active and does nothing.
- [x] Migration 0203 widens `custom_automations_trigger_type_check`; without it
      an incident-triggered automation could not be stored at all
- [x] Found and fixed en route: the `create_task` action inserted `due_at`
      (the column is `due_date`) with `status: 'pending'` (the check allows
      `open`/`in_progress`/`done`), so it had never once succeeded for any
      automation. The supabase test mock does not validate columns, which is
      why a green suite never caught it.
- [x] No UI offers SMS escalation. `notifyOwner`'s SMS branch is commented out
      pending a personal phone field on `users` (spec §7)

**Proves it:**

```bash
npm test --workspace=@nuatis/api -- src/lib/incident-triggers.test.ts  # 12 pass
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

Run 2026-09-15. Each box names what proves it; none is ticked on inspection
alone.

**Mechanical, whole repo:**

- [x] `npm run typecheck --workspaces --if-present` — clean, 7 workspaces
- [x] `npm run lint` — clean at `--max-warnings 0`
- [x] `npm test --workspaces --if-present` — 247 suites, 2120 tests, green
- [x] `npm run build` for `apps/pos`, `apps/kds` and `apps/web` — all three
      succeed; `/incidents`, `/incidents/[id]` and `/incidents/reports` present

**Behaviour:**

- [x] A cashier reports a $4.50 comp with no PIN and a $13.50 comp with one —
      `records a small comp without a manager PIN`, `refuses a comp at or above
  the threshold with no manager PIN`, and `treats the threshold itself as
  needing a manager, not just above it`
- [x] A cook reports against a ticket and it inherits the ticket's location —
      `inherits the location from the ticket, so it is not lost from reporting`
- [x] A manager triages, assigns and resolves, and the timeline shows every
      step — `writes an opening event so the timeline starts at creation`,
      `assigns an incident and writes an event`, `resolves with a root cause`,
      `refuses to reopen a resolved incident`
- [x] The per-staff report totals repeated just-under-threshold comps under one
      name — `totals comps per staff member, which is what makes the threshold
  safe`; also proved live, six $9.99 comps surfacing as a single row
- [x] An overdue incident notifies exactly once across two scanner runs —
      `notifies once, not on every tick`
- [x] A paused tenant's breached incident is neither notified nor stamped —
      `skips paused tenants without stamping them`
- [x] An escalation rule does not take work off a human who already picked it
      up — `does not overwrite an assignee a human already chose`
- [x] A failing automation trigger does not fail the incident report that fired
      it — `never throws when the lookup fails` and `is fire-and-forget`
- [x] A `pos_only` tenant can still report from the register but gets 403 from
      the dashboard routes — `refuses a tenant without the incidents module` on
      both the queue and the reports route; also proved live, a register token
      getting 403 from `/api/incidents` and 200 from `/api/pos/incidents/types`

**Found and fixed by this pass** (see the bug sweep commit):

- [x] `incidents.location_id` is a plain FK to `locations(id)` with no tenant in
      it, and the POS route passed the client's value through unchecked while
      proving ownership of `order_id`, `kitchen_ticket_id` and
      `reported_by_staff_id` right beside it — a register could file against
      another business's site. Verified against production: zero bad rows, so
      no backfill.
- [x] Same shape in the escalation rules — `incident_rules.target_user_id` and
      `incidents.assigned_to_user_id` are both untenanted FKs to `users(id)`,
      so a rule could assign someone who can never see the incident while it
      reads as handled. No route writes rules yet, so defence in depth.
- [x] Incident type seeding discarded its insert error, leaving the register
      with no Report button and no trace of why. A unique violation there is
      the expected race between register and KDS booting together; anything
      else is now logged.

**Checked and found sound**, recorded so the next pass does not re-derive them:

- The `/summary` query has no row limit, but PostgREST `db_max_rows` is unset
  on this project, so nothing is silently truncated and the money totals are
  whole.
- Client and server agree on the threshold comparison (`>=` in both
  `needsManagerPin` and `requiresAuthorisation`), so the PIN pad appears exactly
  when the server will demand one.
- The register keypad caps entry at six digits, well inside `cost_cents`'
  `integer`, so no overflow path into a 500.
- `isModuleEnabled` fails closed on an unprovisioned tenant or a query error.
- Every status button in `IncidentDetail` maps to a legal `ALLOWED_TRANSITIONS`
  edge, so no button is offered that the API would refuse.
- Reporter attribution is server-derived end to end: `terminal-auth` signs
  `sub: pos:<staffId>`, `requireAuth` copies it to `authed.userId`, and the POS
  route slices the prefix — the request body cannot spoof it.

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
- **"A red full-suite run means I broke something."** THREE suites on this repo
  fail intermittently under parallel load and pass in isolation:
  `security-hardening-misc` (rate-limit timing), `admin-console.integration`,
  and `stripe-webhooks-checkout`. None is touched by this branch. Confirm with
  `git log main..HEAD -- <file>` and an isolated run before chasing. Three is a
  pattern rather than three coincidences — the suite has a parallelism problem
  worth its own fix, separate from this work.
- **"The register knows who is reporting."** It did not attribute anything until
  task 11 — the dialog sent a null reporter, so register-reported comps were
  missing from the per-staff table, which is the whole mitigation for the
  threshold. The server now derives it from the POS token's `pos:<staffId>` sub
  and ignores the body. Totals disagreeing between two sections of one report
  is the symptom to watch for.
- **"The server derives the ticket's location."** It did not, until task 9.
  Comments describing behaviour are not evidence that the behaviour exists —
  this one was written in the plan AND in the client before anything
  implemented it. Check the row, not the comment.
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
