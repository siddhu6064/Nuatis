# DESIGN.md — Nuatis Suite

> Drop this file in the monorepo root (`~/Documents/Nuatis/nuatis/DESIGN.md`).
> Any AI coding agent, Cursor rule, or Claude session reads this first before generating any UI.

---

## 1. Visual Theme & Atmosphere

Nuatis Suite is a **premium B2B SaaS dashboard** for SMB front-office operations. The visual language is:

- **Warm editorial minimalism** — not cold SaaS blue, not startup purple. Cream backgrounds, teal as the action color, generous whitespace.
- **Confident density** — dashboards show real data without clutter. Cards breathe. Tables are readable at a glance.
- **Voice-forward** — Maya (voice AI) surfaces carry a distinct orange energy (`#E84A00`) that marks them as live/active. Everything else is calm.
- **Trust signals** — clean typography, tight spacing on labels, consistent iconography. SMB owners need to feel in control.

**Design philosophy:** Refined utility. Every element earns its place. No decorative gradients on core UI. Motion is purposeful — skeleton loaders, toast fades, subtle hover lifts. The product should feel like a well-designed accounting firm, not a startup landing page.

---

## 2. Color Palette & Roles

### Core Tokens (CSS variables — always use these, never raw hex in components)

| Token      | Hex                            | Role                                                                      |
| ---------- | ------------------------------ | ------------------------------------------------------------------------- |
| `--teal`   | `#007A6E`                      | Primary action — buttons, links, focus rings, active states, selected nav |
| `--blue`   | `#0047FF`                      | Secondary accent — email channel, info badges, external links             |
| `--bg`     | `#F8F7F4`                      | App background — all page roots, sidebar bg                               |
| `--paper`  | `#FFFFFF` (slight warm offset) | Card/surface background — all `.card`, modals, dropdowns                  |
| `--white`  | `#FFFFFF`                      | Pure white — used sparingly for contrast on dark surfaces                 |
| `--ink`    | `#0E0E0E`                      | Primary text — headings, labels, table cell primary                       |
| `--ink2`   | `#3A3A3A`                      | Secondary text — sub-labels, descriptions                                 |
| `--ink3`   | `#6B6B6B`                      | Tertiary text — placeholders, metadata, timestamps                        |
| `--ink4`   | `#ADADAD`                      | Muted / disabled text                                                     |
| `--rule`   | `#E4E2DC`                      | Default border — card borders, table dividers, input borders              |
| `--rule2`  | `#CCCAC2`                      | Stronger border — modal edges, section dividers                           |
| `--green`  | `#006B3F`                      | Success — deal won, payment confirmed, sync active                        |
| `--gold`   | `#C07D00`                      | Warning / amber — overdue, trial expiring, caution                        |
| `--red`    | `#C0003C`                      | Error / destructive — delete confirm, failed payment, form error          |
| `--rose`   | `#C0003C`                      | Alias for `--red`                                                         |
| `--orange` | `#E84A00`                      | Maya / voice AI — call active, mic indicator, Maya-branded surfaces       |
| `--purple` | `#7C3AED`                      | Pipeline stages, social channel, CPQ proposal status                      |

### Semantic Palette Extensions (use directly where token doesn't exist)

| Name        | Hex                | Use                                          |
| ----------- | ------------------ | -------------------------------------------- |
| Teal pale   | `#E0F4F2`          | Teal badge background, selected row tint     |
| Blue pale   | `#EBF0FF`          | Email channel chip bg                        |
| Blue mid    | `#C2D0FF`          | Email channel chip border                    |
| Orange pale | `#FFF0EB`          | Maya card background tint                    |
| Gold pale   | `#FFF8E6`          | Warning banner background, DemoBanner bg     |
| Green pale  | `#E5F5EE`          | Success state backgrounds                    |
| Purple pale | `#EDE9FE`          | Pipeline stage chips, social channel chip bg |
| Rose pale   | `#FFEBF3`          | Error/destructive badge bg                   |
| Amber 200   | `#FCD34D` (approx) | DemoBanner border                            |

### Channel Color Semantics (AI Campaigns — never swap these)

| Channel | Color  | Hex       | Usage                                   |
| ------- | ------ | --------- | --------------------------------------- |
| SMS     | Teal   | `#007A6E` | Recharts bar fill, chip bg: teal-pale   |
| Email   | Blue   | `#0047FF` | Recharts bar fill, chip bg: blue-pale   |
| Social  | Purple | `#7C3AED` | Recharts bar fill, chip bg: purple-pale |

### DemoBanner

```
background: #FFF8E6   (gold-pale)
border-color: #FCD34D (amber-200 approx)
text: --ink2
```

---

## 3. Typography Rules

### Font Stack

| Role                          | Family           | Weights            | Notes                                                                    |
| ----------------------------- | ---------------- | ------------------ | ------------------------------------------------------------------------ |
| **Body / UI**                 | `Epilogue`       | 400, 500, 600, 700 | All body text, nav, buttons, table content, form labels                  |
| **Display / Logo**            | `Fraunces`       | 400, 600, 700      | Logo wordmark, hero headings on marketing pages only                     |
| **Monospace / Code / Labels** | `JetBrains Mono` | 400, 500           | Phone numbers, API keys, migration names, code blocks, stat card numbers |

**Never use:** Inter, Roboto, Arial, system-ui, -apple-system as primary face. These are banned.

### Type Scale

| Class / Role         | Size             | Weight  | Line-height | Font           |
| -------------------- | ---------------- | ------- | ----------- | -------------- |
| Page title (h1)      | 24px / 1.5rem    | 700     | 1.25        | Epilogue       |
| Section heading (h2) | 20px / 1.25rem   | 600     | 1.3         | Epilogue       |
| Card title (h3)      | 16px / 1rem      | 600     | 1.4         | Epilogue       |
| Body default         | 14px / 0.875rem  | 400     | 1.6         | Epilogue       |
| Body small           | 13px / 0.8125rem | 400     | 1.5         | Epilogue       |
| Label / caption      | 12px / 0.75rem   | 500     | 1.4         | Epilogue       |
| Stat number (large)  | 28–36px          | 600–700 | 1.1         | JetBrains Mono |
| Phone / ID / code    | 13px             | 400     | 1.4         | JetBrains Mono |
| Marketing hero       | 48–72px          | 700     | 1.1         | Fraunces       |
| Marketing sub-hero   | 20–24px          | 400     | 1.5         | Epilogue       |

### Typography Rules

- Letter-spacing on uppercase labels: `0.04em` (e.g. section headers in `ALL CAPS`)
- Never bold body paragraphs — use `--ink2` color shift for secondary emphasis instead
- Stat numbers on dashboard cards always use JetBrains Mono — this is a strong brand signal
- Marketing page hero text uses Fraunces; dashboard never uses Fraunces

---

## 4. Component Stylings

### Buttons

```
Primary (filled):
  bg: --teal  |  text: white  |  radius: 6px  |  px: 16px  |  py: 8px
  font: Epilogue 500 14px
  hover: bg darkens 8% (filter: brightness(0.92))
  focus: 2px ring --teal offset 2px
  disabled: opacity 0.45, cursor not-allowed

Secondary (outline):
  bg: transparent  |  border: 1px --rule  |  text: --ink  |  radius: 6px
  hover: bg --bg (subtle fill)

Ghost:
  bg: transparent  |  border: none  |  text: --teal
  hover: bg teal-pale (#E0F4F2)

Destructive:
  bg: --red  |  text: white
  hover: brightness(0.92)

Icon button:
  size: 32×32px  |  radius: 6px  |  bg: transparent
  hover: bg --rule  |  active: bg --rule2

Button sizes:
  sm: px-10 py-5 text-13px
  md: px-16 py-8 text-14px  (default)
  lg: px-20 py-10 text-15px
```

### Cards

```
bg: var(--paper)  |  border: 1px solid var(--rule)  |  radius: 10px
padding: 20px (default)  |  16px (compact)  |  24px (spacious)
box-shadow: 0 1px 3px rgba(0,0,0,0.06)
hover (interactive cards): box-shadow 0 2px 8px rgba(0,0,0,0.10), translateY(-1px)
```

### Inputs & Form Controls

```
Input / Textarea:
  bg: white  |  border: 1px solid var(--rule)  |  radius: 6px
  px: 12px  |  py: 8px  |  font: Epilogue 14px --ink
  focus: border-color --teal, ring 2px teal 20% opacity
  error: border-color --red, ring 2px red 20% opacity
  placeholder: --ink4

Select: same as input + chevron icon right-12px

Checkbox / Radio:
  accent-color: --teal
  size: 16×16px  |  radius: 4px (checkbox) / 50% (radio)

Toggle/Switch:
  track off: --rule2 bg  |  track on: --teal bg
  thumb: white, radius 50%
  transition: 150ms ease

Label:
  font: Epilogue 500 13px --ink2
  margin-bottom: 6px
```

### Navigation (Sidebar)

```
Sidebar width: 220px (expanded) / 56px (collapsed)
bg: var(--bg)  |  border-right: 1px solid var(--rule)

Nav item:
  height: 36px  |  px: 12px  |  radius: 6px  |  gap: 10px
  font: Epilogue 500 14px  |  color: --ink3
  icon: 18×18px

Nav item — hover:
  bg: var(--rule)  |  color: --ink

Nav item — active:
  bg: teal-pale (#E0F4F2)  |  color: --teal  |  font-weight: 600

Section label (in sidebar):
  font: Epilogue 600 11px  |  color: --ink4  |  letter-spacing: 0.08em
  text-transform: uppercase  |  px: 12px  |  mt: 20px  |  mb: 4px
```

### Tables

```
Header row:
  bg: var(--bg)  |  border-bottom: 1px --rule
  font: Epilogue 600 12px --ink3  |  text-transform: uppercase  |  letter-spacing: 0.05em
  px: 16px  |  py: 10px

Body row:
  border-bottom: 1px --rule  |  font: Epilogue 400 14px --ink
  px: 16px  |  py: 12px

Row hover: bg teal-pale (#E0F4F2) at 40% opacity
Row selected: bg teal-pale

Cell — primary: --ink font-500
Cell — secondary: --ink3 font-400 text-13px
Cell — monospace (phone, ID): JetBrains Mono 13px --ink2
```

### Badges / Chips / Status Pills

```
Base: radius: 999px  |  px: 8px  |  py: 2px  |  font: Epilogue 600 12px

Status mapping:
  active / won / delivered:  bg green-pale,   text --green,    border 1px #A3D9BE
  pending / trial / queued:  bg gold-pale,    text --gold,     border 1px #F5C97A
  draft / inactive:          bg --bg,         text --ink3,     border 1px --rule
  failed / error / lost:     bg rose-pale,    text --red,      border 1px #F5A3BC
  running / live:            bg orange-pale,  text --orange,   border 1px #FFB899
  scheduled:                 bg blue-pale,    text --blue,     border 1px --rule2
  cancelled:                 bg --bg,         text --ink4,     border 1px --rule

Channel chips (AI Campaigns):
  SMS:    bg teal-pale,   text --teal,   border 1px teal at 30% opacity
  Email:  bg blue-pale,   text --blue,   border 1px blue-mid
  Social: bg purple-pale, text --purple, border 1px purple at 30% opacity
```

### Stat Cards (Dashboard)

```
Layout: card container (standard card style)
  Metric label: Epilogue 600 12px --ink3 uppercase letter-spacing 0.05em
  Stat value: JetBrains Mono 600 32px --ink   ← monospace always
  Delta/sub: Epilogue 500 13px  |  positive: --green  |  negative: --red  |  neutral: --ink3
  Icon (top-right): 36×36px circle, bg teal-pale, icon --teal

  Clickable stat cards: cursor pointer, hover translateY(-1px), shadow lift
```

### Modals / Dialogs

```
Overlay: rgba(0,0,0,0.45) backdrop-blur-sm
Container:
  bg: var(--paper)  |  border: 1px --rule  |  radius: 12px
  max-width: 480px (sm) / 600px (md) / 800px (lg)
  padding: 24px

Header: font Epilogue 600 18px --ink  |  close button top-right 32×32px ghost
Footer: border-top 1px --rule  |  pt-16  |  flex justify-end gap-8
  Cancel (secondary btn) + Confirm (primary btn)
```

### Toast Notifications

```
Position: bottom-right, stack up
bg: --ink (dark)  |  text: white  |  radius: 8px  |  px: 16px  |  py: 12px
font: Epilogue 500 14px
max-width: 360px  |  shadow: 0 4px 16px rgba(0,0,0,0.18)

Variants:
  success: left border 3px --green
  error:   left border 3px --red
  warning: left border 3px --gold
  info:    left border 3px --teal
```

### Maya / Voice UI Indicators

```
Maya surfaces use --orange (#E84A00) as the primary accent.
Call active indicator: pulsing orange dot (keyframe scale 1→1.3→1 at 1.2s)
bg tint on Maya cards: orange-pale (#FFF0EB)
Maya avatar / icon bg: #E84A00  |  icon: white
Recording/mic active: animated waveform bars in #E84A00
Never use teal on Maya-specific surfaces — orange owns this space
```

### Kanban Pipeline Board

```
Column header: Epilogue 700 13px --ink  |  uppercase  |  with stage color dot (8px circle)
Column bg: --bg  |  border-right: 1px --rule  |  min-width: 240px
Deal card: standard card  |  drag handle on hover (opacity 0→1)
Stage probability chip: right of stage name, --ink4 text, no border
Revenue per stage: JetBrains Mono 500 13px --ink2  (below stage name)
Column total: JetBrains Mono 600 14px --teal (top of column)
```

### CPQ / Quotes

```
Line item table: standard table styles
Tax / discount rows: --ink3 italic
Total row: Epilogue 700 16px --ink  |  border-top 2px --ink
PDF output uses same token values (passed to Puppeteer template)
Payment recorded badge: green-pale
```

---

## 5. Layout Principles

### Spacing Scale

Based on 4px base unit. Use these values only:

```
4px  / 0.25rem  — tight gap between inline elements
8px  / 0.5rem   — component internal spacing (icon+label gap)
12px / 0.75rem  — compact padding (sm cards, dense tables)
16px / 1rem     — default component padding
20px / 1.25rem  — card padding default
24px / 1.5rem   — section padding, modal padding
32px / 2rem     — between sections
48px / 3rem     — page-level top padding
64px / 4rem     — marketing section spacing
```

### Grid & Layout

```
Dashboard shell:
  sidebar: 220px fixed left
  main: flex-1, overflow-y auto
  content wrapper: max-width 1280px, px 24–32px, py 24px

Page header:
  h1 + description + CTA button(s) in a flex row, border-bottom 1px --rule, pb-16

Two-column layout (detail pages):
  left: 65%  |  right: 35%  |  gap: 24px

Three-panel layout (contact detail):
  left rail: 240px  |  center: flex-1  |  right panel: 300px
  all panels: border-right 1px --rule except last

Responsive breakpoints:
  sm: 640px  |  md: 768px  |  lg: 1024px  |  xl: 1280px  |  2xl: 1536px

At md and below: sidebar collapses to icon-only (56px)
At sm and below: two/three column layouts stack vertically
```

### Whitespace Philosophy

- Cards never touch — minimum 16px gap between adjacent cards
- Section headers have 24px above, 12px below before first card
- Form fields: 16px vertical gap between field groups
- Empty states: vertically centered in container, icon 48px, heading + description + CTA

---

## 6. Depth & Elevation

```
Level 0 — Page bg:   --bg, no shadow
Level 1 — Cards:     box-shadow: 0 1px 3px rgba(0,0,0,0.06)
Level 2 — Hover:     box-shadow: 0 2px 8px rgba(0,0,0,0.10)
Level 3 — Dropdowns/popovers: box-shadow: 0 4px 16px rgba(0,0,0,0.12)
Level 4 — Modals:    box-shadow: 0 8px 32px rgba(0,0,0,0.18)  + backdrop
Level 5 — Command palette / Cmd+K: box-shadow: 0 16px 48px rgba(0,0,0,0.24) + backdrop

Borders supplement shadows (never replace):
  Level 1–2: border 1px --rule
  Level 3–4: border 1px --rule2
```

---

## 7. Do's and Don'ts

### ✅ Do

- Use `--teal` for **every** primary CTA — the color should become Pavlovian for users
- Use JetBrains Mono for **all** numbers in stat cards, phone numbers, IDs, and code
- Keep sidebar nav items at 500 weight inactive, 600 weight active — the weight shift signals state
- Use the channel color semantics consistently: teal=SMS, blue=email, purple=social — never swap
- Give Maya surfaces the orange treatment (`--orange`, `orange-pale`) — it's the one place we're bold
- Use empty state illustrations/icons at 48px with a single teal CTA below
- Match badge background to the pale version and text to the full token (e.g. `green-pale` bg + `--green` text)
- Put page-level CTAs in the top-right of the page header — users learn to look there
- Use `filter: brightness(0.92)` for button hover — it works on any bg color without needing a separate hover token
- Always show skeleton loaders (not spinners) for content loading states — match the shape of what's loading

### ❌ Don't

- Never use purple gradients on white — this is the most generic AI slop pattern. Avoid entirely.
- Never use Inter or Roboto — even as a fallback. If Epilogue fails, fall back to `Georgia, serif` as a placeholder.
- Never use `--orange` outside of Maya/voice surfaces — it's reserved. Using it elsewhere dilutes the signal.
- Never use `--blue` for primary actions — that's `--teal`. Blue is for email channel and secondary accents only.
- Never add decorative gradients to dashboard cards — they distract from data
- Never show raw UUIDs to users — always truncate to first 8 chars or mask
- Never use all-caps on body text, only on 12px labels with letter-spacing
- Never use a border AND a shadow heavier than Level 1 on the same element — it over-elevates
- Never put more than 3 actions in a table row — use a `...` overflow menu
- Never use red for warnings — red is destructive/error only. Gold/amber owns warnings.
- Never hardcode `localhost` or raw API URLs in frontend code — always use `/api/*` relative paths

---

## 8. Responsive Behavior

### Breakpoints

| Name    | Width       | Behavior                                                             |
| ------- | ----------- | -------------------------------------------------------------------- |
| Mobile  | < 640px     | Single column, sidebar hidden (slide-in drawer), tables become cards |
| Tablet  | 640–1023px  | Sidebar icon-only (56px), 2-col layouts stay 2-col                   |
| Desktop | 1024–1279px | Full sidebar (220px), standard layouts                               |
| Wide    | ≥ 1280px    | Max-width 1280px content container centered                          |

### Touch Targets

- Minimum touch target: 44×44px on mobile
- Table row actions collapse to bottom sheet on mobile
- Stat cards stack 2×2 on tablet, 1 col on mobile
- Kanban switches to list view on mobile (no horizontal scroll)

### Collapsing Strategy

- Sidebar: icon-only at tablet, drawer at mobile (hamburger trigger)
- 3-panel contact layout: right panel goes to tab on tablet, hidden on mobile
- Data tables: hide secondary columns first (timestamps, IDs) on narrow
- Modals: full-screen bottom sheet on mobile (border-radius top only)

---

## 9. Iconography

- Library: **Lucide React** — consistent across all dashboard surfaces
- Size defaults: `16px` inline, `18px` nav, `20px` page header, `24px` empty states, `48px` empty state hero
- Color: inherit from parent text color by default; accent icons use token explicitly
- Maya mic/phone icons use `--orange`
- Never mix icon libraries within a page

---

## 10. Data Visualization (Recharts)

### Chart conventions

```
Grid lines: stroke --rule, strokeDasharray "3 3"
Axis text: Epilogue 12px fill --ink3
Tooltip: bg --paper, border 1px --rule, radius 8px, shadow Level 3, Epilogue 13px
Legend: Epilogue 500 12px --ink2

Bar chart:
  Bars: radius [4,4,0,0] on top corners
  Fill: use token colors (teal, blue, purple per channel)

Line chart:
  strokeWidth: 2  |  dot: false (hidden by default)
  activeDot: radius 4, fill token color

Area chart:
  fill opacity: 0.12  |  stroke: full token color  |  strokeWidth: 2

Funnel (Pipeline):
  bars horizontal  |  teal fill  |  label inside bar JetBrains Mono 12px white

Campaign performance (multi-channel bar):
  grouped  |  SMS: teal  |  Email: blue  |  Social: purple
  gap between groups: 8px
```

---

## 11. Module-Specific Surfaces

### AI Campaigns

```
Status colors follow badge semantics above.
Opt-out alert banners:
  > 1% opt-out: gold-pale bg, --gold text, amber border
  > 3% opt-out: rose-pale bg, --red text, --red border
Performance funnel: horizontal BarChart, channel colors, tooltip shows %
Contact log: expandable rows (click to show error_msg on failure)
```

### Maya / Voice Settings

```
CallerMemoryCard: orange-pale bg tint, --orange border-left 3px accent
Toggle for maya_memory_enabled: teal switch
Preview table: masked phone (JetBrains Mono), last 5 calls
Call active: pulsing orange dot + "Live" badge (orange-pale bg)
```

### Scheduling / Calendar

```
Calendar grid: --bg cells, --teal for selected/booked slots
Blocked time: --rule2 bg with diagonal stripe pattern (CSS background repeating-linear-gradient)
Today indicator: --teal dot below date number
Event chips: 12px rounded, Epilogue 500 11px, teal for confirmed, gold for pending
```

### CPQ / Quotes

```
Quote status badge: same badge system
Proposal PDF header: Fraunces display font for company name
Line items: alternating row bg (white / --bg) for readability
Total section: right-aligned, bold Epilogue 700
```

### Billing / Pricing

```
Pricing cards: standard card  |  Pro tier: border 2px --teal + "Most popular" badge (teal-pale)
Tier names: Core / Pro / Scale — always in this order
Trial badge: gold-pale bg, --gold text, "7-day free trial"
Annual toggle: teal switch, savings badge (green-pale)
Usage meter (Maya minutes): teal progress bar on --rule2 track
```

---

## 12. Agent Prompt Guide

### Quick color reference

```
Primary action:    #007A6E  (--teal)
Background:        #F8F7F4  (--bg)
Surface/card:      #FFFFFF  (--paper)
Primary text:      #0E0E0E  (--ink)
Muted text:        #6B6B6B  (--ink3)
Border:            #E4E2DC  (--rule)
Success:           #006B3F  (--green)
Warning:           #C07D00  (--gold)
Error:             #C0003C  (--red)
Maya/voice:        #E84A00  (--orange)
Pipeline/social:   #7C3AED  (--purple)
Email channel:     #0047FF  (--blue)
```

### Ready-to-use prompts for common tasks

**New dashboard page:**

> "Build a Next.js page following the Nuatis DESIGN.md. Use --bg as the page background, standard card style for content blocks, Epilogue font, stat cards with JetBrains Mono numbers, and --teal for all primary CTAs. Page header: h1 + description left, CTA button right, border-bottom --rule."

**New data table:**

> "Build a table following Nuatis DESIGN.md table styles. Header: --bg bg, Epilogue 600 12px uppercase --ink3 labels. Rows: border-bottom --rule, hover teal-pale tint. Primary cell: Epilogue 500 --ink. Phone/ID cells: JetBrains Mono 13px. Status column: badge chips with semantic color mapping."

**New form / modal:**

> "Build a modal following Nuatis DESIGN.md. bg --paper, border --rule2, radius 12px, padding 24px. Inputs: border --rule, focus ring --teal. Labels: Epilogue 500 13px --ink2. Footer: border-top --rule, Cancel (secondary) + Submit (primary teal) buttons right-aligned."

**Maya-branded surface:**

> "This surface is for Maya voice AI. Use --orange (#E84A00) as the accent, orange-pale (#FFF0EB) as the bg tint, and a 3px left border in --orange on the card. Stat numbers in JetBrains Mono. Pulsing dot animation for live call state."

**AI Campaigns performance:**

> "Build campaign performance UI. Channel colors: SMS=teal (#007A6E), email=blue (#0047FF), social=purple (#7C3AED). Opt-out > 1% = amber banner (gold-pale bg, --gold text). Opt-out > 3% = red banner (rose-pale bg, --red text). Funnel BarChart with grouped bars per channel."

**Pricing page tier card:**

> "Three pricing cards: Core / Pro / Scale. Pro card gets border 2px --teal and a 'Most popular' badge (teal-pale bg, --teal text). All cards: --paper bg, --rule border, radius 10px, shadow Level 1. Price in JetBrains Mono 600 32px. Feature list with teal checkmarks. Primary CTA teal button full-width."

---

## 13. File Conventions (for generated code)

```
CSS variables:    always use var(--token) — never raw hex in components
Tailwind classes: use design-system-aligned classes; extend tailwind.config for custom tokens
Component files:  PascalCase (.tsx)
Import order:     React → external libs → internal components → styles
Console logging:  console.log is BANNED — only console.info / console.warn / console.error
API calls:        always relative /api/* paths — never hardcode API URLs or localhost
Migrations:       supabase/migrations/NNNN_description.sql — next is 0123
SMS from-number:  query telnyx_numbers table (is_primary=true) — NEVER locations.telnyx_number
```

---

_Last updated: May 26, 2026 — Nuatis Suite v1 (Phases 1–14 + Tracks A/B complete)_
_Maintained by: Sid (Founder) + Claude (CTO)_
