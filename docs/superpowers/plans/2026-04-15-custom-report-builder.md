# Custom Report Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a custom report builder that lets tenants create, configure, and pin dynamic reports with chart visualization across all CRM data objects.

**Architecture:** Reports table stores config (object, metric, group_by, filters, chart_type). A report engine fetches filtered data from Supabase, aggregates in JS, and returns chart-ready results. Reports are cached in Redis (1h TTL). A builder wizard guides users through 6 steps. Pinned reports appear on the Insights dashboard. Vertical starter reports are seeded per tenant.

**Tech Stack:** Express routes, Supabase PostgreSQL, ioredis (already installed), Next.js 14, Tailwind v3, recharts.

**Key Facts:**

- Latest migration: `0040` → new is `0041`
- ioredis `^5.10.1` installed, REDIS_URL env var available
- Recharts fully imported in InsightsDashboard.tsx (BarChart, LineChart, PieChart, etc.)
- StatCard component defined inline in InsightsDashboard.tsx
- Sidebar NAV: main section entries 1-13 (Dashboard through Tasks), then settings section
- Quotes: `total` column (numeric). Tasks: `priority`, `completed_at`, `due_date`, `assigned_to_user_id`

---

## Task 1: Migration 0041

- Create `supabase/migrations/0041_reports.sql` — reports table with RLS

## Task 2: Report Engine

- Create `apps/api/src/lib/report-engine.ts` — executeReport function with filter/group/aggregate logic, Redis caching

## Task 3: Reports CRUD API

- Create `apps/api/src/routes/reports.ts` — CRUD + execute + pin + refresh

## Task 4: Seed Script

- Create `apps/api/src/scripts/seed-reports.ts` — 3 starter reports per vertical

## Task 5: Wire Routes

- Mount reports routes in index.ts

## Task 6: Report Builder Page (Frontend)

- Create `apps/web/src/app/(dashboard)/reports/page.tsx` — list + builder wizard
- Create `apps/web/src/app/(dashboard)/reports/[id]/page.tsx` — report view with chart + table

## Task 7: Pinned Reports on Insights

- Modify InsightsDashboard.tsx — add Custom Reports section with pinned reports

## Task 8: Sidebar Nav

- Add "Reports" to main nav section (between Quotes and Tasks)

## Task 9: Run Tests & Verify
