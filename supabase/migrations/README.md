# Nuatis — Database Migrations

## Convention

Each migration is a numbered SQL file:

- `0001_initial_schema.sql` — run once on a fresh database
- `0002_add_feature.sql` — each new change gets the next number
- Never edit a migration that has already been run in production
- New changes always go in a new numbered file

## How to run a new migration

1. Write your SQL in a new file: `XXXX_description.sql`
2. Run it in Supabase SQL editor
3. Commit the file to git

## Migration log

| File                    | Description                                      | Date       |
| ----------------------- | ------------------------------------------------ | ---------- |
| 0001_initial_schema.sql | Full schema — 17 tables, RLS, indexes, functions | 2026-03-23 |
