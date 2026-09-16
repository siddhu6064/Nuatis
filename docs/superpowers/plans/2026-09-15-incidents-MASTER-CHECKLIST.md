# Incidents — Master Checklist

Covers both incident specs. Every box is **verifiable** — it names the command or
query that proves it, not a claim you have to trust. This format exists because
the POS checklist's first draft asserted five things that turned out to be false.

**Status: A complete and merged (14/14). B complete (16/16), not yet merged.** A box is
ticked only when the command beside it was actually run.

|       | Spec                                                                        | Plan                                                | Status                                     |
| ----- | --------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------ |
| **A** | [Tenant core + POS surface](../specs/2026-09-15-incidents-tenant-design.md) | [14 tasks](./2026-09-15-incidents-tenant-plan.md)   | **shipped** — merged in PR #25             |
| **B** | [Platform / internal ops](../specs/2026-09-15-incidents-platform-design.md) | [16 tasks](./2026-09-15-incidents-platform-plan.md) | **built** — branch feat/incidents-platform |

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

- [x] **B's four open decisions resolved** — spec §8, resolved 2026-09-15. Two
      went against the spec's own recommendation: an on-call rota **and** an
      assignee column, and affected merchants **are** told through a separately
      authored `customer_message`. Auto-detection stays manual with the hook
      shipped disabled; the postmortem stays a `text` column. Reasoning is
      recorded in the spec rather than just the outcome.

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

**16 / 16 tasks.** Spec approved 2026-09-15, plan written:
`2026-09-15-incidents-platform-plan.md` — 16 tasks, 87 steps. Tick a row only
when its task's own tests pass and it is committed.

> The old four-row B1–B4 table here predated the plan and named the route
> prefix `/api/admin/incidents`, which does not exist. The real prefix is
> `/api/admin-console/*`, reusing the console's existing guard.

| Task | Deliverable                                   | Phase | Done |
| ---- | --------------------------------------------- | ----- | ---- |
| 1    | Migration 0204 — schema with no `tenant_id`   | B1    | [x]  |
| 2    | Extract `requirePlatformOwner` into a lib     | B1    | [x]  |
| 3    | Severity, ack targets, postmortem gate        | B2    | [x]  |
| 4    | On-call rota resolver                         | B2    | [x]  |
| 5    | Declare, list and read                        | B3    | [x]  |
| 6    | Transitions, acknowledgement, postmortem gate | B3    | [x]  |
| 7    | Record which merchants were affected          | B3    | [x]  |
| 8    | Customer message, written and published       | B4    | [x]  |
| 9    | Tenant-facing notices endpoint                | B4    | [x]  |
| 10   | On-call rota routes                           | B3    | [x]  |
| 11   | `notifyPlatformTeam`                          | B5    | [x]  |
| 12   | Ack-deadline scanner                          | B5    | [x]  |
| 13   | Sentry auto-detection, shipped disabled       | B6    | [x]  |
| 14   | Admin console list and detail                 | B7    | [x]  |
| 15   | On-call rota editor                           | B7    | [x]  |
| 16   | Merchant-facing notice banner                 | B7    | [x]  |

**Dependency order.** 1 → 2 gate everything. 3 and 4 need only 1. 5 needs 2–4;
6, 7, 8 need 5; 9 needs 8; 10 needs 2 and 4. 11 → 12 need 3. 13 needs 3 and 11.
14–15 need 5–10; 16 needs 9.

---

### Gate 0 — before any code

- [x] Branch `feat/incidents-platform` created off `main`
- [x] Next migration number confirmed against the live database, ordering by
      numeric prefix — `max(name)` returns `weekly_digest`. Confirmed
      2026-09-15: latest is `0203`, so this plan uses **0204**

### Phase B1 — schema and the guard _(tasks 1–2)_

- [x] `platform_incidents` has **no `tenant_id`**, and the migration comment
      says why so nobody "fixes" it later (spec P1)
- [x] Proven by query, not by reading:
      `select count(*) from information_schema.columns where table_name='platform_incidents' and column_name='tenant_id';` → **0**
- [x] All four tables have RLS enabled with no permissive policy — a leaked
      anon key reads nothing
- [x] `requirePlatformOwner` **moved** to `lib/platform-auth.ts`, not copied.
      It was private to `routes/admin-console.ts`, so the spec's "reuse the
      existing guard" was not possible as written
- [x] It fails closed when `PLATFORM_TENANT_ID` is unset
- [x] The existing `admin-console.integration` suite still passes — that is the
      regression check that moving it changed no behaviour

### Phase B2 — severity, gate and rota _(tasks 3–4)_

- [x] SEV1 is defined by **money** — merchants cannot take payment — not by
      component. The POS socket dropping is a SEV2 (spec §4)
- [x] SEV4 has a **null** deadline, not a large one. A deadline nobody intends
      to meet teaches people to ignore the real ones
- [x] `resolved → closed` is refused for SEV1/SEV2 without a postmortem, in the
      transition map rather than the UI (spec P4)
- [x] The rota returns **null** when nobody is on call, rather than falling back
      to an arbitrary person — a wrong name looks owned, so nobody picks it up
- [x] Shifts are half-open `[starts_at, ends_at)`, so a handover instant belongs
      to exactly one shift
- [x] An override wins over a regular shift covering the same instant

### Phase B3 — incident and rota routes _(tasks 5, 6, 7, 10)_

- [x] Everything behind the existing `requirePlatformOwner`; no new auth mode,
      no superuser concept, no second credential (spec P2)
- [x] Declaring assigns whoever the rota says is on call, and leaves the
      assignee empty when nobody is
- [x] Assignment and rota shifts both refuse a user outside the platform tenant
      — `users.id` is a plain FK with no tenant in it
- [x] `postmortem_due → closed` is refused while the postmortem text is empty.
      The gate is enforced twice on purpose: the map allows that edge, and the
      written text is what makes it mean something
- [x] A no-op transition is refused, so no empty event row is written
- [x] Tenant impact **replaces** the set rather than appending, so removing a
      tenant works as the blast radius becomes clear

### Phase B4 — the customer message _(tasks 8–9)_

- [x] Saving and publishing are **two operations**. One-step publishing means a
      half-written sentence reaches every affected merchant on save
- [x] Publishing is refused while the text is empty
- [x] A published notice can be retracted — a wrong notice must be withdrawable
- [x] **The tenant endpoint never exposes `title`, `summary`, `component` or the
      timeline.** Proven by grepping the response body for the internal text,
      not by reading the select list
- [x] The response is reshaped field by field rather than spread, so a column
      added to `platform_incidents` later cannot silently start appearing
- [x] An unpublished message is invisible even to an affected tenant
- [x] A tenant recorded with impact `none` sees nothing

### Phase B5 — notifications and escalation _(tasks 11–12)_

- [x] `notifyPlatformTeam`, **never** `notifyOwner`. Getting this wrong tells
      every merchant about an internal outage (spec P3)
- [x] It ships on push + optional webhook, **not email**. There is no
      transactional email provider in this codebase — `lib/email-send.ts` is
      per-tenant Gmail/Outlook OAuth for merchant mailboxes. An email branch
      that cannot send is a notifier that silently drops alerts
- [x] A broken webhook URL still lets the push through
- [x] The ack scanner stamps `ack_breached_at` **before** notifying
- [x] It escalates once, not every five minutes
- [x] Cron is `*/5 * * * *`, not daily — a 15-minute SEV1 deadline checked
      hourly is not a deadline
- [x] `getPausedTenants` is deliberately **not** consulted: it is a per-tenant
      control and these incidents have no tenant

### Phase B6 — auto-detection _(task 13)_

- [x] `PLATFORM_AUTO_DETECT` unset means nothing is ever auto-declared
- [x] Only the exact string `"true"` enables it — `1` and `yes` do not
- [x] Auto-declared incidents are never above **SEV3**. A machine may say
      "something is wrong"; only a human decides merchants cannot take money
- [x] A spike lasting twenty minutes opens one incident, not four

### Phase B7 — surfaces _(tasks 14–16)_

- [x] New `components/admin-console/` directory rather than growing the
      existing 764-line `page.tsx`
- [x] The UI offers **Close** only where the API would accept it, so the button
      is never offered and then rejected
- [x] The rota page says "Nobody is on call" plainly when the rota is empty,
      rather than rendering a blank name
- [x] The merchant banner renders **nothing** when there are no notices, and a
      failed fetch renders nothing — a broken status notice must never break
      the dashboard
- [x] The banner renders only `message`, `published_at` and `resolved_at`,
      because those are the only fields the endpoint returns

---

### Sub-project B — final verification

Run 2026-09-15 overnight. Each line names what proved it.

- [x] `npm run typecheck --workspaces --if-present` — clean, 7 workspaces
- [x] `npm run lint` — clean at `--max-warnings 0`
- [x] `npm test --workspaces --if-present` — 258 suites, 2263 tests green
      (api 249/2133, web 5/33, pos 4/97; kds has no test files of its own since
      its socket and board tests moved into `packages/pos-web`, which run under
      the api config)
- [x] `npm run build` for pos, kds and web — all three succeed;
      `/admin-console/incidents`, `/admin-console/incidents/[id]` and
      `/admin-console/oncall` all present
- [x] **Live schema check:** `platform_incidents` has **0** `tenant_id`
      columns, 4 `platform_*` tables, RLS true on all 4, **0** policies
      (deny-all), and all 5 decision-driven columns present

**Bugs found and fixed during the build** — the run was task, self-check, fix,
next:

- **A fire-and-forget process-killer, in two places.** The ack scanner and the
  declare route both used a bare `void notifyPlatformTeam(...)`. An unhandled
  rejection terminates the process in Node 22, so one failing alert would have
  taken down the worker, and in the route's case the API. Caught by a test that
  made the notifier throw. Both now `.catch()` and log.
- **A reference-collision bug at SEV-YYYY-1000.** `generatePlatformReference`
  ordered by string, and the three-wide zero padding means `SEV-2026-1000`
  sorts _below_ `SEV-2026-999` — so past 999 it would have handed back 999
  forever and collided on the unique index on every insert. Now takes the
  year's maximum numerically.
- **A decorative column.** `postmortem_due_at` came from the spec and nothing
  ever wrote it. Now stamped on entry to `postmortem_due`; a deadline column
  nobody sets is how a deadline quietly stops being one.
- **An unused import** left behind by extracting the guard, caught by lint.

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

Added with B's plan:

- **`notifyPlatformTeam` is only as loud as web push is configured.** It sends to
  the platform tenant through `sendPushNotification`, which returns early when
  VAPID keys are unset — the test logs already show
  `[push] VAPID keys not configured — skipping`. If VAPID is not configured in
  production and no `PLATFORM_ALERT_WEBHOOK_URL` is set, **every platform alert
  goes nowhere silently.** Task 11 must verify one of the two transports
  actually delivers before the ack scanner is trusted.
- The customer-message split is a structural guarantee **only while the tenant
  endpoint keeps reshaping field by field**. A future `select('*')` or object
  spread there would put internal ops text on a merchant's screen, and no test
  outside `platform-notices.integration` would notice.
- The auto-detection threshold (100 errors per window) is **uncalibrated** — a
  starting number, not a measured one. That is why the flag ships off.
- Two vocabularies for severity across A and B is now two vocabularies for
  _assignment_ too: A assigns through `incident_rules`, B through an on-call
  rota. Deliberate, and a reader moving between them will feel it.
