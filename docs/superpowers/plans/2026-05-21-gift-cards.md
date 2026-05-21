# G86 Gift Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add gift card issuance, balance tracking, and redemption — Express API routes + Supabase table + Next.js settings UI.

**Architecture:** Express router at `/api/gift-cards` with four routes (list, create, redeem, public balance check). Codes are auto-generated via DB default. Next.js settings page at `/settings/gift-cards` uses a client component with table + inline issue form + redeem modal.

**Tech Stack:** Express, Supabase (service role), Next.js 14 App Router, Tailwind CSS design system (bg-white border-border-brand rounded-xl, teal-600 actions)

---

### Task 1: Create the API route file

**Files:**
- Create: `apps/api/src/routes/gift-cards.ts`

- [ ] **Step 1: Write the route file** (spec-provided, copy verbatim)

See spec — four routes: GET /, POST /, POST /redeem, GET /:code/balance

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/sidyennamaneni/Documents/Nuatis/nuatis && npx tsc -p apps/api/tsconfig.json --noEmit 2>&1 | tail -20
```

Expected: zero errors relating to gift-cards.ts

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/gift-cards.ts && git commit -m "feat(gift-cards): API routes — list, create, redeem, public balance"
```

---

### Task 2: Create the Next.js settings UI

**Files:**
- Create: `apps/web/src/app/(dashboard)/settings/gift-cards/page.tsx`
- Create: `apps/web/src/app/(dashboard)/settings/gift-cards/GiftCardsClient.tsx`

- [ ] **Step 1: Write page.tsx** (thin RSC wrapper)

- [ ] **Step 2: Write GiftCardsClient.tsx** (full client component)

- [ ] **Step 3: Verify Next.js build compiles**

```bash
cd /Users/sidyennamaneni/Documents/Nuatis/nuatis && npx tsc -p apps/web/tsconfig.json --noEmit 2>&1 | tail -20
```

Expected: zero new errors

- [ ] **Step 4: Final commit**

```bash
git pull --rebase && git add -A && git commit -m "feat(g86): gift cards — API routes (list/create/redeem/balance), settings UI"
```
