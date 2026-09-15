# Incidents — Tenant Core + POS Surface — Design

**Status:** approved, not yet implemented
**Sub-project A of two.** Sub-project B (platform incidents) has its own spec:
`2026-09-15-incidents-platform-design.md`.

---

## 1. Decision: two systems, not one and not three

"Incident management" was asked for across three audiences: in-store POS incidents,
internal platform outages, and a general tenant-facing tracker. They share a word,
not a data model.

**The POS surface and the general tracker are one system.** The POS case is the
general case specialised: same tenant scope, same triage lifecycle, same
permissions, plus a link to the order or ticket that went wrong, a cost, and
restaurant-shaped reason codes. One core, two surfaces.

**Platform incidents are separate.** They are not tenant data — they are Nuatis's
own infrastructure, cross-tenant, admin-scoped, with a different lifecycle
(detect → ack → mitigate → postmortem) and a different audience.

### Why not one table with a scope column

Every tenant-facing query would need `and not a platform incident`. This codebase
runs POS and most routes on the **service-role key, which bypasses RLS** — the
application-level `.eq('tenant_id', …)` is the real boundary, as
`docs/.../kitchen-pos-kds-design.md` L2 records. A predicate that must be
remembered on every read is a cross-tenant leak waiting for one omission.

The cost of splitting is a duplicated status enum. The cost of merging is a leak.

### Why not three systems

The POS tracker and the general tracker would each need triage, assignment,
severity, SLA and reporting. Writing that twice guarantees they diverge, and the
POS one would be the neglected copy.

---

## 2. Relationship to `tasks`

`tasks` already exists (0023): tenant-scoped, `assigned_to_user_id`, `priority`,
`due_date`, `completed_at`. An incident tracker overlaps it enough that building
one beside it risks two half-used inboxes.

They stay separate, because **a task is "do this" and an incident is "this went
wrong."** An incident carries severity, a cost, a root cause, a link to the thing
that failed, and feeds month-end reporting that a to-do list has no business
answering.

`tasks` gains one nullable column, `incident_id`, so follow-up work
("retrain Carlos on allergens") is an ordinary task that points back at its cause.
No task field is duplicated onto incidents.

---

## 3. Money: recorded, never moved

An incident carries `cost_cents` and nothing else happens. No refund, no drawer
event, no payment-provider call.

This is a deliberate limit, not an oversight. **POS card payment is still a
simulated stub** — `useCheckout` has one `await` marked `DEMO:` standing in for
approval. There is no captured payment to refund. The existing refund path
(0189) is wired to Square quote payments and Stripe fee charges, not to POS card
sales.

Recording delivers the reporting value immediately — "we comped $412 and binned
$88 this month" — without building a refund integration against a payment that
does not exist. Moving money waits for Stripe Terminal.

**Money follows the existing discipline:** `cost_cents` is an integer in the
database _and_ in TypeScript. This deliberately departs from `orders`, which
stores `numeric(10,2)`, because incidents have no generated columns to stay
compatible with and integer cents removes a conversion at every boundary. All
arithmetic goes through `@nuatis/pos-core`.

---

## 4. Authorisation: threshold, plus the reporting that makes it safe

Comping food is a classic theft vector. A cashier who can comp freely can comp a
friend's meal and the books look fine.

**Above a per-tenant threshold (default $10), an incident carrying a cost requires
a manager PIN,** recorded as `authorised_by_staff_id`. Below it, the cashier's own
session is enough. Zero-cost incidents — a logged complaint, a noted late order —
never prompt, because friction there just stops people reporting.

The threshold has a known weakness: a cashier who learns it is $10 can comp $9.99
all shift. The mitigation is not a lower threshold, it is **visibility** — the
manager view totals comps per staff member, so the pattern is obvious. That
report is in scope for this spec precisely because the threshold is what makes it
necessary.

PIN verification reuses `lib/pos-pin.ts` (scrypt, `node:crypto`) and the staff PIN
rows from 0198. No new credential.

**Who counts as a manager is an explicit flag, not a role string.**
`staff_members.role` is free text job titles in this schema — "Head Chef",
"Front of House", "Cashier" — so a `role = 'manager'` check matches nothing in
production and would refuse every comp forever. Migration 0200 adds
`staff_members.pos_can_authorise`, defaulting to **false**: nobody can authorise
until deliberately granted, which is the fail-closed direction for a control
that exists to stop staff comping their friends' meals.

---

## 5. Data model

### Reused as-is

- `tenants`, `locations`, `staff_members`, `users`
- `orders`, `kitchen_tickets` — the things an incident points at
- `tasks` — gains `incident_id` only

### New tables

```
incidents
  id                      uuid pk
  tenant_id               uuid not null → tenants
  reference               text not null          -- INC-1042, human-callable
  type_key                text not null          -- → incident_types.key
  severity                text not null          -- low | medium | high | critical
  status                  text not null          -- open | triaged | in_progress
                                                 --   | resolved | cancelled
  title                   text not null
  description             text
  cost_cents              integer not null default 0
  location_id             uuid → locations
  order_id                uuid → orders          -- the POS link
  kitchen_ticket_id       uuid → kitchen_tickets
  reported_by_staff_id    uuid → staff_members   -- PIN-authenticated reporter
  reported_by_user_id     uuid → users           -- dashboard reporter
  authorised_by_staff_id  uuid → staff_members   -- manager PIN, above threshold
  assigned_to_user_id     uuid → users
  sla_due_at              timestamptz
  resolved_at             timestamptz
  root_cause              text
  resolution_notes        text
  created_at, updated_at  timestamptz
```

Two reporter columns, both nullable, because the register authenticates a
`staff_members` row by PIN while the dashboard authenticates a `users` row. They
are different identity spaces; collapsing them would mean inventing a user for
every cashier.

```
incident_types
  tenant_id, key, label, default_severity, requires_cost, sort_order, deleted_at
```

Tenant-editable taxonomy seeded per vertical, following the `vertical_configs.
field_definitions` precedent in `lib/custom-fields.ts` rather than a hard-coded
enum. A restaurant gets Wrong item / Allergy / Dropped / Late / Equipment; a
property manager gets Leak / Heating / Access / Damage.

```
incident_rules
  tenant_id, when, match_type_key, match_severity,
  action, target_user_id, delay_minutes, enabled

incident_events
  incident_id, tenant_id, at, actor_kind, actor_id, kind, detail jsonb
```

`incident_events` is append-only — the timeline of who did what. Status changes,
assignment, authorisation and resolution all write one row. This is what makes an
incident auditable, which matters most for the ones with money attached.

---

## 6. Escalation: rules as rows, plus automation triggers

Two mechanisms, deliberately.

**Built-in rules** live in `incident_rules` and are evaluated by the SLA scanner.
Self-contained, so escalation works for any tenant with the incidents module.

**Automation triggers** are emitted alongside — `incident_created`,
`incident_breached` — so a tenant who _also_ has the automation module can build
arbitrary escalation with the engine that already exists.

Built-in rules first, because automation is a separate paid module and a tenant on
incidents alone must still get escalation. The emit is a few lines and costs
nothing if nobody is listening.

---

## 7. SLA and breach detection

`sla_due_at` is derived from severity at creation, using per-tenant durations
(default: critical 1h, high 4h, medium 1 business day, low 3 days).

Breach detection is **one new worker**, `incident-sla-scanner`, modelled directly
on `workers/invoice-overdue-scanner.ts`: BullMQ queue, `getPausedTenants`,
`notifyOwner`. There are 33 workers on this pattern; this is the 34th, not a new
subsystem.

**Constraint:** `notifyOwner` dispatches push and email but **not SMS** — the SMS
branch is commented out in `lib/notifications.ts` pending a personal phone field
on `users`. Escalation therefore cannot promise SMS today. Do not design a UI that
offers it.

**Recurrence detection is a query, not an engine.** "This is the 4th leak in 4B"
is a `GROUP BY type_key, location_id` over a trailing window, surfaced in the
dashboard. Building a detection engine for a `GROUP BY` would be inventing work.

---

## 8. Surfaces

**Register** — "Report issue" on the current order or a recent one. Pick a type,
enter a cost, manager PIN if above threshold. Must not slow down a queue: the
whole flow is one dialog.

**KDS** — report against a ticket. Remakes and drops are noticed in the kitchen,
not at the counter, and making a cook walk to the register to log one means it
never gets logged.

**Dashboard** `/incidents` — the queue: triage, assign, resolve, filter by type,
severity and status. Plus the manager reporting view: cost by type this month,
comps per staff member, recurrence.

---

## 9. Module and plan registration

A new `incidents` module key in `config/stripe-plans.ts`, following the `pos`
precedent exactly.

**Basic incident capture rides with `pos`.** A `pos_only` restaurant can log a comp
and see its month-end totals without buying anything — the register and KDS report
flows, and the cost reporting, are part of running a till.

**The tracker needs `incidents`.** The queue, assignment, SLA, escalation rules and
the recurrence view are the module. This is an upsell, not a paywall on something
that already worked.

`defaultEntitlement` gets the new key; `pos_only` does not imply `incidents`.

---

## 10. Conventions that must be honored

### L1 — service-role bypasses RLS _(landmine)_

Every incident route runs on `getServiceClient()`. RLS policies are defence in
depth; the live boundary is application-level `.eq('tenant_id', …)`. Every foreign
key arriving in a request body — `order_id`, `kitchen_ticket_id`,
`assigned_to_user_id`, `type_key` — must be proven to belong to the caller's
tenant before it is written, exactly as `ownsRow()` does in `routes/pos/menu.ts`.

### L2 — RLS uses `current_tenant_id()`, not the JWT path

Match the existing migrations, not the `auth.jwt()->'app_metadata'` form.

### L3 — money is integer cents end to end

`cost_cents integer`, never `numeric`. All arithmetic via `@nuatis/pos-core`.

### L4 — the POS token is confined to `/api/pos/*`

`portalScope: 'pos'` is enforced by `requireAuth` against a fail-closed prefix map.
The register and KDS report flows must therefore live under `/api/pos/incidents`,
**not** `/api/incidents`. The dashboard uses `/api/incidents`. Two route prefixes
over one core service module — the same shape the orders split already took.

### L5 — incidents never cross locations on the KDS

A ticket-linked incident inherits the ticket's `location_id`. Location filtering
happens server-side, as `lib/pos-ws.ts` does for tickets.

### L6 — reference numbers restart per tenant, not globally

`INC-1042` follows `generateOrderNumber`'s counter pattern. The known race there
(select-then-update) is acceptable at incident volumes, but the uniqueness index
is the real guard.

---

## 11. Scope

### In scope

- `incidents`, `incident_types`, `incident_rules`, `incident_events` tables
- `tasks.incident_id`
- `/api/pos/incidents` (register + KDS) and `/api/incidents` (dashboard)
- Manager-PIN authorisation above a per-tenant threshold
- Register and KDS report dialogs
- Dashboard queue, triage, assignment, resolution
- Manager reporting: cost by type, comps per staff member, recurrence
- `incident-sla-scanner` with escalation rules and notifications
- `incident_created` / `incident_breached` automation triggers
- `incidents` module registration

### Out of scope

- **Moving money.** No refunds, no drawer adjustments. Waits for Stripe Terminal.
- **Customer-facing incident status.** No portal view of "your complaint".
- **Photo attachments.** Real for property damage; needs a storage decision that
  belongs in its own slice.
- **Platform incidents.** Sub-project B.

---

## 12. Testing

Matches the repo's posture: logic-level, no component-testing library.

- Money and threshold arithmetic — pure, in `pos-core` style
- Tenant-ownership enforcement on every foreign key, with **positive** cases so a
  blanket reject cannot pass as a guard (the menu routes learned this)
- Authorisation: below threshold succeeds without a PIN, above fails without one,
  above succeeds with a manager PIN, a non-manager PIN is refused
- SLA derivation and breach selection, on a frozen clock
- Scanner: paused tenants skipped, breach notified once not repeatedly
- Surfaces verified in the browser, not snapshot-tested

---

## 13. Open risks

- **Threshold gaming.** Mitigated by per-staff reporting, not prevented. A
  determined cashier can still comp under the line; the report is what surfaces it.
- **Type taxonomy churn.** Tenant-editable types mean reports must group by
  `type_key` with deleted types still resolvable, or last month's numbers change
  when someone renames a category.
- **Notification volume.** A tenant with a low SLA and many incidents could
  generate a lot of owner notifications. `getPausedTenants` gives the same escape
  hatch every other scanner has, but the defaults should be conservative.
- **The `pos` / `incidents` entitlement line.** If customers find basic capture
  useless without the queue, the split is wrong and capture should move behind the
  module. Worth revisiting after the first real tenant.
