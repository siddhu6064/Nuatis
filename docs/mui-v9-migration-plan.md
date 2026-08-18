# MUI v9 migration plan

Branch: `chore/mui-v9-migration`. Status as of this document: **Phases 1-9 complete and verified** (foundation, pilot, shared design tokens, first shared primitive, primitive rollout in progress — 11 of ~18 modals converted). Phase 10+ is scoped but not started — see "Remaining work" below.

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

## Files added/changed (Phase 1-9)

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

## Remaining work (not started)

No production user base yet — app is pre-launch, still in active development. Clear to proceed with wider rollout without a compatibility sign-off step.

This is a multi-week effort across 206 components; it was not attempted in one pass. Phase 3 (shared design tokens) and Phase 4 (first primitive, `Modal`) are done — see above. Phases 5-9 converted 10 more of the real dialog candidates found in Phase 5's triage (`lead-scoring`, `subscriptions`, `email-templates`, `DuplicatesReviewer`, `QuotePayments`, `InventoryList`, `settings/reports`, `settings/calendar`, dashboard `reports`, `campaigns/[id]`) — 11 of ~18 total converted, counting Phase 4's pilot. Suggested phasing from here:

1. **Continue the `Modal` rollout** — ~6 real dialog candidates remain (`appointments/AppointmentsCalendar.tsx`, `reputation/VideoReviewsTab.tsx`, `contacts/BulkActionBar.tsx`, plus a couple not yet individually triaged). Two are explicitly held back on outward-facing side effects and need an explicit go-ahead: `quotes/payment-links` (live SMS) and `contacts/EmailComposeModal.tsx` (real Gmail/Outlook send, confirmed in Phase 7). `contacts/BulkActionBar.tsx` is worth flagging specifically before converting — it has a `bulk-sms` endpoint alongside its other bulk actions (tag/assign/archive/export), so it likely needs the same held-back treatment for at least one of its actions, not a blanket defer or a blanket convert. `reputation/VideoReviewsTab.tsx` needs synthesized video-submission data before it can be verified live, same class of gap as Phase 6/7's synthesized test data. Each remaining conversion should keep following the established pattern: read the backend route before assuming risk level rather than pattern-matching on scary-looking words (Phase 7's `QuotePayments` had a "stripe" option that turned out to be pure record-keeping; Phase 8 confirmed `settings/calendar`'s risk was real, not assumed; Phase 9 hit a real, billed AI-generation call correctly blocked by the auto-mode classifier), real backend verification over render-without-error, a check for whether the modal has test data to exercise it against (Phase 6 synthesized a duplicate pair; Phase 7 used a quote's public accept endpoint; Phase 8 intercepted a fetch response when a modal's own precondition blocked the natural path to it; Phase 9 hit two independent pre-existing bugs that made live verification genuinely unreachable and fell back to structural inspection against already-verified sibling modals), and double-checking any `sx` color token actually exists in the theme rather than assuming a plausible-looking path resolves (Phase 8's `primary.50` typechecked fine while being silently wrong).
2. **Two pre-existing app bugs found during Phase 9's verification, out of scope for this migration but worth fixing separately:** (a) `apps/web/src/app/(dashboard)/reports/page.tsx`'s `handleSaveReport()` sends `metric_fn` in its `POST /api/reports` body; `apps/api/src/routes/reports.ts` validates a field named `metric` and never receives it — every report save fails. (b) `apps/api/src/routes/smart-lists.ts`'s `POST /` inserts `created_by: authed.userId` instead of `authed.appUserId ?? null` (the pattern every other route uses) — `authed.userId` is empty in at least this session type, and the `uuid` column rejects the empty string, so every Smart List creation 500s.
3. **More primitives, same audit-first approach as Phase 4** — `TextField`/form-field wrapper (used everywhere, but plain MUI `TextField` may already be enough without a wrapper, unlike `Modal` which needed one to match the app's visual convention), `Select`, `Menu`. Before building each: find the real call-site count in this codebase (not an assumed one), sample a few for existing a11y/behavior gaps, and check the MUI component's default rendered tag against `globals.css`'s base rules — anything defaulting to `button`/`a`/`input`/`h1-h6` needs the same computed-style verification `DialogTitle` got in Phase 4.
4. **`Drawer` for the slide-over panels** — Phase 5's triage found 4 files (`InventorySlideOver`, `StaffSlideOver`, `ShiftSlideOver`, `AppointmentDrawer`) using the same `fixed inset-0`-adjacent overlay CSS as the modals but sliding in from an edge, not centered. That's MUI `Drawer`'s use case, not `Dialog`'s — a separate primitive, not a variant of `Modal`.
5. **New surfaces get MUI by default** — any new page/feature built from here should use MUI primitives rather than hand-rolled Tailwind, so the split doesn't grow.
6. **Opportunistic conversion** of existing pages — prioritize the ones flagged from the earlier full-app audit as weakest (empty states with no CTA, the 54 unlabeled toggle buttons on Notifications/Modules/Voice AI — MUI's `Switch`/`IconButton` have correct `aria-label` ergonomics built in, which would fix that a11y gap as a side effect of migrating those controls).
7. **`react-big-calendar`, `recharts`, `@hello-pangea/dnd`** are unrelated to MUI and don't need touching — they're not being replaced, just need to keep working alongside MUI surfaces on the same page (Appointments already does, per the React 19 upgrade's verification pass, and lead-scoring's recharts `BarChart` coexisting with the converted `AddRuleModal` on the same page, per Phase 5).

## Rollback

Every change here is additive and isolated: `ThemeRegistry` wraps `children` without altering existing markup, `globals.css`'s layer restructuring is a no-op for any page that never renders an MUI component, and every converted modal (`StatCard.tsx`, `GiftCardsClient.tsx`'s `RedeemModal`, `lead-scoring`'s `AddRuleModal`, `subscriptions`' `CancelModal`, `email-templates`' Create/Edit modal, `DuplicatesReviewer`'s Merge modal, `QuotePayments`' Record Payment modal, `InventoryList`'s delete-confirm, `settings/reports`' Schedule modal, `settings/calendar`'s Switch Provider confirm, dashboard `reports`' wizard, `campaigns/[id]`'s `ConfirmModal`) is a single component with the same props contract as what it replaced. Reverting is: remove the `ThemeRegistry` wrap in `layout.tsx`, revert `globals.css`, revert `DashboardClient.tsx`/delete `StatCard.tsx`, revert `GiftCardsClient.tsx`/`lead-scoring/page.tsx`/`subscriptions/page.tsx`/`email-templates/page.tsx`/`DuplicatesReviewer.tsx`/`QuotePayments.tsx`/`InventoryList.tsx`/`settings/reports/page.tsx`/`settings/calendar/page.tsx`/dashboard `reports/page.tsx`/`campaigns/[id]/page.tsx`/delete `Modal.tsx`, revert `tailwind.config.js`/`muiTheme.ts`/`eslint.config.js`/delete `tokens.js`, uninstall the four packages.
