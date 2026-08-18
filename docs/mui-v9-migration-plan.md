# MUI v9 migration plan

Branch: `chore/mui-v9-migration`. Status as of this document: **Phases 1-3 complete and verified** (foundation, pilot, shared design tokens). Phase 4+ is scoped but not started — see "Remaining work" below.

## Context

Nuatis's web app is ~206 hand-built React components on Tailwind CSS 3.4, no existing component library. This plan adopts MUI v9 (`@mui/material@9.3.1`) incrementally, component by component, rather than a rewrite — the two coexist indefinitely, and pages migrate opportunistically (new work, or when a page needs the richer interaction primitives MUI provides: real elevation/shadow system, transitions, a11y-correct Menu/Dialog/Autocomplete, etc.).

**Earlier recommendation on record:** before this plan, the assessment was to prefer shadcn/ui (Tailwind-native, copies source, no separate design system) over MUI for this codebase. That recommendation stands as the lower-risk path. This plan proceeds with MUI per explicit direction, and documents the risks that recommendation was based on — several of which materialized during Phase 1/2 and are fixed below, not just theorized.

## Why v9 specifically

MUI's registry skips v8 — it goes v7 → v9, realigned with MUI X's version number (both suites share a major now). v9.3.1 was published 2026-08-06. Peer ranges (`react ^17||^18||^19`, `next ^13-16` via `@mui/material-nextjs`) are compatible with this repo's React 19 / Next 16.2.6.

**Real breaking changes hit during this phase** (not from a v5 baseline — this is a fresh install, but generated code needs to target v9's current API, not older docs/training-data patterns that predate it):

- System-prop shorthands removed from `Typography` and other components (`fontWeight`, `mt`, etc.) — use `sx` instead. Hit this immediately in `StatCard.tsx`; fixed by moving `fontWeight` into `sx`.
- `components`/`componentsProps` → `slots`/`slotProps` across 40+ components.
- `GridLegacy` removed — use `Grid`.
- Icon exports ending "Outline" renamed to "Outlined".
- Browser support floor raised to Chrome 117+, Firefox 121+, Safari 17+, Edge 121. **Resolved:** no production user base yet (pre-launch, still in development) — this floor is a non-issue, no sign-off needed.

## The coexistence mechanism, and the bug it has if you stop half-way

MUI's Next.js integration (`@mui/material-nextjs/v16-appRouter`, confirmed valid exported subpath at v9.3.0) provides `AppRouterCacheProvider`, which wraps the app in an Emotion SSR cache. It exposes `enableCssLayer: true`, which wraps all MUI-generated CSS in `@layer mui`.

**Per the CSS cascade spec, unlayered rules always beat layered rules, regardless of specificity.** `enableCssLayer` exists so an app's own plain CSS can override MUI without needing more specific selectors — that's the intended, documented use.

**The trap:** Tailwind v3's `@tailwind base/components/utilities` directives compile to plain, unlayered CSS. If you turn on `enableCssLayer` and do nothing else, Tailwind's own preflight reset — not just its utility classes — becomes unlayered too, and preflight touches broad selectors: `* { border-color: theme('borderColor.DEFAULT') }`, `h1..h6 { font-weight: inherit; font-size: inherit }`, `button, input, select, textarea { font: inherit; margin: 0 }`.

This was caught empirically, not theoretically, on the pilot component: a `Typography variant="h5"` styled `font-weight: 700; font-size: 24px` via `sx` **silently rendered at 400/16px** — preflight's `h1..h6` rule beat it. Verified via direct stylesheet-rule audit (walking `document.styleSheets`, checking `CSSLayerBlockRule` membership and `element.matches(selector)`), not guesswork. A `Card`'s intended hover `border-color: primary.light` similarly rendered as Tailwind's _default_ gray-200 (`#e5e7eb`) — not this app's `--border` token, not the intended hover color — because `* { border-color: ... }` from preflight beat both.

**The fix**, in `apps/web/src/app/globals.css`:

```css
@layer tailwind-base, mui, tailwind-utilities;

@layer tailwind-base {
  @tailwind base;
}
@tailwind components;
@layer tailwind-utilities {
  @tailwind utilities;
}
```

This is Tailwind v3's own documented compatibility pattern for native CSS cascade layers — not a hack specific to this repo. The bare `@layer` statement at the top establishes layer order globally (author-stylesheet order, established by first mention) before any rules are declared, so MUI's later-inserted `@layer mui {...}` blocks (from Emotion, via React SSR insertion) slot into the position already reserved for `mui`, regardless of DOM insertion timing.

**Verified both directions after the fix**, live in the browser:

1. MUI beats Tailwind's preflight: stat card value renders `font-weight: 700; font-size: 24px` (correct), hover border renders `rgb(153, 246, 228)` = `#99f6e4` = `theme.palette.primary.light` (correct).
2. Tailwind utilities still beat MUI: adding a real compiled utility class (`rounded-full`) to a live `MuiCard-root` node overrode the theme's `borderRadius: 12px` with `9999px` — confirmed via `getComputedStyle`.
3. Full unauthenticated-adjacent sweep of 5 pages that use zero MUI (`/contacts`, `/pipeline`, `/appointments`, `/settings/billing`, `/inbox`) after the `globals.css` change: 0 JS errors, 0 API errors, visually unchanged.

**Action item for anyone touching `globals.css` or adding another CSS-in-JS library later: do not remove this layer declaration**, and if a new "layered" library is added, its layer name needs a slot in that same top-of-file `@layer` statement or this bug reappears silently — it will not throw, lint, or fail a build. It only shows up as component internals quietly reverting to Tailwind's defaults.

### Second instance, found in Phase 3: it's not just Tailwind's generated CSS

The fix above only wraps `@tailwind base/components/utilities` — Tailwind's _generated_ output. `globals.css` also has hand-written CSS below that block: `:root` custom properties, `html`/`body` defaults, and a `h1, h2, h3, h4, h5, h6 { font-family: 'DM Serif Display' }` rule. That hand-written CSS is just as unlayered as preflight was, and has the identical bug.

This wasn't caught by inspection — it surfaced as a real regression while doing the Phase 3 token refactor. The pilot's stat-card value (`Typography variant="h5"`, which renders a real `<h5>` tag) is styled `font-weight: 700` via the theme, same as before. After the tokens refactor its **font-family** silently flipped from `DM Sans` to `DM Serif Display` — not because the refactor touched anything font-related, but because a computed-style diff caught it, and a stylesheet-rule audit traced it to that one hand-written `h1..h6` rule in `globals.css`, still unlayered, still winning over MUI by the same cascade mechanism as before.

**Fixed two ways, not one:**

1. Moved `:root`, `html`/`body`, and the `h1-h6` rule inside the same `tailwind-base` layer as `@tailwind base`, so any future MUI `Typography` using a real heading tag correctly inherits from the theme instead of this rule.
2. Fixed the pilot itself: `StatCard`'s value now renders `component="p"` instead of the default `h5` tag mapping. Independent of the CSS bug — a stat number isn't a document heading, and the _original_ pre-migration Tailwind version used a plain `<p>`, sans-serif. `variant="h5"` (for the type-scale styling) plus `component="p"` (for the actual tag) gets both the right look and the right semantics, and sidesteps this whole class of collision for this component regardless of what `globals.css` does.

**Verified both changes don't regress the non-MUI part of the app:** plain `<h1>`/`<h2>` tags on `/sign-in` (a page with zero MUI components) still resolve `DM Serif Display`, unchanged — moving these rules into a layer doesn't affect elements that have no competing layered rule.

**Generalized action item:** any _new_ base-level rule added to `globals.css` — not just Tailwind's own output — needs to go inside the `tailwind-base` layer block, not beside it, or it silently outranks every MUI component again. This is a standing risk for the rest of the migration: any global selector broad enough to also match an MUI-rendered element (tag selectors like `button`, `input`, `a`, `h1-h6`; the universal selector; anything targeting a shared class name) is a candidate for this bug if it's ever added outside the layer.

## What's installed (Phase 1)

```
@mui/material@^9.3.1
@emotion/react@^11.14.0
@emotion/styled@^11.14.0
@mui/material-nextjs@^9.3.0
```

`@mui/icons-material` was installed then **removed** — 172MB on disk, unused (this app's icon convention is plain unicode/emoji characters, not SVG icon components; see any existing sidebar icon). Add it back only when a component genuinely needs a specific icon, and import each icon from its own subpath (`import ContentCopy from '@mui/icons-material/ContentCopy'`), never the barrel (`import { ContentCopy } from '@mui/icons-material'`) — the barrel can defeat tree-shaking depending on bundler behavior.

Dependency resolution: clean, single copy of React (19.2.8) and Emotion, MUI itself deduped under `@mui/material`. `npm audit` after install shows 0 new vulnerabilities attributable to MUI/Emotion/the Next.js integration package — all pre-existing findings trace to `next-auth`, `next`, `sentry`/`opentelemetry`, `multer`, `sharp`, `undici`.

## Files added/changed (Phase 1-3)

| File                                                         | Purpose                                                                                                                                                                                                             |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/theme/tokens.js`                               | Phase 3. Single source of truth for color/font values — plain CJS, `require()`-able from `tailwind.config.js`, typed via JSDoc for the TS side.                                                                     |
| `apps/web/src/theme/muiTheme.ts`                             | `createTheme()` reading from `tokens.js` (was hand-duplicated literals through Phase 2 — fixed in Phase 3).                                                                                                         |
| `apps/web/tailwind.config.js`                                | Now reads from the same `tokens.js`. Verified byte-identical output before/after via a direct `require()` diff.                                                                                                     |
| `eslint.config.js`                                           | `no-require-imports` off for `tailwind.config.js` (CJS config loader, not TS-transpiled); a `module`-global override for `tokens.js` itself.                                                                        |
| `apps/web/src/theme/ThemeRegistry.tsx`                       | Client component: `AppRouterCacheProvider` (with `enableCssLayer: true`) + `ThemeProvider`. No `CssBaseline` — Tailwind's preflight already normalizes the document; two resets would fight over box-sizing/margin. |
| `apps/web/src/app/layout.tsx`                                | Wraps `children` in `ThemeRegistry`.                                                                                                                                                                                |
| `apps/web/src/app/globals.css`                               | The layer-order fix. As of Phase 3, covers not just `@tailwind base` but every hand-written document-base rule in this file (`:root` vars, `html`/`body`, the `h1-h6` font rule) — see "second instance" below.     |
| `apps/web/src/app/(dashboard)/dashboard/StatCard.tsx`        | Pilot component — MUI `Card`/`CardActionArea`/`Typography` replacing the hand-rolled Tailwind stat tile. Value renders `component="p"`, not the default `h5` tag — see below.                                       |
| `apps/web/src/app/(dashboard)/dashboard/DashboardClient.tsx` | Stat-card grid now renders `<StatCard>`; removed the now-dead `COLOR` map it replaced.                                                                                                                              |

CSP: no change needed. `style-src 'self' 'unsafe-inline'` (`apps/web/next.config.ts`) already covers Emotion's injected `<style>` tags.

## Pilot scope and result

Converted the Dashboard's 4 stat tiles (Total Contacts / Open Pipeline / Appointments Today / Calls Handled) — chosen because they're a self-contained rendering block inside a larger drag-and-drop widget board (`@hello-pangea/dnd`), so the conversion has a small, clearly-bounded blast radius and doesn't touch the DnD wiring.

Same data contract as before (`label`, `value`, `icon`, `color`, `href`) — this is a styling-layer swap, not a feature change. The visual upgrade: MUI's elevation transition on hover (`boxShadow: 0 → 2`) instead of a border-color swap, and `Typography`'s type scale instead of ad hoc `text-*` classes.

**Verification performed, not claimed:**

- `tsc --noEmit`: 0 errors (web + api)
- `eslint`: 0 (repo-wide)
- `apps/web` test suite: 15/15 passing
- `apps/api` test suite: unaffected, not re-run for this change (no api files touched)
- `next build`: succeeds, all routes emitted
- Runtime, logged in against the local dev stack: dashboard renders, stat cards show live data (153 contacts / 147 pipeline, matching prod), computed-style checks (not just "no console error") confirm colors/fonts/radius/hover state all resolve to the intended theme values
- 5-page sweep of MUI-free routes after the CSS change: 0 regressions

## Remaining work (not started)

No production user base yet — app is pre-launch, still in active development. Clear to proceed with wider rollout without a compatibility sign-off step.

This is a multi-week effort across 206 components; it was not attempted in one pass. Phase 3 (shared design tokens) is done — see above. Suggested phasing from here:

1. **Primitives first** — Button, TextField/Input, Modal/Dialog, Select, Menu are used everywhere and have the highest leverage: converting them once fixes consistency across every page that uses them, without a page-by-page rewrite. Given the Phase 3 findings, audit each primitive's default rendered tag against `globals.css`'s base rules before converting — anything rendering `button`, `a`, `input`, or `h1-h6` is a candidate for the same collision the stat card hit.
2. **New surfaces get MUI by default** — any new page/feature built from here should use MUI primitives rather than hand-rolled Tailwind, so the split doesn't grow.
3. **Opportunistic conversion** of existing pages — prioritize the ones flagged from the earlier full-app audit as weakest (empty states with no CTA, the 54 unlabeled toggle buttons on Notifications/Modules/Voice AI — MUI's `Switch`/`IconButton` have correct `aria-label` ergonomics built in, which would fix that a11y gap as a side effect of migrating those controls).
4. **`react-big-calendar`, `recharts`, `@hello-pangea/dnd`** are unrelated to MUI and don't need touching — they're not being replaced, just need to keep working alongside MUI surfaces on the same page (Appointments already does, per the React 19 upgrade's verification pass).

## Rollback

Every change here is additive and isolated: `ThemeRegistry` wraps `children` without altering existing markup, `globals.css`'s layer restructuring is a no-op for any page that never renders an MUI component, and `StatCard.tsx` is a single leaf component with the same props contract as what it replaced. Reverting is: remove the `ThemeRegistry` wrap in `layout.tsx`, revert `globals.css`, revert `DashboardClient.tsx`/delete `StatCard.tsx`, uninstall the four packages.
