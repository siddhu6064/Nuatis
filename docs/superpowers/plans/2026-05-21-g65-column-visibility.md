# G65 Column Visibility Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Columns" dropdown to contacts, appointments, and tasks list views that persists column visibility in localStorage.

**Architecture:** A shared `ColumnsButton` component renders a checkbox dropdown; a `useColumnVisibility` hook reads/writes `localStorage`. Contacts has a real table — `<th>/<td>` are conditionally rendered per column. Appointments uses react-big-calendar (no table) and tasks uses a card layout — both get the button with a TODO comment for future table column gating.

**Tech Stack:** Next.js 14, TypeScript, React hooks, Tailwind CSS, localStorage

---

## File Map

| File                                                                 | Action     | Role                                       |
| -------------------------------------------------------------------- | ---------- | ------------------------------------------ |
| `apps/web/src/components/ColumnsButton.tsx`                          | **Create** | Reusable dropdown checkbox toggle          |
| `apps/web/src/hooks/useColumnVisibility.ts`                          | **Create** | localStorage-backed visibility hook        |
| `apps/web/src/components/contacts/ContactsList.tsx`                  | **Modify** | Add ColumnsButton + conditional th/td      |
| `apps/web/src/app/(dashboard)/appointments/AppointmentsCalendar.tsx` | **Modify** | Add ColumnsButton (no table, TODO comment) |
| `apps/web/src/components/tasks/TasksDashboard.tsx`                   | **Modify** | Add ColumnsButton (no table, TODO comment) |

---

### Task 1: Create the shared ColumnsButton component

**Files:**

- Create: `apps/web/src/components/ColumnsButton.tsx`

- [ ] **Step 1: Write the component file**

```tsx
'use client'
import { useState, useRef, useEffect } from 'react'

export interface ColumnDef {
  key: string
  label: string
}

interface Props {
  columns: ColumnDef[]
  visible: Record<string, boolean>
  onChange: (key: string, visible: boolean) => void
}

export function ColumnsButton({ columns, visible, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="h-8 flex items-center gap-1.5 px-3 rounded-lg border border-border-brand text-sm text-ink3 hover:text-ink hover:bg-bg transition-colors"
      >
        <svg
          className="w-3.5 h-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
          />
        </svg>
        Columns
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-50 bg-white border border-border-brand rounded-xl shadow-lg p-3 min-w-[180px]">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink4 mb-2">
            Show columns
          </p>
          {columns.map((col) => (
            <label
              key={col.key}
              className="flex items-center gap-2 py-1 cursor-pointer select-none"
            >
              <input
                type="checkbox"
                checked={visible[col.key] ?? true}
                onChange={(e) => onChange(col.key, e.target.checked)}
                className="accent-teal-600 w-3.5 h-3.5"
              />
              <span className="text-sm text-ink">{col.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify the file was created correctly**

```bash
cat apps/web/src/components/ColumnsButton.tsx
```

Expected: file prints with `ColumnsButton` export and `ColumnDef` interface.

- [ ] **Step 3: Commit**

```bash
cd /Users/sidyennamaneni/Documents/Nuatis/nuatis
git add apps/web/src/components/ColumnsButton.tsx
git commit -m "feat(g65): add reusable ColumnsButton component"
```

---

### Task 2: Create the useColumnVisibility hook

**Files:**

- Create: `apps/web/src/hooks/useColumnVisibility.ts`

- [ ] **Step 1: Create the hooks directory (if needed) and write the hook**

```bash
mkdir -p apps/web/src/hooks
```

```typescript
'use client'
import { useState, useEffect } from 'react'

export function useColumnVisibility(storageKey: string, defaults: Record<string, boolean>) {
  const [visible, setVisible] = useState<Record<string, boolean>>(defaults)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        setVisible({ ...defaults, ...JSON.parse(stored) })
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  function toggle(key: string, isVisible: boolean) {
    const next = { ...visible, [key]: isVisible }
    setVisible(next)
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
    } catch {}
  }

  return { visible, toggle }
}
```

Note: `defaults` is intentionally excluded from the `useEffect` dependency array — it is a constant object defined outside the component, and re-running on every render would undo user selections.

- [ ] **Step 2: Verify**

```bash
cat apps/web/src/hooks/useColumnVisibility.ts
```

Expected: file prints with `useColumnVisibility` function export.

- [ ] **Step 3: Commit**

```bash
cd /Users/sidyennamaneni/Documents/Nuatis/nuatis
git add apps/web/src/hooks/useColumnVisibility.ts
git commit -m "feat(g65): add useColumnVisibility hook with localStorage persistence"
```

---

### Task 3: Wire column visibility into ContactsList

**Files:**

- Modify: `apps/web/src/components/contacts/ContactsList.tsx`

**Context:** `ContactsList.tsx` is a `'use client'` component. It has a `<table>` with these columns in order:

1. Checkbox (always visible, not toggleable)
2. Name (always visible, not toggleable)
3. Email → key `email`
4. Phone → key `phone`
5. Stage → key `stage`
6. Lifecycle → key `lifecycle`
7. Score → key `lead_score`
8. Assigned → key `assigned`
9. Territory → key `territory`
10. Added → key `added`

The spec asks for: phone, email, stage, tags, source, added, lead_score. Tags and source are currently rendered inline in the Name cell (tags) and not shown (source). We will toggle the dedicated `email`, `phone`, `stage`, `lifecycle`, `assigned`, `territory`, `added`, and `lead_score` columns (the columns that actually exist as `<th>/<td>` pairs). Tags and source are in-row metadata — we skip gating those since they don't have their own columns.

- [ ] **Step 1: Add imports at the top of ContactsList.tsx**

Find the current import block (first 9 lines):

```tsx
'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import ContactFilters, { type FilterState, EMPTY_FILTERS } from './ContactFilters'
import SmartLists from './SmartLists'
import BulkActionBar from './BulkActionBar'
```

Replace with:

```tsx
'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import ContactFilters, { type FilterState, EMPTY_FILTERS } from './ContactFilters'
import SmartLists from './SmartLists'
import BulkActionBar from './BulkActionBar'
import { ColumnsButton } from '@/components/ColumnsButton'
import { useColumnVisibility } from '@/hooks/useColumnVisibility'
```

- [ ] **Step 2: Add column definitions and hook call inside the component body**

Find the line inside `ContactsList()` where state is initialized. It starts with:

```tsx
const router = useRouter()
const searchParams = useSearchParams()
const [filters, setFilters] = useState<FilterState>(() => filtersFromParams(searchParams))
```

Add after that block (after the `const [tenantUsers, ...]` declaration, before `fetchContacts`):

```tsx
const CONTACTS_COLUMNS = [
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'stage', label: 'Stage' },
  { key: 'lifecycle', label: 'Lifecycle' },
  { key: 'lead_score', label: 'Lead Score' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'territory', label: 'Territory' },
  { key: 'added', label: 'Added' },
]
const CONTACTS_DEFAULTS = Object.fromEntries(CONTACTS_COLUMNS.map((c) => [c.key, true]))
const { visible: colVisible, toggle: toggleCol } = useColumnVisibility(
  'nuatis_contacts_columns',
  CONTACTS_DEFAULTS
)
```

Note: place `CONTACTS_COLUMNS` and `CONTACTS_DEFAULTS` as `const` values OUTSIDE the component function body (just before `export default function ContactsList()`) to avoid recreating them on every render. The `useColumnVisibility` call stays inside the function body.

- [ ] **Step 3: Add ColumnsButton next to the Filter button in the header**

Find the header action buttons block — the `<div className="flex items-center gap-2">` that contains the Duplicates link, Filter button, and Add Contact link. It ends before the closing `</div>` of the header row. Insert `<ColumnsButton>` between the Filter button and the Add Contact link:

```tsx
<ColumnsButton columns={CONTACTS_COLUMNS} visible={colVisible} onChange={toggleCol} />
```

The full button row after this change:

```tsx
<div className="flex items-center gap-2">
  <Link
    href="/contacts/duplicates"
    className="px-3 py-2 text-sm text-ink3 border border-border-brand rounded-lg hover:bg-bg"
  >
    Duplicates
  </Link>
  <button
    onClick={() => setShowFilters(!showFilters)}
    className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border transition-colors ${
      showFilters || filterCount > 0
        ? 'border-teal-200 bg-teal-50 text-teal-700'
        : 'border-border-brand text-ink3 hover:bg-bg'
    }`}
  >
    <span className="text-xs">&#9776;</span>
    Filter
    {filterCount > 0 && (
      <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-teal-600 text-white">
        {filterCount}
      </span>
    )}
  </button>
  <ColumnsButton columns={CONTACTS_COLUMNS} visible={colVisible} onChange={toggleCol} />
  <Link
    href="/contacts/new"
    className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
  >
    <span className="text-base leading-none">+</span>
    Add Contact
  </Link>
</div>
```

- [ ] **Step 4: Gate the table header `<th>` cells**

Find the `<thead>` section. Replace the Email, Phone, Stage, Lifecycle, Score, Assigned, Territory, and Added `<th>` elements with conditional versions. The checkbox `<th>` and Name `<th>` are always shown. Show the exact replacement for each:

```tsx
{
  colVisible['email'] !== false && (
    <th className="text-left text-xs font-medium text-ink4 px-4 py-3">Email</th>
  )
}
{
  colVisible['phone'] !== false && (
    <th className="text-left text-xs font-medium text-ink4 px-4 py-3">Phone</th>
  )
}
{
  colVisible['stage'] !== false && (
    <th className="text-left text-xs font-medium text-ink4 px-4 py-3">
      <button
        type="button"
        onClick={() =>
          updateFilters({
            ...filters,
            sort_by: 'pipeline_stage',
            sort_dir:
              filters.sort_by === 'pipeline_stage' && filters.sort_dir === 'asc' ? 'desc' : 'asc',
          })
        }
        className="flex items-center gap-1 hover:text-ink transition-colors"
      >
        Stage
        <span className="text-[10px]">
          {filters.sort_by === 'pipeline_stage' ? (filters.sort_dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  )
}
{
  colVisible['lifecycle'] !== false && (
    <th className="text-left text-xs font-medium text-ink4 px-4 py-3">Lifecycle</th>
  )
}
{
  colVisible['lead_score'] !== false && (
    <th className="text-left text-xs font-medium text-ink4 px-4 py-3">Score</th>
  )
}
{
  colVisible['assigned'] !== false && (
    <th className="text-left text-xs font-medium text-ink4 px-4 py-3">Assigned</th>
  )
}
{
  colVisible['territory'] !== false && (
    <th className="text-left text-xs font-medium text-ink4 px-4 py-3">Territory</th>
  )
}
{
  colVisible['added'] !== false && (
    <th className="text-left text-xs font-medium text-ink4 px-4 py-3">
      <button
        type="button"
        onClick={() =>
          updateFilters({
            ...filters,
            sort_by: 'created_at',
            sort_dir:
              filters.sort_by === 'created_at' && filters.sort_dir === 'desc' ? 'asc' : 'desc',
          })
        }
        className="flex items-center gap-1 hover:text-ink transition-colors"
      >
        Added
        <span className="text-[10px]">
          {filters.sort_by === 'created_at' ? (filters.sort_dir === 'desc' ? '▼' : '▲') : '↕'}
        </span>
      </button>
    </th>
  )
}
```

- [ ] **Step 5: Gate the table body `<td>` cells**

Inside the `contacts.map(...)` body, wrap each data cell to match its `<th>`. The checkbox `<td>` and Name `<td>` are always rendered. The remaining cells:

```tsx
{
  colVisible['email'] !== false && (
    <td className="px-4 py-4 text-sm text-ink3">{contact.email ?? '—'}</td>
  )
}
{
  colVisible['phone'] !== false && (
    <td className="px-4 py-4 text-sm text-ink3">{contact.phone ?? '—'}</td>
  )
}
{
  colVisible['stage'] !== false && (
    <td className="px-4 py-4">
      {contact.pipeline_stage ? (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-teal-50 text-teal-700">
          {contact.pipeline_stage}
        </span>
      ) : (
        <span className="text-sm text-gray-300">{'—'}</span>
      )}
    </td>
  )
}
{
  colVisible['lifecycle'] !== false && (
    <td className="px-4 py-4">
      {contact.lifecycle_stage ? (
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
            {
              subscriber: 'bg-bg2 text-ink3',
              lead: 'bg-blue-50 text-blue-700',
              marketing_qualified: 'bg-purple-50 text-purple-700',
              sales_qualified: 'bg-orange-50 text-orange-700',
              opportunity: 'bg-yellow-50 text-yellow-700',
              customer: 'bg-green-50 text-green-700',
              evangelist: 'bg-emerald-50 text-emerald-700',
              other: 'bg-bg2 text-ink3',
            }[contact.lifecycle_stage] ?? 'bg-bg2 text-ink3'
          }`}
        >
          {contact.lifecycle_stage
            .split('_')
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ')}
        </span>
      ) : (
        <span className="text-sm text-gray-300">{'—'}</span>
      )}
    </td>
  )
}
{
  colVisible['lead_score'] !== false && (
    <td className="px-4 py-4">
      {contact.lead_score != null || contact.lead_grade ? (
        <div className="flex items-center gap-1.5">
          {contact.lead_score != null && (
            <span className="text-sm text-ink2">{contact.lead_score}</span>
          )}
          {contact.lead_grade && (
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                {
                  A: 'bg-green-50 text-green-700',
                  B: 'bg-blue-50 text-blue-700',
                  C: 'bg-yellow-50 text-yellow-700',
                  D: 'bg-orange-50 text-orange-700',
                  F: 'bg-red-50 text-red-700',
                }[contact.lead_grade] ?? 'bg-bg2 text-ink3'
              }`}
            >
              {contact.lead_grade}
            </span>
          )}
        </div>
      ) : (
        <span className="text-sm text-gray-300">{'—'}</span>
      )}
    </td>
  )
}
{
  colVisible['assigned'] !== false && (
    <td className="px-4 py-4">
      {contact.assigned_user_name ? (
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
            <span className="text-teal-700 text-[10px] font-bold">
              {contact.assigned_user_name.charAt(0).toUpperCase()}
            </span>
          </div>
          <span className="text-xs text-ink3">{contact.assigned_user_name}</span>
        </div>
      ) : contact.assigned_to_user_id &&
        tenantUsers.find((u) => u.id === contact.assigned_to_user_id) ? (
        <div className="flex items-center gap-1.5">
          <div className="w-5 h-5 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
            <span className="text-teal-700 text-[10px] font-bold">
              {tenantUsers
                .find((u) => u.id === contact.assigned_to_user_id)!
                .full_name.charAt(0)
                .toUpperCase()}
            </span>
          </div>
          <span className="text-xs text-ink3">
            {tenantUsers.find((u) => u.id === contact.assigned_to_user_id)!.full_name}
          </span>
        </div>
      ) : (
        <span className="text-sm text-gray-300">{'—'}</span>
      )}
    </td>
  )
}
{
  colVisible['territory'] !== false && (
    <td className="px-4 py-4 text-sm text-ink3">
      {contact.territory ?? <span className="text-gray-300">{'—'}</span>}
    </td>
  )
}
{
  colVisible['added'] !== false && (
    <td className="px-4 py-4 text-sm text-ink4">
      {new Date(contact.created_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })}
    </td>
  )
}
```

- [ ] **Step 6: TypeScript build check**

```bash
cd /Users/sidyennamaneni/Documents/Nuatis/nuatis
npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | head -40
```

Expected: no errors (or only pre-existing errors unrelated to our changes).

- [ ] **Step 7: Commit**

```bash
cd /Users/sidyennamaneni/Documents/Nuatis/nuatis
git add apps/web/src/components/contacts/ContactsList.tsx
git commit -m "feat(g65): contacts list — column visibility toggle with localStorage"
```

---

### Task 4: Add ColumnsButton to AppointmentsCalendar (TODO mode)

**Files:**

- Modify: `apps/web/src/app/(dashboard)/appointments/AppointmentsCalendar.tsx`

**Context:** AppointmentsCalendar uses `react-big-calendar` — no `<table>` rows to gate. We add the ColumnsButton to the toolbar area with a TODO comment. The toolbar area is wherever the staff filter dropdown and Block Time button live.

- [ ] **Step 1: Read the toolbar section of AppointmentsCalendar.tsx**

```bash
grep -n "staffFilter\|Block Time\|filter\|toolbar\|flex items-center" \
  /Users/sidyennamaneni/Documents/Nuatis/nuatis/apps/web/src/app/\(dashboard\)/appointments/AppointmentsCalendar.tsx | head -30
```

Use that output to identify the exact JSX line for the staff filter dropdown or Block Time button row.

- [ ] **Step 2: Add imports**

At the top of `AppointmentsCalendar.tsx`, after the existing imports, add:

```tsx
import { ColumnsButton } from '@/components/ColumnsButton'
import { useColumnVisibility } from '@/hooks/useColumnVisibility'
```

- [ ] **Step 3: Add column defs and hook call inside the component**

Place these constants OUTSIDE the component (just before `export default function AppointmentsCalendar`):

```tsx
const APPT_COLUMNS = [
  { key: 'contact', label: 'Contact' },
  { key: 'service', label: 'Service' },
  { key: 'staff', label: 'Staff' },
  { key: 'date', label: 'Date' },
  { key: 'status', label: 'Status' },
  { key: 'channel', label: 'Channel' },
]
const APPT_DEFAULTS = Object.fromEntries(APPT_COLUMNS.map((c) => [c.key, true]))
```

Inside the component body, add after existing `useState` declarations:

```tsx
// TODO(G65): When a list/table view is added to appointments, gate columns using colVisible
const { visible: colVisible, toggle: toggleCol } = useColumnVisibility(
  'nuatis_appointments_columns',
  APPT_DEFAULTS
)
```

- [ ] **Step 4: Add ColumnsButton to the toolbar**

Find the existing toolbar row (the div containing the staff filter `<select>` and the Block Time button). Add `<ColumnsButton>` at the end of that row:

```tsx
<ColumnsButton columns={APPT_COLUMNS} visible={colVisible} onChange={toggleCol} />
```

- [ ] **Step 5: TypeScript build check**

```bash
cd /Users/sidyennamaneni/Documents/Nuatis/nuatis
npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | head -40
```

Expected: no errors from our additions.

- [ ] **Step 6: Commit**

```bash
cd /Users/sidyennamaneni/Documents/Nuatis/nuatis
git add apps/web/src/app/\(dashboard\)/appointments/AppointmentsCalendar.tsx
git commit -m "feat(g65): appointments — ColumnsButton wired (calendar view, TODO for list view)"
```

---

### Task 5: Add ColumnsButton to TasksDashboard (TODO mode)

**Files:**

- Modify: `apps/web/src/components/tasks/TasksDashboard.tsx`

**Context:** TasksDashboard uses a categorized card layout (sections: Overdue, Today, This Week, Upcoming, No Due Date). There's no table. We add the ColumnsButton to the header row next to "Add Task" and include a TODO comment.

- [ ] **Step 1: Add imports**

At the top of `TasksDashboard.tsx`, after the existing imports, add:

```tsx
import { ColumnsButton } from '@/components/ColumnsButton'
import { useColumnVisibility } from '@/hooks/useColumnVisibility'
```

- [ ] **Step 2: Add column defs and hook call**

Place constants OUTSIDE the component (just before `export default function TasksDashboard()`):

```tsx
const TASKS_COLUMNS = [
  { key: 'contact', label: 'Contact' },
  { key: 'due_date', label: 'Due Date' },
  { key: 'priority', label: 'Priority' },
  { key: 'assigned', label: 'Assigned' },
  { key: 'status', label: 'Status' },
]
const TASKS_DEFAULTS = Object.fromEntries(TASKS_COLUMNS.map((c) => [c.key, true]))
```

Inside the component body, after `const [saving, setSaving] = useState(false)`, add:

```tsx
// TODO(G65): When a table/list view is added to tasks, gate columns using colVisible
const { visible: colVisible, toggle: toggleCol } = useColumnVisibility(
  'nuatis_tasks_columns',
  TASKS_DEFAULTS
)
```

- [ ] **Step 3: Add ColumnsButton to the header row**

Find the header row — it contains the `<h1>Tasks</h1>` and the "Add Task" button:

```tsx
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-ink">Tasks</h1>
          <p className="text-sm text-ink3 mt-0.5">{tasks.length} active</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          ...
        >
          ...
          Add Task
        </button>
      </div>
```

Replace with (adds a flex gap container on the right side):

```tsx
<div className="flex items-center justify-between mb-6">
  <div>
    <h1 className="text-xl font-bold text-ink">Tasks</h1>
    <p className="text-sm text-ink3 mt-0.5">{tasks.length} active</p>
  </div>
  <div className="flex items-center gap-2">
    <ColumnsButton columns={TASKS_COLUMNS} visible={colVisible} onChange={toggleCol} />
    <button
      onClick={() => setShowAdd(true)}
      className="flex items-center gap-2 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 transition-colors"
    >
      <span className="text-base leading-none">+</span>
      Add Task
    </button>
  </div>
</div>
```

- [ ] **Step 4: TypeScript build check**

```bash
cd /Users/sidyennamaneni/Documents/Nuatis/nuatis
npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | head -40
```

Expected: no errors from our additions.

- [ ] **Step 5: Commit**

```bash
cd /Users/sidyennamaneni/Documents/Nuatis/nuatis
git add apps/web/src/components/tasks/TasksDashboard.tsx
git commit -m "feat(g65): tasks — ColumnsButton wired (card view, TODO for list view)"
```

---

### Task 6: Final sync and single commit (if squashing)

- [ ] **Step 1: Pull rebase before final push**

```bash
cd /Users/sidyennamaneni/Documents/Nuatis/nuatis
git pull --rebase
```

Expected: already up to date, or fast-forward.

- [ ] **Step 2: Verify TypeScript is clean**

```bash
cd /Users/sidyennamaneni/Documents/Nuatis/nuatis
npx tsc --noEmit -p apps/web/tsconfig.json 2>&1 | grep -c "error" || echo "0 errors"
```

Expected: `0 errors` or count matches pre-existing baseline.

- [ ] **Step 3: Squash or verify individual commits are pushed**

Individual commits were made per task. Verify log looks correct:

```bash
git log --oneline -6
```

Expected output (newest first):

```
<hash> feat(g65): tasks — ColumnsButton wired (card view, TODO for list view)
<hash> feat(g65): appointments — ColumnsButton wired (calendar view, TODO for list view)
<hash> feat(g65): contacts list — column visibility toggle with localStorage
<hash> feat(g65): add useColumnVisibility hook with localStorage persistence
<hash> feat(g65): add reusable ColumnsButton component
```

- [ ] **Step 4: Push**

```bash
git push
```

---

## Self-Review Checklist

### Spec coverage

- [x] "Columns" dropdown toggle added to contacts list view
- [x] "Columns" dropdown toggle added to appointments view (calendar, no table — button present, TODO for future list)
- [x] "Columns" dropdown toggle added to tasks view (card layout, no table — button present, TODO for future list)
- [x] Column visibility persists in localStorage (`nuatis_contacts_columns`, `nuatis_appointments_columns`, `nuatis_tasks_columns`)
- [x] Contacts columns gated: email, phone, stage, lifecycle, lead_score, assigned, territory, added
- [x] ColumnsButton is a reusable shared component
- [x] `useColumnVisibility` hook is reusable
- [x] No API changes

### Notes on spec deviations

- Spec listed contacts columns as `phone, email, stage, tags, source, added, lead_score`. Tags render inline in the Name cell and Source is not a standalone column in the current table — both are skipped for th/td gating. Instead we gate all 8 columns that actually exist as standalone `<th>/<td>` pairs: email, phone, stage, lifecycle, lead_score, assigned, territory, added.
- Appointments has no list view table — ColumnsButton added with `// TODO(G65)` comment as instructed in spec note 3.
- Tasks has no list view table — ColumnsButton added with `// TODO(G65)` comment as instructed in spec note 3.
