# Verticals

Source of truth: [`packages/shared/src/verticals/index.ts`](../packages/shared/src/verticals/index.ts).

All vertical definitions (custom fields, pipeline stages, Maya intents, system prompt, business hours, follow-up cadence) live in that single registry. JSON files in the same directory are orphaned legacy artefacts — not imported anywhere — and should be treated as deprecated.

## Summary table

| Vertical      | Label             | Fields | Stages | Maya intents |
| ------------- | ----------------- | -----: | -----: | -----------: |
| `sales_crm`   | Sales CRM         |     12 |      7 |            6 |
| `dental`      | Dental practice   |     12 |      6 |            6 |
| `medical`     | Medical clinic    |     12 |      6 |            6 |
| `veterinary`  | Veterinary clinic |     12 |      7 |            6 |
| `salon`       | Salon & spa       |     12 |      6 |            6 |
| `restaurant`  | Restaurant        |     12 |      6 |            6 |
| `contractor`  | Contractor        |     12 |      7 |            6 |
| `law_firm`    | Law firm          |     12 |      7 |            6 |
| `real_estate` | Real estate       |     12 |      7 |            6 |

All verticals have exactly **one `is_won`** stage and at least one **`is_lost`** stage. All custom-field keys are `snake_case`, unique within the vertical, and must not duplicate universal contact columns (`full_name`, `phone`, `email`, `address`, `notes`, `tags`).

## Universal contact fields (NOT vertical fields)

These live on the `contacts` table directly — never re-add them to a vertical's `fields`:

- `full_name`, `phone`, `email`, `address`, `city`, `state`, `zip`
- `notes`, `tags`
- `source`, `lifecycle_stage`, `lead_score`, `assigned_to_user_id`

Vertical-specific values go in `contacts.vertical_data` (JSONB).

## Insurance / integrations — DEPRECATION NOTE

`insurance_id`, `insurance_provider`, and `insurance_plan_id` were previously defined as dental/medical custom fields. They are **no longer stored CRM fields**. Real-time eligibility and plan lookup are integration concerns (clearinghouse / payer API), not data that should be manually typed into a contact record.

- Existing tenant data in `contacts.vertical_data` that contains these keys is preserved (JSONB is schemaless) — nothing is deleted on migration.
- The dashboard contact form no longer renders these fields for new or existing contacts.
- Downstream reference in `0001_initial_schema.sql` (JSONB example comment), `nuatis-schema.sql` (doc dump), `apps/web/src/app/(demo)/demo/dashboard/page.tsx` (demo fixture), and `apps/api/src/voice/pre-call-lookup.test.ts` (test fixture) is intentional — these are illustrative strings, not config.
- The integration replacement ships in Phase 11+ (eligibility check lookup keyed by `date_of_birth` + tenant-configured payer credentials).

## Type reference

```ts
interface VerticalConfig {
  slug: string
  label: string
  fields: VerticalField[] // 8-12 industry-specific fields
  pipeline_stages: PipelineStageConfig[] // 5-7 stages incl. one win + one loss
  system_prompt_template: string // must contain {{business_name}}
  business_hours: BusinessHours
  follow_up_cadence: FollowUpStep[]
  maya_intents?: string[] // 3-8 intents (added v2)
}

interface PipelineStageConfig {
  name: string
  position: number
  color: string // 6-digit hex
  is_default?: boolean // first stage
  is_terminal?: boolean // no outgoing transitions
  is_won?: boolean // exactly one per vertical
  is_lost?: boolean // at least one per vertical
}
```

Supported `FieldType` values: `text`, `textarea`, `number`, `date`, `select`, `boolean`.

**Known gaps** (tracked for a future config-renderer pass, not blocking this release):

- Multi-select: `restaurant.dietary_restrictions`, `restaurant.favorite_occasions`, `real_estate.property_types` are currently modelled as `textarea` (comma-separated freeform) because `VerticalFieldRenderer` only handles single-select. Migrating to true multiselect requires both a `FieldType` addition and a renderer update.
- Currency: represented as `number` with `($)` suffix in the label. No formatting / locale handling yet.

## Adding a new vertical

1. Add a new entry to the `VERTICALS` object in `packages/shared/src/verticals/index.ts`. That's it — the registry is the single export point.
2. Add the vertical's slug to the website `VERTICAL_DATA` object in `index.html` + `why.html` (see `docs/vertical-popup-data.md`).
3. Run `npm run typecheck && npm test` — the parametrized `describe.each` in `apps/api/src/verticals.test.ts` will automatically exercise the new slug once it's added to the `EXPECTED_SLUGS` list there.

No migration is required — vertical values live in `contacts.vertical_data` JSONB.
