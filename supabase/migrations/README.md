# Nuatis — Database Migrations

## Convention

Each migration is a numbered SQL file:

- `0001_initial_schema.sql` — run once on a fresh database
- `0002_add_feature.sql` — each new change gets the next number
- Never edit a migration that has already been run in production **in any way
  that changes the resulting schema** — new changes always go in a new numbered
  file
- The one permitted exception: making an already-run migration **re-runnable**
  (`IF NOT EXISTS`, `DROP POLICY IF EXISTS` before `CREATE POLICY`). This
  changes no schema, and it turns an accidental second paste into a no-op
  instead of a confusing `42P07 already exists` error. Verify by re-running it
  and confirming the state is unchanged. Applied to 0195–0197 on 2026-09-11.

## How to run a new migration

1. Write your SQL in a new file: `XXXX_description.sql`
2. Run it in Supabase SQL editor
3. Commit the file to git

## How to check what is already applied

Don't guess from this log — it has drifted before. Ask the database:

```sql
-- Has a specific table landed?
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public' AND tablename = 'menu_items';

-- What has Supabase recorded, most recent first?
SELECT version, name FROM supabase_migrations.schema_migrations
ORDER BY version DESC LIMIT 20;
```

Note that `schema_migrations.version` holds Supabase's own timestamps, not
the `0001`-style numbers used for filenames here, so the two lists will not
look alike. The numbered filenames are this repo's convention; the database is
the authority on what actually ran.

**Next migration number: 0199.**

## Migration log

| File                         | Description                                       | Date       | Applied to prod |
| ---------------------------- | ------------------------------------------------- | ---------- | --------------- |
| 0001_initial_schema.sql      | Full schema — 17 tables, RLS, indexes, functions  | 2026-03-23 | yes             |
| …                            | (log unmaintained between 0002 and 0194)          |            |                 |
| 0195_pos_menu.sql            | POS menu model; widen `orders.source` to `'pos'`  | 2026-09-11 | yes — verified  |
| 0196_pos_kitchen_tickets.sql | Kitchen tickets + ticket items for the KDS        | 2026-09-11 | yes — verified  |
| 0197_pos_cash_drawer.sql     | Cash drawer sessions + cash events                | 2026-09-11 | yes — verified  |
| 0198_pos_terminal_pin.sql    | `staff_members.pos_pin_hash` + `pos_location_ids` | 2026-09-11 | yes — verified  |
| 0199_incidents.sql           | Incident tracking + `tasks.incident_id`           | 2026-09-15 | yes — verified  |

0195–0198 were applied 2026-09-11 and verified live: 9 tables, RLS on all 9,
9 `current_tenant_id()` policies, and `orders_source_check` reading
`['staff','maya','pos']`. They are written to be **re-runnable**, so pasting
one again is a no-op rather than an error.

0199 was applied 2026-09-15 and verified live: 4 incident tables, RLS true on
all 4, 4 `current_tenant_id()` policies, `incidents.cost_cents` as `integer`
(not `numeric`), plus `tasks.incident_id` and
`tenants.incident_auth_threshold_cents`. Re-running it is a no-op.

**Checking the next free number:** `max(name)` on
`supabase_migrations.schema_migrations` does _not_ work — the table holds
non-numeric names too, and `weekly_digest` sorts above `0198`. Order by the
numeric prefix instead:

```sql
select name from supabase_migrations.schema_migrations
 where name ~ '^[0-9]{4}' order by substring(name from '^[0-9]{4}')::int desc limit 5;
```
