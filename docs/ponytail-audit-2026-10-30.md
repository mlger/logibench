# Ponytail-style repo audit — 2026-10-30

*Format per `AGENTS.md` (Ponytail 5): map the code, rank findings, fix-first.
Companion to `docs/tooling-analysis-impeccable-ponytail-context7-ocr.md`.
State audited: commit `3975f1f` + the week-1 tooling work in flight.*

## How the code moves

- **UI entry:** `src/app/page.tsx` → `AppShell` (tabs: Bench / Reference /
  K-map / Inventory) → `BreadboardCanvas` + `Inspector` + `BottomPanel`.
- **State:** `store/projectStore.ts` (Zustand, undo ≤ 50) → pure engine in
  `lib/logibench/*` (netlist → sim → ERC; kmap lab separate).
- **Persistence:** `app/api/projects/*` → Prisma/SQLite (`SavedProject.data`
  opaque JSON, schema v2 via `migrate.ts`). Inventory CRUD mirrors this.
- **Trust boundaries:** the four API route files — the only place untrusted
  JSON enters.

## Findings, ranked

| # | Rank | Finding | Status |
|---|---|---|---|
| 1 | **MUST FIX** | API POST/PATCH bodies trusted by hand: `Number(body.qty)` → `NaN` accepted → Prisma throws → 500. Inventory + projects routes. | **Fixed** — zod schemas at all four route files, coercing bounded fields, unknown keys stripped, 400 on violation |
| 2 | **MUST FIX** | `String(e)` returned to clients on every catch — leaks Prisma/engine internals. | **Fixed** — generic `Internal error` + `console.error`; Prisma P2025 → 404 |
| 3 | **SHOULD FIX** | `GET /api/inventory` unbounded list query; no search. | **Fixed** — `take: 500` ceiling + optional `?q=` contains-filter (client unchanged); pagination deferred — a personal parts bin doesn't need it yet |
| 4 | **SHOULD FIX** | Risky engine logic had no durable check — the 7490 cascaded-edge bug survived because audits lived in `~/.cache` and died with sessions. | **Fixed** — `scripts/audit/labs-regression.ts` + `lab3-two-board.ts` committed; `bun run audit` gates (decade sweep + decode + cross-board nets + migration round-trip) |
| 5 | **SHOULD FIX** | Prisma client logs every SQL statement in all environments (`log: ['query']`). | **Fixed** — dev-only |
| 6 | **SHOULD FIX** | UI contrast: `stone-400` text on white (2.6:1), white-on-`amber-600` button, `amber-500` badge with white text — all WCAG AA failures per the impeccable scan. | **Fixed** — `stone-500`, `amber-700`, `stone-900`-on-amber; rendered scan went 50 → 28 findings, zero contrast |
| 7 | **NICE TO HAVE** | Three components >1,000 lines (`BreadboardCanvas` 1,051, `KMapTab` 1,021, `ReferenceTab` 873) mix concerns. | **Open (accepted)** — they work, their coupling is intrinsic to canvas/map rendering, and a split is a risky refactor with no current bug behind it. Revisit when a feature next touches one of them |
| 8 | **NICE TO HAVE** | Sub-11px palette micro-labels (9px chip captions, 10px "ref" badges). | **Open (documented)** — deliberate density exceptions, see `DESIGN.md` |

## Verdict

Fix #1 first — it was the only finding reachable by any unauthenticated
request with a malformed body (every POST with `qty: "abc"` 500'd). #2 rides
along. #3–#6 are closed in the same week-1 pass; #7–#8 are recorded debt with
revisit conditions, not work items.

## What I did not check

Real load (single-user app; the `take: 500` cap is the only guard), auth
(none exists — by design, local tool), and the Prisma-generated client types
against zod coercion edge cases beyond the audit run.
