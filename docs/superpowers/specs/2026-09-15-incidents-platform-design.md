# Incidents — Platform / Internal Ops — Design

**Status:** draft — carries open decisions, see §8. Not yet approved.
**Sub-project B of two.** Sub-project A (tenant core + POS surface) has its own
spec: `2026-09-15-incidents-tenant-design.md`, and is approved.

> **Read §8 before planning this.** Sub-project A went through a full design
> conversation; this one did not. The architecture below is settled — it follows
> from A's split decision — but four product questions are genuinely open and are
> marked as such rather than guessed at.

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

## 8. Open decisions — resolve before planning

**8.1 — On-call rota, or just an assignee?**
A rota (schedules, rotations, overrides, "who is on call right now") is a
substantial feature and there are good off-the-shelf products for it. Recommended:
**assignee only** for v1, and integrate PagerDuty later if the team grows past the
point where "whoever is awake" works. Not yet confirmed.

**8.2 — Do merchants ever see any of this?**
A public status page is a genuinely different product with a different threat
model — it is the one surface where internal ops text becomes customer-facing, and
a careless summary line becomes a support incident of its own. Recommended:
**no tenant visibility in v1**, with `platform_incident_tenants` making a future
status page cheap. Not yet confirmed.

**8.3 — Manual declaration only, or auto-detection?**
Sentry is already wired (`@sentry/node`). An error-rate spike could open a SEV3
automatically. Recommended: **manual only** in v1 — an incident tracker that
declares its own incidents before anyone trusts its thresholds trains the team to
ignore it. Not yet confirmed.

**8.4 — Where does the postmortem live?**
A `text` column is simplest and keeps it next to the timeline. The alternative is
the existing document storage. Recommended: **the column**, since postmortems are
markdown and want to be diffable and searchable alongside the incident, not
filed away. Not yet confirmed.

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
