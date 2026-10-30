# SuryaDesk Frontend View Contract (for view builders)

You are building view components for **SuryaDesk**, a multi-tenant solar after-sales
service SaaS. The app is a **single-route SPA**: everything renders inside
`src/app/page.tsx`. You must **ONLY create the view files assigned to you**.
Do NOT modify any other file, do NOT create API routes, do NOT create pages,
do NOT add dependencies, do NOT run the dev server or lint.

## Read these files FIRST (they are your contracts)

1. `src/components/suryadesk/shared/bits.tsx` — shared UI (SuryaLogo, StatusPill,
   PriorityPill, KpiCard, PageHeader, EmptyState, LoadingBlock, SkeletonRows,
   SdAvatar, SectionCard, DemoBadge, TableShell). USE these; do not rebuild them.
2. `src/lib/surya/client.ts` — `api(path, {method, json})`, `useApi<T>(path)` →
   `{ data, loading, error, refresh, setData }`, `qs({...})` builder, `ApiError`.
3. `src/lib/surya/store.ts` — zustand store `useSd()`; use `setView("customers")`
   etc. to navigate. Views: dashboard, customers, installations, amc, warranties,
   requests, jobs, maintenance, technicians, analytics, reports, notifications,
   settings, team, ai, tech:*, portal:*.
4. `src/lib/surya/types.ts` — `fmtDate, fmtDateTime, fmtTime, relativeDay,
   initials, inr, parseJson, STATUS_LABELS, REQUEST_CATEGORY_LABELS, STATUS_TONES,
   SessionUser`.
5. `src/components/suryadesk/app-shell.tsx` — style reference for tone/spacing.
6. `src/app/globals.css` — design tokens.

## Design system (MANDATORY)

- Warm light claymorphic theme. Page background is `bg-sd-cream` (already provided
  by the shell — do not add another page background).
- Cards: `className="sd-clay"` (raised clay card). Smaller: `sd-clay-sm`.
  Hover lift on clickable cards: `sd-clay sd-clay-raise`. Inset surfaces
  (inputs, wells): `sd-inset`. Primary button: `sd-btn-primary`.
- Colors (Tailwind tokens): `text-sd-ink` #1E2925, `text-sd-ink-soft` #747E77,
  `text-sd-forest` #176B52, `text-sd-forest-deep`, `text-sd-amber` #F2B84B,
  `bg-sd-surface` #EEF2ED, `bg-sd-inset`, `border-sd-line` #E4EAE5,
  `text-sd-success`, `text-sd-error`, `text-sd-info`.
- NO indigo/blue theme colors (sd-info exists only for small "info" accents).
- Status chips: `<StatusPill status="IN_PROGRESS" />` (never hand-roll status colors).
- Spacing scale 4/8; card padding `p-4 sm:p-5` or `p-5`; page uses the shell's
  `p-4 sm:p-6 lg:p-8` — your root is a plain `<div>` (or fragment).
- Long lists: `max-h-96 overflow-y-auto sd-scroll` (or taller, e.g. max-h-[28rem]).
- Tables: wrap in `<TableShell>`; `<table className="w-full text-sm">` with
  `text-left px-4 py-3 text-sd-ink-soft font-medium text-xs uppercase tracking-wide`
  headers and `border-t border-sd-line/70` rows.
- Forms: label + input pattern: inputs use `className="sd-inset px-3.5 py-2.5 text-sm
  text-sd-ink placeholder:text-sd-ink-soft/60 focus:outline-none focus:ring-2
  focus:ring-sd-forest/40 w-full"`. Prefer shadcn `Select` for dropdowns,
  `Dialog` for modals, `Tabs` for tab strips (all in `@/components/ui/*`).
- Icons: `lucide-react`. Buttons with only icons need `aria-label`.
- Responsive: mobile-first (`grid-cols-1 sm:grid-cols-2 xl:grid-cols-4` etc.).
  Tables may scroll horizontally inside TableShell — never cause page overflow.
- Framer Motion: subtle only (fade/slide on mount, `layoutId` pills). Respect
  reduced motion (already handled globally).
- Toasts: `import { toast } from "@/hooks/use-toast";`
  success: `toast({ title: "…", description: "…" })`;
  failure: `toast({ variant: "destructive", title: "…", description: msg })`.
- Every number/list MUST come from the API. Never hardcode stats or fake rows.
  All fetch states handled: loading → `SkeletonRows` / `LoadingBlock`;
  error → inline error card with retry; empty → `EmptyState`.
- All view files are `"use client"` components with a **default export** and
  TypeScript props typed. No `any` unless unavoidable (use `unknown` + casts).

## Global API behaviors

- `api()` throws `ApiError` with `.message` on failure — catch and toast
  `variant: "destructive"`.
- Attachment images: `<img src={"/api/attachments/" + id} … />` (cookie-authenticated;
  never public URLs). Always include descriptive `alt`.
- Dates arrive as ISO strings — use `fmtDate`/`fmtDateTime`/`relativeDay`.
- JSON string columns (e.g. `includedServices`, `checklistJson`, `photosJson`,
  `skills`) — parse with `parseJson(x, [])`.
- Pagination: APIs return `{ total, page, pageSize, … }`. Build simple
  prev/next pagination (shadcn `Button` variants), showing "x–y of z".
- Search inputs debounce ~300ms (or filter on Enter).
