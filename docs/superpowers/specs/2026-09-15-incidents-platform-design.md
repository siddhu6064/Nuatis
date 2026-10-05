# Incidents — Platform / Internal Ops — Design

**Status:** approved 2026-09-15. The four open decisions in §8 are resolved.
**Sub-project B of two.** Sub-project A (tenant core + POS surface) has its own
spec: `2026-09-15-incidents-tenant-design.md`, and is approved.

> Sub-project A went through a full design conversation; this one did not. The
> architecture below follows from A's split decision. The four product questions
> that were open are resolved in §8, two of them against the spec's original
> recommendation — read §8 before planning, because the scope is now larger than
> the sections above it describe.

---

## 1. What this is

Incident tracking for **Nuatis's own operations**: the API is down, the POS socket
is dropping connections, a migration locked a table. Audience is the Nuatis team,
not merchants.

Deliberately **not** the same system as tenant incidents. That decision and its
reasoning live in `2026-09-15-incidents-tenant-design.md` §1: a shared table would
put a `not a platform incident` predicate on every tenant read, on a codebase where
the service-role key bypasses RLS and application filters are the real boundary.

---

## 2. Where it lives

The admin console already exists — `routes/admin-console.ts`, and the
`(dashboard)/admin-console` page — with an established pattern for cross-tenant
internal work:

> a designated internal tenant (`PLATFORM_TENANT_ID`) whose `owner`-role login is
> trusted with cross-tenant reads

Platform incidents reuse it exactly. `requirePlatformOwner` is the existing guard;
no new auth mode, no superuser concept, no second credential.

This matters: the alternative — a tenant-less admin identity — was already
considered and rejected once when the admin console was built. Reintroducing it
for incidents would fork the platform's auth story for one feature.

---

## 3. Data model

```
platform_incidents
  id                uuid pk
  reference         text not null      -- SEV-2026-014
  severity          text not null      -- sev1 | sev2 | sev3 | sev4
  status            text not null      -- detected | acknowledged | mitigating
                                       --   | resolved | postmortem_due | closed
  title             text not null
  summary           text
  component         text               -- api | pos-socket | database | worker | web
  detected_at       timestamptz not null
  acknowledged_at   timestamptz
  acknowledged_by   uuid → users
  mitigated_at      timestamptz
  resolved_at       timestamptz
  postmortem        text               -- markdown, written after the fact
  postmortem_due_at timestamptz
  created_at, updated_at
```

**No `tenant_id`.** That absence is the whole point of the split and should be
commented in the migration so nobody "fixes" it later.

```
platform_incident_tenants
  incident_id, tenant_id, impact        -- full | partial | none
```

Which merchants were affected. A join table rather than a `jsonb` array, because
the question "was this tenant affected by anything last month" is one a support
conversation actually asks.

```
platform_incident_events
  incident_id, at, actor_user_id, kind, detail jsonb
```

Append-only timeline. The postmortem is written _from_ this, so the timeline has
to be captured while the incident is live — reconstructing it afterwards from
memory is how postmortems become fiction.

---

## 4. Severity

|          | Meaning                              | Ack target     |
| -------- | ------------------------------------ | -------------- |
| **SEV1** | Merchants cannot take money          | 15 min         |
| **SEV2** | A module is broken or badly degraded | 1 hour         |
| **SEV3** | Degraded, with a workaround          | 1 business day |
| **SEV4** | Cosmetic or internal-only            | Best effort    |

SEV1 is defined by _money_, not by component. The POS socket being down is a SEV2
— the kitchen screen stops updating but the register still takes payment. The
register failing to take payment is a SEV1. Anchoring the top severity to revenue
stops the scale drifting.

---

## 5. Lifecycle

```
detected → acknowledged → mitigating → resolved → postmortem_due → closed
```

SEV1 and SEV2 require a postmortem before `closed`; SEV3 and SEV4 skip to
`closed`. That rule is the only thing standing between "we had an outage" and
"we learned something", so it is enforced in the status transition map rather
than left to discipline — the same explicit `ALLOWED_TRANSITIONS` shape
`routes/orders.ts` already uses.

---

## 6. Surfaces

**Admin console** `/admin-console/incidents` — the list, the detail view with its
timeline, and the postmortem editor. Declaring an incident is one form: severity,
title, component.

**Tenant impact picker** — attach affected tenants from the existing cross-tenant
tenant list the admin console already renders.

---

## 7. Notifications

Reuses `lib/notifications.ts`, but the **target is the Nuatis team, not tenant
owners** — `notifyOwner` is the wrong function here and reaching for it would send
an internal outage notice to every merchant.

A new `notifyPlatformTeam` sends to a configured internal address list.
Environment-configured, not a table, until there is a reason for per-person
routing.

An ack-deadline scanner follows `invoice-overdue-scanner` exactly, as A's SLA
scanner does: a SEV1 undetected-by-a-human for 15 minutes escalates.

---

## 8. Resolved decisions

Resolved 2026-09-15. Two went against this spec's original recommendation, so
the reasoning is recorded rather than just the outcome.

**8.1 — On-call: a rota _and_ an assignee.** _(against the recommendation)_

The spec proposed assignee-only. Both are needed, and they are not the same
thing. The rota answers "who should pick this up right now"; the
`assigned_to_user_id` column records who actually owned it. Without the column,
an incident from last Tuesday would render as assigned to whoever is on call
today — the rota rotates and the historical record moves with it, which makes
the timeline lie. Without the rota, "whoever is awake" stays a manual question
at 3am.

So: a rota resolves the **default** assignee at declaration time, and the
result is written onto the incident as a fact.

**8.2 — Affected merchants are told, but only in words written for them.**

The spec recommended no tenant visibility. From a paying merchant's point of
view the worst outage experience is silence: they cannot tell whether the
problem is theirs or ours, so they file a ticket and wait. That is a bad
outcome we can fix cheaply, since `platform_incident_tenants` already records
who was affected.

The threat model concern is equally real — internal ops text ("migration locked
a table, rolling back") must never become customer-facing. Both are satisfied by
separating the channels rather than choosing between them:

- A dedicated `customer_message` column, **null by default**, plus an explicit
  `customer_message_published_at`. Nothing reaches a merchant until someone
  deliberately writes that text and publishes it.
- `title`, `summary`, `component` and the event timeline are **never** read by
  the tenant-facing endpoint. Internal wording cannot leak, because it is not on
  the path — a structural guarantee, not a review habit.
- In-app notice to affected tenants only. **No public status page in v1**: it is
  a different product with an unauthenticated surface, and
  `platform_incident_tenants` keeps it cheap later.

Default behaviour stays silent. Publishing is an act.

**8.3 — Manual now, Sentry auto-detection behind a flag that ships off.**

As recommended, plus the hook. A tracker that declares its own incidents before
anyone trusts its thresholds trains the team to ignore it, so detection ships
disabled and is switched on once thresholds are calibrated against real traffic.
Building the hook now means calibration is a config change rather than a
project.

**8.4 — Postmortem stays a `text` column.**

Merchants never read our postmortems; what they get from them is the same outage
not happening twice. What produces that is postmortems actually being written,
and the §5 transition gate is what produces _that_. The gate is only enforceable
if the postmortem is a field the API can check — a pointer into document storage
degrades it to "a link exists". Markdown in a column also stays diffable and
searchable next to the timeline it was written from.

### Scope consequences

8.1 and 8.2 make this larger than §§3–7 describe. The plan must add:

- `platform_oncall_shifts` (rota) and a "who is on call at time T" resolver
- `platform_incidents.assigned_to_user_id`
- `customer_message` + `customer_message_published_at`, and a tenant-facing
  read endpoint that can only ever see those two fields
- a Sentry detection hook, shipped disabled

---

## 9. Conventions that must be honored

### P1 — no `tenant_id`, on purpose _(landmine)_

The absence is load-bearing. Comment it in the migration.

### P2 — `requirePlatformOwner`, never a new auth mode

Reuse the existing guard from `routes/admin-console.ts`.

### P3 — internal notifications must never reach tenant owners

`notifyOwner` mails the merchant. Platform incidents need
`notifyPlatformTeam`. Getting this wrong emails every customer about an
internal outage.

### P4 — postmortem gate lives in the transition map

Not in the UI. A status change is an API operation and the rule belongs where the
transition is validated.

---

## 10. Scope

### In scope

- `platform_incidents`, `platform_incident_tenants`, `platform_incident_events`
- `/api/admin/incidents` behind `requirePlatformOwner`
- Admin console list, detail, timeline, postmortem editor
- Severity, lifecycle with the postmortem gate
- `notifyPlatformTeam` and an ack-deadline scanner

### Out of scope

- On-call rota (8.1), public status page (8.2), auto-detection (8.3)
- Anything tenant-facing

---

## 11. Testing

- Transition map: every legal move allowed, the postmortem gate blocks
  `resolved → closed` for SEV1/SEV2 and permits it for SEV3/SEV4
- `requirePlatformOwner` refuses an ordinary tenant owner — with a positive case
  alongside, so a blanket reject cannot pass for a guard
- `notifyPlatformTeam` never resolves a tenant owner address
- Ack-deadline scanner on a frozen clock

---

## 12. Open risks

- **Two incident systems, two vocabularies.** "Severity" means SEV1–4 here and
  low/medium/high/critical in the tenant system. Deliberate — merchants do not
  think in SEVs — but it will confuse anyone reading both schemas. Comment both.
- **Dogfooding pressure.** The temptation will be to merge this into the tenant
  module so Nuatis "uses its own product". That is how the cross-tenant leak in
  A §1 gets built. Resist it.
