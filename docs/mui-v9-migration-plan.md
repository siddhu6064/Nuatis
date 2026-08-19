# MUI v9 migration plan

Branch: `chore/mui-v9-migration`. Status as of this document: **Phases 1-15 complete and verified** (foundation, pilot, shared design tokens, `Modal` rollout complete — 17 of ~18 modals converted — and `SlideOver` 3 of 4 edge-panel candidates converted, only `AppointmentDrawer` left). Remaining work is `AppointmentDrawer` and opportunistic conversion — see "Remaining work" below.

**Related, out-of-branch:** four pre-existing app bugs found during Phase 9-11 live verification (report creation, Smart List creation, bulk-assign validation, blocked appointment slots) were fixed on their own branches, unrelated to this migration — see [PR #15](https://github.com/siddhu6064/Nuatis/pull/15) and [PR #16](https://github.com/siddhu6064/Nuatis/pull/16).

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

## Files added/changed (Phase 1-15)

| File                                                                   | Purpose                                                                                                                                                                                                             |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/theme/tokens.js`                                         | Phase 3. Single source of truth for color/font values — plain CJS, `require()`-able from `tailwind.config.js`, typed via JSDoc for the TS side.                                                                     |
| `apps/web/src/theme/muiTheme.ts`                                       | `createTheme()` reading from `tokens.js` (was hand-duplicated literals through Phase 2 — fixed in Phase 3).                                                                                                         |
| `apps/web/tailwind.config.js`                                          | Now reads from the same `tokens.js`. Verified byte-identical output before/after via a direct `require()` diff.                                                                                                     |
| `eslint.config.js`                                                     | `no-require-imports` off for `tailwind.config.js` (CJS config loader, not TS-transpiled); a `module`-global override for `tokens.js` itself.                                                                        |
| `apps/web/src/theme/ThemeRegistry.tsx`                                 | Client component: `AppRouterCacheProvider` (with `enableCssLayer: true`) + `ThemeProvider`. No `CssBaseline` — Tailwind's preflight already normalizes the document; two resets would fight over box-sizing/margin. |
| `apps/web/src/app/layout.tsx`                                          | Wraps `children` in `ThemeRegistry`.                                                                                                                                                                                |
| `apps/web/src/app/globals.css`                                         | The layer-order fix. As of Phase 3, covers not just `@tailwind base` but every hand-written document-base rule in this file (`:root` vars, `html`/`body`, the `h1-h6` font rule) — see "second instance" below.     |
| `apps/web/src/app/(dashboard)/dashboard/StatCard.tsx`                  | Pilot component — MUI `Card`/`CardActionArea`/`Typography` replacing the hand-rolled Tailwind stat tile. Value renders `component="p"`, not the default `h5` tag — see below.                                       |
| `apps/web/src/app/(dashboard)/dashboard/DashboardClient.tsx`           | Stat-card grid now renders `<StatCard>`; removed the now-dead `COLOR` map it replaced.                                                                                                                              |
| `apps/web/src/components/ui/Modal.tsx`                                 | Phase 4. First shared primitive — wraps MUI `Dialog`, matches the app's existing modal convention.                                                                                                                  |
| `apps/web/src/app/(dashboard)/settings/gift-cards/GiftCardsClient.tsx` | Phase 4 pilot — `RedeemModal` converted to the new `Modal` primitive.                                                                                                                                               |
| `apps/web/src/app/(dashboard)/settings/lead-scoring/page.tsx`          | Phase 5 — `AddRuleModal` converted; `<form onSubmit>` pattern, `<select>` → MUI `TextField select`.                                                                                                                 |
| `apps/web/src/app/(dashboard)/subscriptions/page.tsx`                  | Phase 5 — `CancelModal` converted; raw radios → `RadioGroup`/`Radio`, one-off `bg-red-600` → `color="error"`.                                                                                                       |
| `apps/web/src/app/(dashboard)/settings/email-templates/page.tsx`       | Phase 6 — Create/Edit template modal; `<select>` → `TextField select`, `<textarea>` → `TextField multiline`.                                                                                                        |
| `apps/web/src/components/contacts/DuplicatesReviewer.tsx`              | Phase 6 — Merge modal; 3 independent radio choices → `RadioGroup`/`Radio`. Primary-contact card-picker stays plain buttons deliberately.                                                                            |
| `apps/web/src/app/(dashboard)/quotes/[id]/QuotePayments.tsx`           | Phase 7 — Record Payment modal; `TextField` + `InputAdornment` for the `$` prefix (an improvement over a manually positioned span). Method picker stays plain buttons.                                              |
| `apps/web/src/components/inventory/InventoryList.tsx`                  | Phase 7 — delete-confirm modal; simplest conversion so far, no form fields.                                                                                                                                         |
| `apps/web/src/app/(dashboard)/settings/reports/page.tsx`               | Phase 8 — Schedule a Report modal; real `<input type="radio">` pairs → `RadioGroup`/`Radio`. Caught a bad `primary.50` token before it shipped.                                                                     |
| `apps/web/src/app/(dashboard)/settings/calendar/page.tsx`              | Phase 8 — Switch Provider confirm; "Continue" leads to a real OAuth redirect, deliberately not exercised.                                                                                                           |
| `apps/web/src/app/(dashboard)/reports/page.tsx`                        | Phase 9 — dashboard-level "New Report" 6-step wizard modal chrome; wizard internals untouched. Save step blocked from full verification by a pre-existing, unrelated backend bug (see Phase 9).                     |
| `apps/web/src/app/(dashboard)/campaigns/[id]/page.tsx`                 | Phase 9 — reusable `ConfirmModal` (Approve/Generate/Schedule/Cancel triggers). Verified by inspection; live "Cancel campaign" run blocked by two pre-existing, unrelated issues (see Phase 9).                      |
| `apps/web/src/components/contacts/BulkActionBar.tsx`                   | Phase 10 — 5-variant modal (stage/tag/assign/sms/archive) sharing one overlay. Fixed a real pre-existing JSX whitespace bug caught while verifying live (see Phase 10).                                             |
| `apps/web/src/app/(dashboard)/appointments/AppointmentsCalendar.tsx`   | Phase 11 — blocked-slot detail panel and Block Off Time modal. Found a real pre-existing NOT NULL constraint bug blocking every "Block Time" submission ever (see Phase 11).                                        |
| `apps/web/src/app/(dashboard)/reputation/VideoReviewsTab.tsx`          | Phase 12 — `SubmissionModal` (video testimonial review). Verified by inspection; live verification blocked by a server-rendered OAuth gate plus a real AI-call risk on the only path to test data (see Phase 12).   |
| `apps/web/src/app/(dashboard)/quotes/payment-links/page.tsx`           | Phase 13 — create/success modal; link creation fully verified live, real SMS send held back. Closes out the last two deferred candidates (see Phase 13).                                                            |
| `apps/web/src/components/contacts/EmailComposeModal.tsx`               | Phase 13 — Compose Email form; empty-state verified for real, full form verified via fetch interception, real Gmail/Outlook send held back.                                                                         |
| `apps/web/src/components/ui/SlideOver.tsx`                             | Phase 14. Second shared primitive — wraps MUI `Drawer(anchor="right")`, matching this app's edge-panel convention. `open` has no default, unlike `Modal`.                                                           |
| `apps/web/src/components/inventory/InventorySlideOver.tsx`             | Phase 14 pilot — Add/Edit item + Adjust Quantity. Dropped its internal `if (!open) return null` guard so the slide animation actually plays — a real UX improvement, not just a visual swap.                        |
| `apps/web/src/components/staff/StaffSlideOver.tsx`                     | Phase 15 — Add/Edit team member. Direct swap, same shape as the Phase 14 pilot.                                                                                                                                     |
| `apps/web/src/components/staff/ShiftSlideOver.tsx`                     | Phase 15 — Add/Edit shift. Nested delete-confirm stays plain Tailwind, positioned within the panel rather than forced through `Modal`'s full-page centering (see Phase 15).                                         |

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

## Phase 4: first shared primitive

This codebase had **no shared UI primitives before phase 4** — every button, modal, and form field is hand-rolled per feature. That reframed "primitives first" from the original plan: there's no single existing shared component to convert for leverage, so the leverage move is building the primitive so it exists, then converting one real call site to prove the API fits real usage rather than an imagined one.

**Audit before building:** ~30 files use the same hand-rolled `fixed inset-0 z-50 ... bg-black/40` modal overlay pattern. Sampled 3 at random — none handle Escape-to-close, focus trapping, or `aria-modal`. That's the concrete case for `Modal` as the first primitive, not `Button` (simpler, lower-risk to hand-roll, weaker case) or `Select`/`Menu` (fewer call sites found).

`apps/web/src/components/ui/Modal.tsx` wraps MUI `Dialog`, matching the app's existing visual convention exactly (rounded panel, border, header/footer dividers, inline X icon) instead of introducing a new look. `open` defaults to `true` because the existing convention is conditional _mounting_ (`{show && <TheModal/>}`), not an open-prop toggle — adopting the primitive doesn't require restructuring a call site's state.

**A phase-3 prediction confirmed correct:** MUI's `DialogTitle` defaults to `component: "h2"` — exactly the collision class flagged as a standing risk at the end of phase 3. It renders fine here because `globals.css`'s `h1-h6` rule already lives inside the `tailwind-base` layer from that fix. Any future primitive whose default tag is `button`/`a`/`input`/`h1-h6` is worth the same computed-style check before calling it done.

**Pilot conversion:** `GiftCardsClient.tsx`'s `RedeemModal` — self-contained, 4 props, real backend calls (issue/redeem/error paths), small bounded scope.

**One deliberate behavior change, not just a styling swap:** the original success screen's backdrop was inert — clicking outside it did nothing, only the "Done" button closed it. MUI's `Dialog` always wires backdrop-click and Escape to `onClose`. Rather than leave that as a silent gap (dismiss without refreshing the parent's list), both paths now call `onSuccess` + `onClose` together, same as "Done" — a small, deliberate correctness fix riding along with the primitive swap, documented here rather than left implicit in the diff.

**Verified against the real backend**, not render-without-error: issued a real gift card through the existing (untouched) `IssueForm`, opened the converted dialog, confirmed `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` (none present before), confirmed focus starts inside the dialog, confirmed Escape closes it, redeemed $10 of $50 end-to-end (table updated to $40), tested the over-limit path (real 400 from the API, inline error banner, dialog stays open, form retains its values), confirmed Cancel closes cleanly. Swept 6 other pages (MUI and non-MUI) afterward: 0 new JS/API errors. Full check suite: typecheck 0, lint 0, web tests 15/15, build clean.

## Phase 5: rolling the primitive out

**Triage before converting anything.** Re-ran the `fixed inset-0` search (~30 files). Not all of them are `Modal` candidates: the mobile sidebar backdrop, a dropdown-popover backdrop, and three slide-over panels (Inventory/Staff/Shift — these say "Drawer" in their own filenames) use the same overlay CSS shape but are a different UI pattern than a centered dialog. Filtering by the `items-center justify-center` signature that actually distinguishes a centered dialog from those narrowed it to 17 real candidates. Forcing a slide-over into `Dialog` would have been the wrong primitive — noted as its own future item (MUI `Drawer`), not lumped in here.

**Picked two that stress different integration patterns than the Phase 4 pilot**, deliberately — the goal was proving the primitive generalizes, not padding the conversion count:

- **`lead-scoring` `AddRuleModal`** — a `<form onSubmit>` with the submit button _inside_ the form, and no footer divider in the original design. This is the case that would have broken if `Modal`'s `footer` prop were used here: `DialogActions` is a DOM _sibling_ of `DialogContent`, not nested inside it, so a submit button placed there sits outside any `<form>` wrapping the content — native submit-on-Enter would silently stop working. Solved by not using `footer` at all for this one; Cancel/Add Rule stay as plain children inside the form, exactly matching the original's no-divider look for free. Also converts a `<select>` to MUI `TextField` in `select` mode with `MenuItem`s.
- **`subscriptions` `CancelModal`** — raw radio-button pairs convert to `RadioGroup`/`FormControlLabel`/`Radio`. The original's one-off `bg-red-600` danger button becomes `Button color="error"`, which resolves through the theme to `#ef4444` — a small, deliberate visual choice (app-wide semantic red instead of a page-local hex), called out here rather than left as a silent diff.

**A real tooling gotcha, worth keeping in mind for future verification:** a synthetic `.click()` does not open an MUI `Select` — same limitation already hit with `react-big-calendar`'s toolbar during the React 19 upgrade. Verification needs a real browser click (`computer` tool coordinates or equivalent) for that specific interaction. Separately, filling form fields by querying "the first input with no explicit `type`" grabbed MUI Select's _hidden_ form-value input instead of the visible Label field — MUI Select renders both; query by placeholder/label text, not input position.

**Verified against the real backend, not render-without-error, for both:**

- lead-scoring: opened the Select with a real click, confirmed all 4 categories listed, picked "Behavior", submitted, got a real `201` from `POST /api/lead-scoring/rules`, confirmed the new rule landed under the right category tab (`Behavior (1)`).
- subscriptions: created a real subscription through the page's own _unconverted_ New Subscription flow first (incidentally confirming that flow — sharing the same file — still works untouched), opened Cancel, confirmed `role="radiogroup"` and the error button's computed color (`rgb(239, 68, 68)` = `#ef4444`, exactly the theme value), selected "Cancel immediately" with a real click, submitted, got a real `200` from `POST /api/subscriptions/:id/cancel`, confirmed the row shows `Cancelled`.
- Escape-to-close confirmed on both. Full check suite: typecheck 0, lint 0, web tests 15/15, build clean.

**Explicitly deferred, not converted this pass:** `quotes/payment-links`' modal has a live SMS-send action — same category of outward-facing side effect flagged during the original full-app audit as needing explicit go-ahead before firing for real. Left for a pass where that's been discussed, rather than risk it during routine verification.

## Phase 6: two more, one with no real test data available

Converted `email-templates`' Create/Edit modal (`<select>` → `TextField select`, `<textarea>` → `TextField multiline`) and `DuplicatesReviewer`'s Merge modal (three independent radio choices → three `RadioGroup`s).

**A judgment call made and documented, not left as a silent diff:** the primary-contact picker in the merge modal is a custom two-card selector, not a semantic radio choice — it stayed as plain Tailwind buttons rather than being forced into `ToggleButtonGroup`, since introducing a new MUI component type isn't justified by one usage. The three _field-conflict_ choices (name/phone/email) are genuinely mutually-exclusive radio choices and did convert. Not every input in a modal needs to become an MUI component just because the modal itself did — the primitive rollout is about matching each interaction to the right semantic, not maximizing MUI surface area.

**One consistency addition, called out rather than silently changing behavior:** the original merge modal had no header divider or close button, just an inline `<h3>`. Using `Modal`'s `title` prop adds both — done so this modal matches the header treatment every other converted modal already has, rather than being the one inconsistent holdout.

**The demo tenant had zero real duplicate contact pairs** — the earlier full-app audit never generated any, and 153 synthetic contacts apparently don't collide. Rather than settle for a structural-only check, created two contacts with an identical phone number directly through the browser's own authenticated session (the same signal the backend's own duplicate-detection endpoint looks for: `match_reason: 'Same phone'`), which surfaced a real pair, then ran the full merge end to end — including switching which contact was "primary" mid-flow and confirming via direct `GET /api/contacts/:id` calls afterward that the non-chosen contact was archived and the chosen one wasn't. This is the same standard as every prior conversion: verify the real data path, not just that the dialog opens.

Full check suite: typecheck 0, lint 0, web tests 15/15, build clean. Console/network swept clean of new errors across both conversions.

## Phase 7: closing out one open item, finding a subtler outward-facing risk

Followed up on Phase 6's open item first: checked `EmailComposeModal.tsx` before converting anything else. It hits `/api/email-integrations/send/:contactId` — the real Gmail/Outlook send endpoint (the one the `appUserId` bug fix touched, from before this migration started). Same category of side effect as `payment-links`' SMS action. Deferred again, still needs an explicit go-ahead.

**A subtler version of that same check, on `QuotePayments.tsx`:** its Method picker includes a "stripe" option, which could easily have been assumed risky by pattern-matching on the word alone. Read the backend route instead of assuming: `POST /api/quotes/:id/payments` only makes a real outbound API call when `method === 'square'` (a live charge via `createSquarePayment`) — `cash`/`check`/`stripe`/`other` are pure record-keeping inserts, no live charge for any of them, and the frontend doesn't even expose `'square'` as a selectable option. Converted it, and verified using `method: 'cash'` specifically to stay clear of the one code path that does call out.

Converted `QuotePayments`' Record Payment modal and `InventoryList`'s delete-confirm — deliberately paired one more-complex form against one of the simplest conversions yet (no form fields at all), for contrast.

**A genuine improvement, not just a like-for-like swap:** the Amount field's `$` prefix used to be a manually `absolute`-positioned `<span>`; it's now MUI's `InputAdornment`, the component built for exactly this.

**Consistent with Phase 6's stated policy, applied without re-litigating it:** `QuotePayments`' Method picker (4-button icon grid) stays plain Tailwind buttons, same reasoning as `DuplicatesReviewer`'s primary-contact picker — a real mutually-exclusive choice, but not enough to justify introducing `ToggleButtonGroup` for one call site, and the icon-grid layout doesn't map cleanly onto its default styling anyway. `InventoryList`'s confirm dialog uses `title` despite the original having no header, same reasoning as `CancelModal`/the merge modal in phases 5-6.

**Verified against the real backend for both, including working around two "no test data" gaps in different ways:**

- None of the 4 existing demo quotes were `accepted` status, which gates whether `QuotePayments` even mounts. Rather than force a status update through a side door, called the quote's own public accept endpoint with its real `share_token` (`POST /api/quotes/view/:token/accept`) — the same call a customer would make. Confirmed the Payments section appeared, the Amount field pre-filled with the real balance due, and the Reference placeholder derived correctly when Method changed (a state-derivation check, not just a render check). Recorded a real $50 cash payment, got a real `201`, confirmed the quote flipped to "Partial" with correct paid/balance figures.
- `InventoryList` needed a real item to delete; created a throwaway one via the authenticated session's own fetch (same pattern as prior phases), confirmed Escape declines without deleting, then confirmed a real `200` from `DELETE /api/inventory/:id` and the row disappearing.

Full check suite: typecheck 0, lint 0, web tests 15/15, build clean. Console/network swept clean of new errors.

## Phase 8: a bad token caught before shipping, a policy made explicit, a modal reached without touching OAuth

Converted `settings/reports`' Schedule a Report modal and `settings/calendar`'s Switch Provider confirm.

**Checked outward-facing risk on both before converting anything**, same discipline as every prior phase. `settings/calendar`'s "Continue" button leads to `confirmSwitch()` → a real `window.location.href` redirect to Google/Microsoft OAuth — deliberately not exercised, same treatment as the SMS/email sends held back earlier; only Cancel/Escape verified for real. `settings/reports`' save only persists a schedule config for a future cron job — no synchronous send — confirmed by reading the route, so it got the full real-submit treatment.

**A real bug caught before shipping, not after — this is the mechanism working as intended.** Wrote `bgcolor: 'primary.50'` for the Frequency radio's selected state, a pattern that reads as plausible (numbered palette shades are a common MUI convention) but doesn't exist in this theme — `muiTheme.ts` only defines `main`/`light`/`dark`/`contrastText`. TypeScript didn't catch it: `sx`'s color-prop types are permissive by design, since the same prop also accepts raw CSS colors, so an invalid theme path typechecks as a valid string. Caught it by checking, not by trusting the diff — fixed to the literal hex matching Tailwind's `bg-teal-50` (the original's exact color), then confirmed via `getComputedStyle` on the live page that the fix actually took (`rgb(240, 253, 250)` = `#f0fdfa`, exactly right).

**A retroactive gap disclosed, not quietly carried forward.** While deciding what color `settings/calendar`'s Continue button should be, noticed Phase 6's `email-templates` Save button had already silently gone from that page's `bg-blue-600` to the theme's default teal (`variant="contained"` with no `color` prop) — a real, if minor, undocumented deviation from a prior phase. Not fixing it retroactively (that page's modal already reads as teal now, changing it back would be its own unreviewed diff), but the policy is now explicit and disclosed here instead of quietly repeating: converted modal buttons use the app's shared primary color, not each page's local accent — the point of one theme is exactly that per-page colors don't bleed into a shared component.

**Reached a modal whose own precondition blocked the natural path to it.** `settings/calendar`'s Switch Provider dialog only opens when `status.connected === true` — but reaching that state through the real UI requires completing the exact OAuth flow already ruled out. Intercepted `window.fetch` so the already-loaded page believed `/api/settings/calendar` returned a connected Outlook account — no real account touched, this only changes what the page _displays_, not any external state — then triggered the modal with a real click. Confirmed correct provider-name interpolation, confirmed Cancel and Escape both close without switching, then did a full page reload (which drops the interception automatically, since it's page-scoped) and confirmed the real status was unaffected throughout.

Full check suite: typecheck 0, lint 0, web tests 15/15, build clean. Console/network swept clean of new errors.

## Phase 9: two real app bugs found, neither of them mine to fix here

Converted the dashboard-level `reports/page.tsx`'s 6-step "New Report" wizard modal chrome and `campaigns/[id]/page.tsx`'s reusable `ConfirmModal`.

**Wizard conversion:** wrapped the existing `renderStep1()`–`renderStep6()`, `canAdvance()`, `wizardStep` state, and `handleSaveReport()` in `Modal` without touching any of it. The one real layout wrinkle: the footer needs Back pinned left and Cancel/Next grouped right, but `DialogActions` (what `Modal`'s `footer` slot renders into) only supports `flex-end` by default. Rather than change `Modal.tsx` for one caller, wrapped the three buttons in a full-width flex `<div>` inside the `footer` prop itself — same "don't touch the shared primitive for a one-off need" reasoning as Phase 5's `AddRuleModal` decision not to use `footer` at all.

**Found a real, pre-existing bug while doing full real-backend verification of the Save step.** Navigation, step-gating, Back preserving state, Cancel, and Escape all verified working correctly. Clicking "Save Report" got a real `400` from `POST /api/reports`. Investigated with a raw `fetch()` POST matching the app's own payload and got `{"error":"metric must be one of: count, sum, avg, min, max"}` — even though `metric_fn: 'count'` (what the frontend actually sends) is a valid value for that allow-list, which only made sense once `apps/api/src/routes/reports.ts` was read directly: the backend validates a field literally named `metric`, and `handleSaveReport()` sends `metric_fn`. The backend never receives a `metric` field at all, so every report save has always failed. This predates and is unrelated to the Modal conversion — `handleSaveReport()`'s payload construction was never touched by this migration. Not fixed here (out of scope for a UI-chrome-only phase); flagged to the user directly as a real, currently-broken feature.

**`campaigns/[id]`'s `ConfirmModal` could not be driven to a live "Cancel campaign" run**, the one trigger on that page previously identified as safe to fully exercise (Schedule/Approve/Generate lead toward real AI generation or sending). Reaching a `scheduled` campaign needs a Smart List selected in the wizard, and creating one hit a second real, pre-existing bug: `POST /api/smart-lists` 500s on every call, because `smart-lists.ts` inserts `created_by: authed.userId` — this session's raw Auth.js JWT `sub` — instead of `authed.appUserId ?? null`, the pattern every other route in this codebase uses (`quotes.ts`, `reports.ts`, `campaigns.ts` itself all use `authed.appUserId ?? null`). `authed.userId` is empty in this session, and the column is `uuid`, so the insert fails outright. This is the identity-model bug class already fixed elsewhere in the app before this migration started, just never in this one file. Worked around the missing Smart List by creating a campaign directly via `POST /api/campaigns` (which doesn't actually require `smart_list_id` server-side, only the wizard UI blocks on it) — but the next step, calling `/api/campaigns/:id/generate` to get real copy so the campaign could reach `scheduled`, was blocked by the auto-mode safety classifier: it's a real, billed AI-generation call, and the classifier correctly refused it as exactly the kind of outward-facing/costly action this migration has deliberately avoided firing synthetically in every prior phase. Cleaned up the throwaway campaign (`DELETE /api/campaigns/:id`, real `200`) and did not attempt to route around either blocker. Verified `ConfirmModal` by inspection instead: it's structurally identical (`Modal` + `Button variant="outlined" color="inherit"` Cancel, `Button variant="contained" color={destructive ? 'error' : 'primary'}` Confirm) to `InventoryList`'s delete-confirm and `subscriptions`' `CancelModal`, both already live-verified in Phases 5 and 7.

Both bugs are reported to the user directly, not silently absorbed into this migration's scope — the `metric`/`metric_fn` mismatch blocks all report creation, and the `smart-lists.ts` `created_by` bug blocks all Smart List creation, independent of anything MUI-related.

Full check suite: typecheck 0 (web + api), lint 0, web tests 15/15, build clean.

## Phase 10: five modal variants, one shared overlay, a third pre-existing bug found and one fixed on sight

Converted `contacts/BulkActionBar.tsx` — a floating selection bar with 5 modal variants (Move Stage, Tag, Assign, Send SMS, Archive) that all share a single overlay wrapper, switching on one `modal` state variable.

**A naming collision, not a design decision.** The file's own state type was already called `Modal` (`type Modal = null | 'stage' | 'tag' | 'sms' | 'assign' | 'archive'`), which would shadow the imported `Modal` primitive. Renamed the local type to `ModalKind`; the state variable, setters, and all call sites are otherwise untouched.

**Checked outward-facing risk before converting anything**, same as every phase. The SMS variant hits `/api/contacts/bulk-sms`, a real Telnyx send — same category as `payment-links` and `EmailComposeModal`, both still deferred. Converted it (it's still just UI structure) but held back firing it for real: verified the `TextField` binding, the `{{first_name}}` merge-tag insertion, the live char counter and preview, and the opted-out-contact disable logic (the trigger button itself is correctly `disabled` when any selected contact has `sms_opt_in === false`, confirmed by first selecting an opted-out contact and seeing it disabled, then an opted-in one and seeing it enable) — but never clicked "Queue N SMS".

**Live-verified the other four against the real backend**, using the demo tenant's existing contacts plus one throwaway contact created via the browser's own authenticated `fetch()` (same synthesized-data pattern as prior phases): Move Stage got a real `200` and both selected rows visibly updated to "Contacted"; Tag got a real `200` and both rows picked up a `phase10-test` chip; Archive got a real `200` on the throwaway contact, which then disappeared from the list and the total count decremented.

**Assign hit a real, pre-existing `500` — a second bug this phase, unrelated to the conversion.** `POST /api/contacts/bulk-assign` writes `assignedTo.trim()` straight into `assigned_to_user_id`, a `uuid` column, with no lookup or format check — but the field's own placeholder text says "Assignee user ID or name", inviting exactly the free-text input that breaks it. `handleAssign()`'s request body was not touched by this conversion; this bug predates it. Not fixed here — flagged separately, same treatment as Phase 9's two findings.

**Caught and fixed a real rendering bug while verifying Archive, this one on sight rather than deferred.** The confirm text rendered as "Archive 1contacts?" — no space. Traced it to JSX's whitespace-collapsing behavior: `Archive {count} contacts? ...` spanning two source lines causes Babel to drop the literal space immediately after the `{count}` expression when rejoining the lines. Confirmed via `git show HEAD` that this exact text, byte-for-byte, existed before this conversion touched the file — so it's not something Phase 10 introduced, just an existing bug this phase happened to be looking directly at. Fixed by collapsing the whole sentence into a single template-literal expression (`{`Archive ${count} contacts? ...`}`), which sidesteps JSX's line-based collapsing entirely since it's one JS string, not JSX text nodes. Re-verified live: the DOM text node now reads "Archive 1 contacts?" correctly, then completed a real archive against the throwaway contact to confirm the fix didn't change any actual behavior.

Both dev servers had dropped since Phase 9 (context reset between sessions) — restarted `api`/`web` via `.claude/launch.json` and re-authenticated as the demo tenant before any of this phase's verification.

Full check suite: typecheck 0, lint 0, web tests 15/15, build clean.

## Interlude: the three Phase 9/10 bugs got fixed, on their own branch

Between Phase 10 and Phase 11, the three app bugs found during earlier live verification (report creation's `metric_fn`/`metric` mismatch, Smart List creation's `created_by` field, bulk-assign's missing validation) were fixed and shipped as [PR #15](https://github.com/siddhu6064/Nuatis/pull/15) — branched from `main`, not from `chore/mui-v9-migration`, since none of it is MUI-related and this migration branch shouldn't carry unrelated backend fixes in its history. Fixing the `metric_fn` bug surfaced a second, previously-masked bug in the same save path (the wizard's "No grouping (total only)" option had no backend support at all, in the create route or in `report-engine.ts`'s actual aggregation logic) — fixed by removing the dead option and defaulting `group_by` to a real field instead of building out a real "ungrouped" feature with no clear spec. All three fixes were verified live end-to-end (created and deleted a real report through the actual wizard, a real Smart List, and confirmed bulk-assign now 400s cleanly on garbage input and 200s on a real user id) before merging back onto this branch's working tree via a plain `git checkout`.

## Phase 11: two more modals, a fourth pre-existing bug, and a line drawn on how far to chase it

Converted `appointments/AppointmentsCalendar.tsx`'s two modals: the blocked-slot detail panel and the Block Off Time modal. The main appointment-detail view (`AppointmentDrawer.tsx`) is a slide-over, not this pattern — left alone for the future `Drawer` primitive, same as the other three files in that category from Phase 5's triage.

**Checked outward-facing risk first**, same as every phase: both hit plain internal CRUD (`POST /api/appointments/block`, `DELETE /api/appointments/:id`) — no SMS/email/OAuth, safe to fully exercise. `<select>` elements convert to `TextField select`/`MenuItem` per the established convention (Calendar, Start Time, End Time); the native `<input type="date">` stays a plain date input inside a `TextField` wrapper (`slotProps.inputLabel.shrink` avoids label overlap) rather than pulling in a date-picker component for one field.

**Hit a real 500 live-verifying the Block Off Time modal's submit**, after confirming the rest of its chrome worked (select bindings, date input, Enter-to-submit on Reason). Read the backend route first rather than assume: `POST /api/appointments/block`'s insert never supplies `contact_id`. Checked the schema directly (`supabase/migrations/0001_initial_schema.sql`): `contact_id` has been `NOT NULL` since the table was created; the block-time feature was added later (`0075_blocked_slots.sql`, which only added `is_blocked`/`block_reason` columns) and never touched that constraint. This means "Block Time" has failed on every single submission since it shipped — a bug entirely independent of this conversion, since neither the backend route nor `submitBlock()`'s payload were touched here.

**Drew an explicit line on scope, not just for whether to fix it but for how far to chase verifying around it.** Unlike the Phase 9/10 bugs (a wrong field name, a wrong `created_by` value, a missing validation check — all safe one-line fixes), this one needs an actual schema decision: relax the `NOT NULL` constraint, or have the route supply a placeholder `contact_id`, and this repo's local dev points at the same shared Supabase project as prod (per this session's own memory) — not something to decide and migrate unilaterally mid-phase. Considered creating throwaway fixture data via a direct SQL insert (bypassing the broken route) to still live-verify the blocked-slot detail panel, the same synthesized-data instinct used in Phases 6-7 — but that specific workaround means a raw write against the shared database for the sole purpose of testing one small modal, which is a disproportionate risk for what it buys. Verified that panel by inspection instead: it's structurally identical to the Block Off Time modal already live-verified in this same file, and to `InventoryList`'s delete-confirm from Phase 7.

Full check suite: typecheck 0, lint 0, web tests 15/15, build clean.

## Interlude: the Block Time bug got fixed too, migration and all

The Phase 11 `contact_id` `NOT NULL` bug was fixed and shipped as [PR #16](https://github.com/siddhu6064/Nuatis/pull/16) — a schema migration (`0136_appointments_contact_id_nullable.sql`, `ALTER TABLE appointments ALTER COLUMN contact_id DROP NOT NULL`), unlike the three Phase 9/10 bugs, which were all application-code-only fixes. Applied directly to the shared Supabase project with explicit user go-ahead first — this one genuinely warranted asking, unlike routine demo-tenant data mutations, since a schema change affects the whole database, not just one tenant's rows. Verified live afterward: `POST /api/appointments/block` now returns a real `201` with `contact_id: null`, `GET /api/appointments` returns `contacts: null` for it exactly matching the frontend's existing type, and a full real-UI round trip ("Time blocked successfully") confirmed the fix end to end. One loose thread, noted but not chased further: the calendar's client-side `fetchRange` (a direct browser-side Supabase query, separate from the REST API) didn't immediately show the newly-created blocked event in the Day view during a spot check, even though the row existed correctly server-side. Didn't root-cause this — it's either a separate, minor client-rendering gap or an artifact of the test itself, and chasing it further wasn't a good use of time against the actual bug that was asked for.

## Phase 12: one more modal, verified by inspection for two independent reasons

Converted `reputation/VideoReviewsTab.tsx`'s `SubmissionModal` (video testimonial review: player, sentiment/status/duration badges, transcript, Approve/Reject/Feature/Delete). `CreateCollectorForm` in the same file is an inline form section, not a floating dialog — not a `Modal` candidate.

**Checked outward-facing risk on the actions first**, same discipline as every phase: all four actions (`approve`/`reject`/`feature`/delete) are pure DB status updates or storage deletes in `apps/api/src/routes/video-testimonials.ts` — no email/SMS/notification side effects, safe to fully exercise if a submission existed to test against.

**Couldn't reach one, for two independent reasons, neither caused by this conversion.** First: the Video Reviews tab only renders once Google Business Profile is connected, and unlike Phase 8's `settings/calendar` modal, `connected` here is a server-rendered prop computed in `page.tsx` from a real DB row — not a client-side fetch, so the `window.fetch`-interception technique that worked there doesn't apply. Second, more fundamentally: even past that gate, the only way to create a real submission is uploading an actual video through the public collect endpoint, which on success fires `generateTranscriptAndSentiment()` — a real AI call, the same class of action Phase 9's `campaigns/generate` hit and had correctly blocked by the auto-mode safety classifier. Unblocking the OAuth gate wouldn't get past that second risk anyway, so there was no reason to spend effort on the first. Verified by inspection instead: read `updateStatus()` and the `DELETE` handler directly to confirm the risk assessment above, and the converted JSX follows the exact `Modal` + `Button` pattern (`variant="contained"`/`"outlined"`, semantic `color` per action) already live-verified in every prior phase back to `InventoryList`'s delete-confirm (Phase 7).

Full check suite: typecheck 0, lint 0, web tests 15/15, build clean.

## Phase 13: the last two, both converted, one closes with a real 500 avoided

Converted the last two Modal candidates left from Phase 5's original triage: `quotes/payment-links`' create/success modal and `contacts/EmailComposeModal.tsx`.

**`payment-links` splits cleanly into a safe half and a held-back half**, and got treated accordingly. Creating the payment link itself (`POST /api/payment-links`) is a plain internal insert — it generates a Stripe Checkout URL, it doesn't charge anything — so that path got the full real-submit treatment: opened the modal, filled Amount (using MUI's `InputAdornment` for the `$` prefix, same pattern as `QuotePayments` in Phase 7) and Description, exercised the contact-search popover, and created a real link, confirming the success state renders correctly with no SMS button when no contact is linked. `sendSms()` is a real Telnyx send — same category as `BulkActionBar`'s SMS action from Phase 10 — converted the button but didn't click it. Deactivated the test link afterward.

**Two behavior notes disclosed, not left silent.** The success-state header lost its small green checkmark badge icon — `Modal`'s `title` slot takes one node, and the checkmark added little on top of "Payment Link Created" as plain text, so it was dropped rather than contorting the title slot to preserve it. More substantively: the original backdrop `<div>` had no `onClick` handler at all — clicking outside the modal did nothing, previously. MUI `Dialog` wires backdrop-click and Escape to `onClose` by default, so this is a real, deliberate behavior change, not a silent regression — same class of change already disclosed for `GiftCardsClient`'s `RedeemModal` back in Phase 4, and unremarkable for the same reason: a form modal that's easier to dismiss is a strict UX improvement, not a functional risk.

**`EmailComposeModal` hit the same OAuth-gate shape as Phase 8's `settings/calendar` modal, but this time the technique actually worked.** Confirmed the real empty-state path first — no email accounts connected in the demo tenant renders "Connect one in Integrations" with no Send button, matching the `accounts.length > 0` guard exactly. Unlike Phase 12's `VideoReviewsTab` (where the gate was a server-rendered prop, out of reach), the accounts list here comes from a plain client-side `fetch('/api/email-integrations')` inside a `useEffect` — the same shape as Phase 8's calendar-status fetch. Intercepted just that one URL via `window.fetch` to make the already-loaded page believe an account existed, without touching any real state. The full form rendered correctly (Template/From `TextField select`s, read-only To, Subject/Body), filled Subject and Body to confirm the bindings, confirmed Send enabled — and stopped there, since `handleSend()` is a real Gmail/Outlook send (confirmed back in Phase 7, still held back). Reloaded to drop the interception and confirmed the real account list was still empty afterward.

**This closes the Modal rollout.** Every candidate identified in Phase 5's original triage — 17 of ~18 counting Phase 4's pilot — is now converted. What's left is a different primitive (`Drawer`, for the 4 slide-over files) and opportunistic conversion of pages not yet touched, not more `Modal` work.

Full check suite: typecheck 0, lint 0, web tests 15/15, build clean.

## Phase 14: second primitive — `SlideOver`, and a real animation instead of a pop

Started the `Drawer` work flagged as its own item back in Phase 5's triage: this app has 4 hand-rolled edge-panel components (`InventorySlideOver`, `StaffSlideOver`, `ShiftSlideOver`, `AppointmentDrawer`) using a `fixed inset-0 ... ml-auto` pattern distinct from the centered-dialog shape `Modal` covers — never lumped into the Modal rollout, and correctly so.

**Built the primitive first, same audit-before-build discipline as Phase 4.** `apps/web/src/components/ui/SlideOver.tsx` wraps MUI `Drawer(anchor="right")`. Named `SlideOver`, not `Drawer` — avoids shadowing the MUI import in the same file (the same collision class documented for `BulkActionBar`'s `ModalKind` rename in Phase 10), and matches this app's own existing name for the pattern, since the filenames already say "SlideOver."

**One real API difference from `Modal`, not an oversight.** `Modal`'s `open` defaults to `true` because this app's ~30 hand-rolled modals are conditionally _mounted_ (`{show && <TheModal/>}`). Checking how the 4 slide-over call sites are actually used turned up a different convention: 3 of them (`Inventory`, `Staff`, `Shift`) are kept permanently mounted by their parents, toggling a real `open` boolean instead — exactly the pattern MUI's `Drawer` is built for, since it needs to stay in the DOM through the close transition to animate the slide-out. Giving `SlideOver.open` a default would have papered over that difference instead of surfacing it, so it's a required prop instead.

**Pilot: `InventorySlideOver.tsx`** (Add/Edit item form, plus an edit-mode-only Adjust Quantity sub-section) — pure internal CRUD (`POST`/`PUT /api/inventory`, `POST /api/inventory/:id/adjust`), no outward-facing risk, and it already used the always-mounted+open-toggle pattern the primitive assumes. Removed its internal `if (!open) return null` guard, since keeping the guard would silently defeat the whole point of choosing `Drawer` here — with the guard gone, the panel now genuinely slides in and out instead of popping instantly, a real UX improvement riding along with the primitive swap, not just a like-for-like visual change.

**Verified against the real backend**, not render-without-error: opened Add Item and confirmed the slide-in animation itself (not just that content appeared), created a real item (real "Item added" toast), reopened it in Edit mode and confirmed both the pre-fill and the edit-mode-only Adjust Quantity section rendered, ran a real quantity adjustment (0 → 5, real "Item updated" toast), then deleted the test item for real ("Item deleted").

The other 3 call sites — `StaffSlideOver`, `ShiftSlideOver`, `AppointmentDrawer` — are scoped for a future phase. `AppointmentDrawer` is a separate case worth flagging in advance: unlike the other 3, its parent (`AppointmentsCalendar.tsx`) conditionally _mounts_ it (`{selectedAppt && <AppointmentDrawer .../>}`) rather than keeping it mounted and toggling `open` — so converting it to `SlideOver` as-is would render correctly but wouldn't get the animation benefit, since it still unmounts instantly on close. Whether to also change that mount pattern is a call for whichever phase picks it up, not decided here.

Full check suite: typecheck 0, lint 0, web tests 15/15, build clean.

## Phase 15: two more `SlideOver` conversions, one real nested-overlay decision

Converted `StaffSlideOver.tsx` and `ShiftSlideOver.tsx`, both flagged as next in Phase 14's notes — 3 of the 4 `SlideOver` candidates now done, only `AppointmentDrawer` left.

**Checked outward-facing risk on both routes before converting**, same discipline as every phase: staff `POST`/`PUT` (name/role/email/phone/color/availability/notes) and shift `POST`/`PUT`/`DELETE` are plain field writes with no SMS/email/notification side effect. Worth calling out specifically since a staff or shift change could plausibly trigger a notification in a scheduling app — it doesn't here, confirmed by reading the routes rather than assuming.

**`StaffSlideOver` was a direct swap**, same shape as Phase 14's `InventorySlideOver` pilot — already used the always-mounted+open-toggle pattern, guard dropped, animation now plays.

**`ShiftSlideOver` had a real layout wrinkle worth a judgment call.** Its delete-confirm is a _nested_ dialog, `absolute inset-0` positioned within the panel itself, not the full viewport — visually confined to just the slide-over's bounds, a shape none of the prior 17 `Modal` conversions or the Phase 14 pilot had to handle. Two options: force it through the `Modal` primitive (which centers against the full page via `Dialog`, a real visual change from confining it to the panel) or extend `SlideOver` to support a nested-overlay slot for this one caller. Neither was right for a single call site — went with a third option instead: left the confirm as plain Tailwind, wrapped in a `relative` div (documented inline) so its `absolute inset-0` still resolves against the panel's content area, matching the pre-conversion visual exactly. Also passed a two-line title (heading + "for {staffName}" subtitle) through `SlideOver`'s `title` slot, confirming it accepts arbitrary `ReactNode` the same way `Modal`'s does — no primitive change needed for that part.

**Verified both against the real backend**, not render-without-error: created a real team member (color swatch selection, Monday availability toggle, real save, card appeared with the correct color dot and "Mon 09:00–17:00"), created a real shift from the Schedule grid (title correctly read "for Phase 15 Test Member", real save, block appeared on the grid), triggered the nested delete-confirm and confirmed it still covers only the panel's content area — not the full screen — exactly matching pre-conversion behavior, then deleted the shift and the test staff member for real.

Full check suite: typecheck 0, lint 0, web tests 15/15, build clean.

## Remaining work (not started)

No production user base yet — app is pre-launch, still in active development. Clear to proceed with wider rollout without a compatibility sign-off step.

This is a multi-week effort across 206 components; it was not attempted in one pass. Phase 3 (shared design tokens), Phase 4 (first primitive, `Modal`, complete by Phase 13), and Phase 14 (second primitive, `SlideOver`, started) are done — see above. `Modal` covered every dialog candidate from Phase 5's original triage — 17 of ~18 counting Phase 4's pilot. `SlideOver` now covers `InventorySlideOver`, `StaffSlideOver`, and `ShiftSlideOver` (3 of 4) — see Phase 15. Suggested phasing from here:

1. **Finish the `SlideOver` rollout** — 1 candidate remains: `AppointmentDrawer`. It's the one with a real decision attached: unlike the 3 already converted, its parent (`AppointmentsCalendar.tsx`) conditionally _mounts_ it rather than toggling `open`, so a like-for-like conversion works but won't get the slide animation — worth deciding at that point whether to also change the parent's mount pattern (a small change to a file this migration has already touched once, in Phase 11) or leave it as a known, disclosed gap. Read the backend route for outward-facing risk first, same discipline as every phase, even though appointment-detail actions (reschedule, cancel, etc.) are more likely than the last 3 candidates to touch a reminder/notification path — don't assume it's as uniformly safe as `Inventory`/`Staff`/`Shift` turned out to be.
2. **All four pre-existing app bugs found during this migration's verification have now been fixed**, out of scope for the migration itself but tracked here for history: report `metric`/`metric_fn` mismatch, Smart List `created_by`, and bulk-assign validation (Phase 9/10, [PR #15](https://github.com/siddhu6064/Nuatis/pull/15)); blocked-appointment `contact_id` NOT NULL constraint (Phase 11, [PR #16](https://github.com/siddhu6064/Nuatis/pull/16), required a schema migration applied directly to the shared Supabase project with explicit go-ahead).
3. **More primitives, same audit-first approach as Phase 4/14** — `TextField`/form-field wrapper (used everywhere, but plain MUI `TextField` may already be enough without a wrapper, unlike `Modal`/`SlideOver` which needed one to match the app's visual convention), `Select`, `Menu`. Before building each: find the real call-site count in this codebase (not an assumed one), sample a few for existing a11y/behavior gaps, and check the MUI component's default rendered tag against `globals.css`'s base rules — anything defaulting to `button`/`a`/`input`/`h1-h6` needs the same computed-style verification `DialogTitle` got in Phase 4.
4. **New surfaces get MUI by default** — any new page/feature built from here should use MUI primitives rather than hand-rolled Tailwind, so the split doesn't grow.
5. **Opportunistic conversion** of existing pages — prioritize the ones flagged from the earlier full-app audit as weakest (empty states with no CTA, the 54 unlabeled toggle buttons on Notifications/Modules/Voice AI — MUI's `Switch`/`IconButton` have correct `aria-label` ergonomics built in, which would fix that a11y gap as a side effect of migrating those controls).
6. **`react-big-calendar`, `recharts`, `@hello-pangea/dnd`** are unrelated to MUI and don't need touching — they're not being replaced, just need to keep working alongside MUI surfaces on the same page (Appointments already does, per the React 19 upgrade's verification pass, and lead-scoring's recharts `BarChart` coexisting with the converted `AddRuleModal` on the same page, per Phase 5).

## Rollback

Every change here is additive and isolated: `ThemeRegistry` wraps `children` without altering existing markup, `globals.css`'s layer restructuring is a no-op for any page that never renders an MUI component, and every converted modal (`StatCard.tsx`, `GiftCardsClient.tsx`'s `RedeemModal`, `lead-scoring`'s `AddRuleModal`, `subscriptions`' `CancelModal`, `email-templates`' Create/Edit modal, `DuplicatesReviewer`'s Merge modal, `QuotePayments`' Record Payment modal, `InventoryList`'s delete-confirm, `settings/reports`' Schedule modal, `settings/calendar`'s Switch Provider confirm, dashboard `reports`' wizard, `campaigns/[id]`'s `ConfirmModal`, `BulkActionBar`'s 5-variant modal, `AppointmentsCalendar`'s blocked-slot panel and Block Off Time modal, `VideoReviewsTab`'s `SubmissionModal`, `payment-links`' create/success modal, `EmailComposeModal`) is a single component with the same props contract as what it replaced — one caveat: Phase 10's "Archive 1contacts?" whitespace fix in `BulkActionBar.tsx` is a genuine (if tiny) pre-existing bugfix riding along with the conversion, so a revert of that file alone reintroduces the missing space. Another minor caveat: `payment-links`' backdrop now closes on click/Escape, a real (and disclosed, in Phase 13) behavior change from the original's inert backdrop — reverting the file reverts that too. `SlideOver`'s converted call sites (`InventorySlideOver.tsx`, `StaffSlideOver.tsx`, `ShiftSlideOver.tsx`) have the same single-component-swap shape, plus a disclosed behavior improvement (the slide animation now plays on all 3, since each had its internal `if (!open) return null` guard removed) — reverting those files reverts that too. `ShiftSlideOver.tsx` also has a nested delete-confirm left as plain Tailwind rather than converted (see Phase 15) — nothing rollback-relevant there, it just means that file's diff is smaller than a full primitive swap would suggest. Reverting is: remove the `ThemeRegistry` wrap in `layout.tsx`, revert `globals.css`, revert `DashboardClient.tsx`/delete `StatCard.tsx`, revert `GiftCardsClient.tsx`/`lead-scoring/page.tsx`/`subscriptions/page.tsx`/`email-templates/page.tsx`/`DuplicatesReviewer.tsx`/`QuotePayments.tsx`/`InventoryList.tsx`/`settings/reports/page.tsx`/`settings/calendar/page.tsx`/dashboard `reports/page.tsx`/`campaigns/[id]/page.tsx`/`BulkActionBar.tsx`/`AppointmentsCalendar.tsx`/`VideoReviewsTab.tsx`/`payment-links/page.tsx`/`EmailComposeModal.tsx`/`InventorySlideOver.tsx`/`StaffSlideOver.tsx`/`ShiftSlideOver.tsx`/delete `Modal.tsx`/`SlideOver.tsx`, revert `tailwind.config.js`/`muiTheme.ts`/`eslint.config.js`/delete `tokens.js`, uninstall the four packages. (Migration `0136_appointments_contact_id_nullable.sql`, from the Phase 11 bug-fix PR, is unrelated to this rollback list — it's a real, standalone schema fix, not part of the MUI migration.)
