# Multiple Pipelines + Revenue Forecasting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add support for multiple named pipelines (contacts + deals), per-stage probability, and revenue forecasting with funnel visualization to Nuatis CRM.

**Architecture:** A new `pipelines` parent table groups stages. Existing `pipeline_stages` gets a `pipeline_id` FK + `probability` column. Migration creates a default pipeline per tenant and links existing stages. Pipelines CRUD routes manage pipelines + nested stages. Pipeline switcher on contacts/deals pages filters by selected pipeline. Revenue forecast endpoint computes weighted values from deal probability × stage probability. Funnel chart and monthly forecast render via recharts.

**Tech Stack:** Express routes, Supabase PostgreSQL, Next.js 14 App Router, Tailwind v3, recharts (already installed).

**Key Codebase Facts:**

- Latest migration: `0037_review_notifs_assignment.sql` → new migration is `0038`
- pipeline_stages columns: id, tenant_id, name, position, color, is_default, is_terminal, created_at — NO pipeline_id, NO probability yet
- Contacts reference stages via `pipeline_stage` TEXT (stage name, NOT UUID FK)
- Deals reference stages via `pipeline_stage_id` UUID FK to pipeline_stages
- Deals already have `probability` column (0-100) — per-deal probability
- Stages endpoint: GET /api/contacts/stages (in contacts.ts) — returns id, name, position, color
- No separate pipeline route file — stage CRUD is in contacts.ts
- Pipeline page: server component, groups contacts by pipeline_stage name
- DealsKanban: groups by pipeline_stage_id, fetches stages from /api/contacts/stages
- Existing insights/deals endpoint: returns total_pipeline_value, weighted_pipeline_value, deals_by_stage
- recharts imports: `LineChart, Line, BarChart, Bar, PieChart, Pie, AreaChart, Area, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend`
- Sidebar NAV: 29 entries, last is '/settings'

---

## File Structure

### New Files — API

| File                                              | Responsibility                                                       |
| ------------------------------------------------- | -------------------------------------------------------------------- |
| `supabase/migrations/0038_multiple_pipelines.sql` | pipelines table, pipeline_id + probability on stages, data migration |
| `apps/api/src/routes/pipelines.ts`                | Pipelines CRUD + nested stages CRUD                                  |

### New Files — Web

| File                                                       | Responsibility                       |
| ---------------------------------------------------------- | ------------------------------------ |
| `apps/web/src/app/(dashboard)/settings/pipelines/page.tsx` | Pipeline settings with stage builder |

### Modified Files

| File                                                          | Change                                                   |
| ------------------------------------------------------------- | -------------------------------------------------------- |
| `apps/api/src/routes/contacts.ts`                             | Add ?pipeline_id filter to GET /, update stages endpoint |
| `apps/api/src/routes/deals.ts`                                | Add ?pipeline_id filter to GET /                         |
| `apps/api/src/routes/insights.ts`                             | Add pipeline-forecast and pipeline-funnel endpoints      |
| `apps/api/src/index.ts`                                       | Mount pipelines routes                                   |
| `apps/web/src/app/(dashboard)/pipeline/page.tsx`              | Add pipeline switcher                                    |
| `apps/web/src/app/(dashboard)/deals/DealsKanban.tsx`          | Add pipeline switcher                                    |
| `apps/web/src/app/(dashboard)/insights/InsightsDashboard.tsx` | Add forecast section                                     |
| `apps/web/src/app/(dashboard)/Sidebar.tsx`                    | Add Pipelines nav item                                   |

---

## Task 1: Database Migration

**Files:**

- Create: `supabase/migrations/0038_multiple_pipelines.sql`

- [ ] **Step 1: Create migration**

Create `supabase/migrations/0038_multiple_pipelines.sql`:

```sql
-- Pipelines parent table
CREATE TABLE pipelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  pipeline_type TEXT NOT NULL DEFAULT 'contacts' CHECK (pipeline_type IN ('contacts', 'deals')),
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON pipelines
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM users WHERE authjs_user_id = auth.uid()));
CREATE INDEX idx_pipelines_tenant ON pipelines(tenant_id);

-- Add pipeline_id + probability to existing pipeline_stages
ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS pipeline_id UUID REFERENCES pipelines(id);
ALTER TABLE pipeline_stages ADD COLUMN IF NOT EXISTS probability INTEGER DEFAULT 0 CHECK (probability >= 0 AND probability <= 100);

-- Migrate existing stages: create a default pipeline per tenant, link stages
DO $$
DECLARE
  t RECORD;
  default_pipeline_id UUID;
BEGIN
  FOR t IN SELECT DISTINCT tenant_id FROM pipeline_stages LOOP
    INSERT INTO pipelines (tenant_id, name, description, is_default, pipeline_type)
    VALUES (t.tenant_id, 'Default Pipeline', 'Default contact pipeline', true, 'contacts')
    RETURNING id INTO default_pipeline_id;

    UPDATE pipeline_stages SET pipeline_id = default_pipeline_id WHERE tenant_id = t.tenant_id AND pipeline_id IS NULL;
  END LOOP;
END $$;

-- Set probability defaults based on stage name patterns
UPDATE pipeline_stages SET probability = 10 WHERE LOWER(name) LIKE '%new%' OR LOWER(name) LIKE '%inquiry%';
UPDATE pipeline_stages SET probability = 30 WHERE LOWER(name) LIKE '%contact%' OR LOWER(name) LIKE '%reach%';
UPDATE pipeline_stages SET probability = 50 WHERE LOWER(name) LIKE '%estimate%' OR LOWER(name) LIKE '%proposal%' OR LOWER(name) LIKE '%quote%';
UPDATE pipeline_stages SET probability = 70 WHERE LOWER(name) LIKE '%negotiat%' OR LOWER(name) LIKE '%follow%';
UPDATE pipeline_stages SET probability = 90 WHERE LOWER(name) LIKE '%accept%' OR LOWER(name) LIKE '%commit%';
UPDATE pipeline_stages SET probability = 100 WHERE LOWER(name) LIKE '%won%' OR LOWER(name) LIKE '%closed%' OR LOWER(name) LIKE '%complete%';
UPDATE pipeline_stages SET probability = 0 WHERE LOWER(name) LIKE '%lost%' OR LOWER(name) LIKE '%cancel%' OR LOWER(name) LIKE '%archive%';

CREATE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline ON pipeline_stages(pipeline_id);
```

Note: pipeline_id stays nullable in the schema (for tenants that may not have stages yet). The DO block handles existing data.

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0038_multiple_pipelines.sql
git commit -m "feat(pipelines): add pipelines table, pipeline_id + probability on stages"
```

---

## Task 2: Pipelines CRUD API

**Files:**

- Create: `apps/api/src/routes/pipelines.ts`

- [ ] **Step 1: Create pipelines.ts**

All routes use requireAuth. Endpoints:

### Pipeline CRUD:

- **GET /api/pipelines** — list pipelines for tenant with stage count. Optional ?type=contacts|deals filter.
- **GET /api/pipelines/:id** — single pipeline with all stages (ordered by position) + contact/deal counts per stage
- **POST /api/pipelines** — create pipeline with optional inline stages. Body: { name, description?, pipelineType, stages?: { name, color?, probability?, position? }[] }. Max 10 pipelines per tenant. If first of type: is_default=true.
- **PUT /api/pipelines/:id** — update name/description. Cannot change pipelineType.
- **DELETE /api/pipelines/:id** — cannot delete if is_default or has contacts/deals in stages
- **PUT /api/pipelines/:id/set-default** — set as default, unset previous

### Nested stages CRUD:

- **GET /api/pipelines/:pipelineId/stages** — list stages for pipeline
- **POST /api/pipelines/:pipelineId/stages** — create stage { name, color?, probability?, position? }
- **PUT /api/pipelines/:pipelineId/stages/:stageId** — update stage (name, color, probability, position)
- **DELETE /api/pipelines/:pipelineId/stages/:stageId** — cannot delete if contacts/deals in stage
- **PUT /api/pipelines/:pipelineId/stages/reorder** — body: { stageIds: string[] } — update positions

For contact counts: query contacts WHERE pipeline_stage = stage.name AND tenant_id
For deal counts: query deals WHERE pipeline_stage_id = stage.id AND tenant_id AND NOT is_archived

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/routes/pipelines.ts
git commit -m "feat(pipelines): add pipelines CRUD with nested stages"
```

---

## Task 3: Revenue Forecasting API

**Files:**

- Modify: `apps/api/src/routes/insights.ts`

- [ ] **Step 1: Add forecast + funnel endpoints**

### GET /api/insights/pipeline-forecast

- Params: ?pipeline_id (optional, defaults to default deals pipeline), ?months=3
- For each stage in the pipeline: count deals, sum values, compute weighted_value = sum(deal.value × stage.probability / 100)
- monthly_forecast: group deals by close_date month (next N months), sum weighted values
- win_rate: is_closed_won / (is_closed_won + is_closed_lost) for last 90 days
- avg_days_to_close: for won deals, average(close_date - created_at) in days
- Return: { pipeline, stages[], summary: { total_pipeline_value, total_weighted_value, deal_count, avg_deal_value, monthly_forecast[], win_rate, avg_days_to_close } }

### GET /api/insights/pipeline-funnel

- Params: ?pipeline_id (optional)
- Return stages with count, total_value, drop_off_pct between consecutive stages

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/routes/insights.ts
git commit -m "feat(pipelines): add pipeline forecast and funnel insight endpoints"
```

---

## Task 4: Contacts + Deals API Pipeline Filter

**Files:**

- Modify: `apps/api/src/routes/contacts.ts`
- Modify: `apps/api/src/routes/deals.ts`

- [ ] **Step 1: Add pipeline_id filter to contacts**

In GET /api/contacts: add ?pipeline_id query param. If provided, fetch stage names for that pipeline, then filter contacts where pipeline_stage IN those stage names.

Update GET /api/contacts/stages: accept optional ?pipeline_id query param. If provided, filter stages by pipeline_id. If not, return stages from the default contacts pipeline.

- [ ] **Step 2: Add pipeline_id filter to deals**

In GET /api/deals: add ?pipeline_id query param. If provided, fetch stage IDs for that pipeline, filter deals where pipeline_stage_id IN those IDs.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/contacts.ts apps/api/src/routes/deals.ts
git commit -m "feat(pipelines): add pipeline_id filter to contacts and deals endpoints"
```

---

## Task 5: Wire Routes

**Files:**

- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Mount pipelines routes**

```typescript
import pipelinesRouter from './routes/pipelines.js'
app.use('/api/pipelines', pipelinesRouter)
```

- [ ] **Step 2: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat(pipelines): mount pipelines routes in Express app"
```

---

## Task 6: Pipeline Switcher on Contacts + Deals Pages

**Files:**

- Modify: `apps/web/src/app/(dashboard)/pipeline/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/deals/DealsKanban.tsx`

- [ ] **Step 1: Add pipeline switcher to contacts pipeline page**

In pipeline/page.tsx:

- Fetch pipelines list: GET /api/pipelines?type=contacts
- Render tab bar / dropdown above the Kanban board showing available contact pipelines
- Default to the pipeline marked is_default
- On switch: re-fetch contacts filtered by pipeline_id, update stage columns
- URL param: ?pipeline=xxx for persistence
- "Manage Pipelines" link to /settings/pipelines

Since this is currently a server component, it may need to become a client component or use a client wrapper for the pipeline switcher interactivity.

- [ ] **Step 2: Add pipeline switcher to deals Kanban**

In DealsKanban.tsx:

- Same pattern: fetch pipelines?type=deals, tab bar, default to is_default
- Re-fetch deals + stages filtered by pipeline_id on switch
- URL param: ?pipeline=xxx

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(dashboard)/pipeline/page.tsx" "apps/web/src/app/(dashboard)/deals/DealsKanban.tsx"
git commit -m "feat(pipelines): add pipeline switcher to contacts and deals pages"
```

---

## Task 7: Pipeline Settings Page

**Files:**

- Create: `apps/web/src/app/(dashboard)/settings/pipelines/page.tsx`
- Modify: `apps/web/src/app/(dashboard)/Sidebar.tsx`

- [ ] **Step 1: Create pipeline settings page**

Two sections: "Contact Pipelines" and "Deal Pipelines" (tabs).

Each section shows:

- List of pipelines: name, stage count, "Default" badge, edit/delete buttons
- "Create Pipeline" button → modal with:
  - Name, description, type (contacts/deals)
  - Stage builder: list of stages with name, color dropdown/input, probability % input, position
  - "Add Stage" button, Move Up/Move Down arrows, delete button
  - Save → POST /api/pipelines with stages array

Edit pipeline → same modal pre-populated, PUT /api/pipelines/:id + individual stage PUT calls.

Delete: confirmation, blocked if has contacts/deals.

Set Default button on each pipeline.

Stage probability: number input 0-100 with thin visual bar showing width%.

- [ ] **Step 2: Add sidebar nav**

Add before '/settings':

```typescript
{ href: '/settings/pipelines', label: 'Pipelines', icon: '🔀', suiteOnly: true },
```

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(dashboard)/settings/pipelines/page.tsx" "apps/web/src/app/(dashboard)/Sidebar.tsx"
git commit -m "feat(pipelines): add pipeline settings page with stage builder"
```

---

## Task 8: Revenue Forecasting UI

**Files:**

- Modify: `apps/web/src/app/(dashboard)/insights/InsightsDashboard.tsx`

- [ ] **Step 1: Add Pipeline Forecast section**

Add a new section below existing analytics panels:

**Stat cards**: Total Pipeline Value, Weighted Forecast, Win Rate, Avg Days to Close

**Monthly forecast bar chart** (recharts BarChart):

- X: months, Y: dollar values, bars: weighted expected revenue
- Tooltip: deal count + value

**Pipeline funnel** (horizontal BarChart):

- Each bar = stage, width proportional to deal count or value
- Show drop-off % between stages
- Color-coded by stage color

**Pipeline selector**: dropdown to switch between deal pipelines

**Expected This Month** card: sum of weighted values for deals closing this month, with month-over-month comparison

**Deals table**: sortable table showing open deals with title, value, stage, close_date, probability, weighted value, contact name

Fetch: GET /api/insights/pipeline-forecast + GET /api/insights/pipeline-funnel

- [ ] **Step 2: Commit**

```bash
git add "apps/web/src/app/(dashboard)/insights/InsightsDashboard.tsx"
git commit -m "feat(pipelines): add revenue forecast section with charts to insights"
```

---

## Task 9: Run Tests & Verify

- [ ] **Step 1: Run tests**

```bash
npm test
```

Expected: 52/52 passing.

- [ ] **Step 2: Report**

```bash
git log --oneline -3
```

---

## Summary of All Route Registrations

| Route                                    | Auth        | File         |
| ---------------------------------------- | ----------- | ------------ |
| `GET /api/pipelines`                     | requireAuth | pipelines.ts |
| `GET /api/pipelines/:id`                 | requireAuth | pipelines.ts |
| `POST /api/pipelines`                    | requireAuth | pipelines.ts |
| `PUT /api/pipelines/:id`                 | requireAuth | pipelines.ts |
| `DELETE /api/pipelines/:id`              | requireAuth | pipelines.ts |
| `PUT /api/pipelines/:id/set-default`     | requireAuth | pipelines.ts |
| `GET /api/pipelines/:pid/stages`         | requireAuth | pipelines.ts |
| `POST /api/pipelines/:pid/stages`        | requireAuth | pipelines.ts |
| `PUT /api/pipelines/:pid/stages/:sid`    | requireAuth | pipelines.ts |
| `DELETE /api/pipelines/:pid/stages/:sid` | requireAuth | pipelines.ts |
| `PUT /api/pipelines/:pid/stages/reorder` | requireAuth | pipelines.ts |
| `GET /api/insights/pipeline-forecast`    | requireAuth | insights.ts  |
| `GET /api/insights/pipeline-funnel`      | requireAuth | insights.ts  |
