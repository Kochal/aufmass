# UI design system and surface decisions

**Date:** 2026-06-28  
**Area:** ui  
**Status:** decided and implemented

---

## What I assumed and why

**Design system: shadcn/ui on Tailwind v4.**

Assumption: an unopinionated component library (you own the copied source)
beats a design-system-as-dependency for a product this specialised. shadcn/ui
gives a solid a11y and keyboard baseline, Tailwind v4 removes the config-file
overhead, and both are stable and understood by Claude Code for future
maintenance. The alternative (hand-building from scratch) has no advantage for
the first version; the alternative (a prescriptive library like MUI or Ant) locks
in visual conventions that will fight the trade-specific UX.

Confidence: high. What would invalidate it: if the component library proves
brittle to customise for the field surface (very large tap targets, one-hand
use), we'd consider a lightweight mobile-first alternative for the field surface
only — but the same design tokens and auth plumbing would remain.

**Three surfaces, one design system.**

The brief: a single design system with three tuned surfaces. Not three separate
codebases. The shadcn components live in `web/src/components/ui/` and are
shared. The surfaces live in `web/src/surfaces/{office,field,dashboard}/` and
own their own layout and interaction density. CSS design tokens (see below) carry
the "tuning" across surfaces.

**Tailwind v4 specifics:**

- No `tailwind.config.ts` — config lives in `src/index.css` via `@theme inline`.
- No PostCSS config — `@tailwindcss/vite` handles processing in Vite.
- Custom utilities: `confidence-high`, `confidence-mid`, `confidence-low` (and
  their `-bg` / `-fg` variants) are defined in `@theme inline` and are accessible
  as `bg-confidence-high`, `text-confidence-mid-fg`, etc.
- `tw-animate-css` is imported in `index.css` to provide `animate-in/out`,
  `fade-in-0`, `zoom-in-95` etc. for Dialog, Command, and Tooltip animations.

**Confidence/trust colour bands.**

The central visual language: a coloured band tells the reviewer where attention
is needed without a number to decode. Defined once in `index.css`, used on every
review surface (office quote matching now, Aufmaß crop-verify later).

  `confidence-high`  (#oklch green)  ≥ 0.85 match_confidence, or 'confirmed'
  `confidence-mid`   (#oklch amber)  0.60 – 0.84
  `confidence-low`   (#oklch red)    < 0.60, unmatched, or no score

Implemented as `border-l-4` on review cards in `PositionCard.tsx`.

**Routing: react-router-dom v7 (library mode)**

BrowserRouter + Routes + Route. Framework mode (Remix-style) is explicitly not
used — this is a plain SPA served by Vite. v7's library mode is backward-
compatible with v6 conventions.

**Server state: @tanstack/react-query v5**

queryFn throws on error (via the `unwrap()` helper in `lib/api.ts`). 30 s
stale time keeps data fresh without hammering the API on navigation. The 409
(stale row_version) case is handled in mutation onError: invalidate queries +
toast so the reviewer sees fresh data and a clear message.

**API client: openapi-fetch + openapi-typescript (already in repo)**

`openapi-typescript` v7 generates `web/src/api/schema.ts` (run `npm run
gen:api` against the live API). `openapi-fetch` creates a typed runtime client
over those types. The auth middleware in `lib/api.ts` injects `x-tenant-id` /
`x-user-id` headers on every request — the single swap-in point for Entra SSO.

Note: Decimal fields come back from the API as `string | null` in the generated
types (not `number`), because FastAPI serialises Python Decimal as a JSON
string. The `formatEuro()`, `formatMenge()`, and `parseDecimal()` helpers in
`lib/utils.ts` handle the string→number conversion for display. The frontend
never computes a money value, it only formats what the backend committed.

**Dev auth seam**

The backend's `get_principal()` (in `api/app/deps.py`) reads `X-Tenant-Id` and
`X-User-Id` headers in dev mode. `AuthContext.tsx` persists these to
localStorage; `lib/api.ts`'s auth middleware reads them for every request.
`DevLogin.tsx` is the UI — a clearly-badged dev-only screen with UUID entry and
role selection. The `Principal` shape (`tenantId`, `userId`, `role`,
`displayName`) is stable; real Entra SSO (directive 09) replaces the login screen
and calls `login(principal)` on success; nothing else changes.

---

## Surface decisions

### Office quote-matching review (`/office/angebote/:id/review`)

The screen that earns the product. Built on existing endpoints — no backend
changes in this phase. Key interaction decisions:

- **Two-pane per position** (source left, match right). Not a table. A table
  hides the langtext and check flags that reviewers need to confirm fast.
- **Risk-first ordering**: unmatched → review+low-confidence → hard-fail flags
  → review → soft flags → auto → confirmed. The reviewer's eye goes straight
  to where work remains.
- **Confidence as a band, not a number**. `PositionCard.tsx` renders a `border-l-4`
  in the appropriate confidence colour. Match_confidence % is shown but small.
- **Keyboard shortcuts** (`usePositionKeyboard.ts`): j/k, a/Enter, c, x.
  Goal: clear a 200-position LV without the mouse.
- **Catalog picker as command palette** (`CatalogPicker.tsx`): opens on 'c',
  full-text client-side search, shows code + kurztext + Einheitspreis.
  Swap-in point: replace the flat list with ranked candidates when the vector
  matching feed (directive 06) is live.
- **TotalsFooter** shows engine-computed figures only (never derived in the
  frontend), with berechnen → prüfen → ausstellen buttons in mandatory order.
  Hard-fail check_results disable Ausstellen with a clear explanation.

### Field Aufmaß capture — DEFERRED

The backend endpoints over the `aufmass` / `aufmass_entry` tables do not exist.
The extraction GPU pipeline is not yet stable. Building UI against a guessed API
shape would be premature. The app shell reserves the Monteur nav slot and the
`/field` route; `FieldStub.tsx` explains the deferral. See directive 07 and the
aufmass notes for status.

### Owner dashboard — DEFERRED

`DashboardStub.tsx`. Follow-up phase.

---

## What would invalidate these decisions

- **shadcn/ui unsatisfactory for field surface**: reconsider the component
  library for `surfaces/field/` only. Design tokens and auth plumbing survive.
- **Tailwind v4 breaking change in minor version**: pin explicitly in package.json.
- **Entra SSO introduced**: replace `DevLogin.tsx` + `persistAuth/clearAuth` in
  `lib/api.ts`. `AuthContext`'s `Principal` shape and the nav RBAC checks stay.
- **Vector matching feed live**: replace `CatalogPicker`'s flat leistung list
  with a ranked candidate list. The `onSelect` callback interface is unchanged.
