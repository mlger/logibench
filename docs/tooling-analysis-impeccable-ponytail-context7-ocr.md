# Tooling analysis — Impeccable, Ponytail, Context7, OpenCodeReview

*Analysis only (no implementation). Sources: each project's README, fetched 2026-10-30.
Grounding data: `wc -l` over `src/`, repo state at commit `f99a967`.*

---

## TL;DR

| Tool | One-liner | Role for logibench | Effort | Risk |
|---|---|---|---|---|
| [Context7](https://github.com/upstash/context7) | Version-correct library docs injected into the agent | **Prevention** — stop outdated-API bugs at the source | `npx ctx7 setup`, ~5 min | ~zero |
| [Impeccable](https://github.com/pbakaus/impeccable) | Design vocabulary + deterministic "AI slop" detector | **UI polish** — scan/gate the TSX surfaces, pin our design system | `npx impeccable detect`, zero install for scans | low |
| [Ponytail](https://github.com/DietrichGebert/ponytail) | "Lazy senior dev" skill: minimal code, reuse-first, tests on risky logic | **Discipline** — leaner features, per-commit diff review, ranked repo audit | copy `SKILL.md`/`AGENTS.md` or plugin | low |
| [OpenCodeReview](https://github.com/alibaba/open-code-review) | Deterministic-engineering × agent code-review CLI (`ocr`) | **Independent review gate** — diffs before push, `ocr scan` of the API layer | `npm i -g`, needs an LLM endpoint key | medium (config) |

**Recommended order:** Context7 → Impeccable detect (today, zero config) → Ponytail audit + fix top findings → OpenCodeReview once an endpoint key exists. Optionally add the repo's **first GitHub Action** running `impeccable detect --github` + lint.

---

## Why these four, for *this* repo

The codebase's recent history shows three concrete failure classes:

1. **Interrupted-session drift** — Demo 3 shipped without its header button (`f99a967` fixed it). A reviewer that reads *files the change touches* (not just the diff) would have caught it.
2. **Logic bugs surviving to demo** — the 7490 cascaded-edge bug (`f99a967`) was invisible to lint and only surfaced because a throwaway audit script was written ad hoc. Engine paths have **no durable verification gate**.
3. **Organic growth** — `BreadboardCanvas.tsx` 1,051 lines, `KMapTab.tsx` 1,021, `ReferenceTab.tsx` 873; API routes validate by hand (`Number(body.qty ?? 1)` → `NaN` → 500; `String(e)` leaked to clients); **no CI at all** (`.github/workflows` missing).

Each tool targets exactly one of these classes.

---

## 1. Context7 — current docs for a bleeding-edge stack

**What it is.** Upstash's skill/MCP server that pulls *up-to-date, version-specific* docs and code examples into the agent's context. Two modes: **CLI + Skills** (`npx ctx7 setup` → installs a skill driving the `ctx7` CLI; needs Node ≥ 22.13) or **MCP** (server URL `https://mcp.context7.com/mcp`). Free API key at context7.com/dashboard raises rate limits.

**Why it fits.** Our stack is exactly the kind that makes training data stale:

| Concern | Drift risk in logibench |
|---|---|
| Next.js **16** App Router | route-handler signatures, `next.config.ts`, proxy/cacheComponents changes vs Next 13/14 habits |
| Tailwind **4** | CSS-first `@theme` (we use `@theme inline` in `globals.css`) vs old `tailwind.config.js` patterns |
| Prisma **6** + SQLite | singleton client, `db:push` workflows, transaction API |
| shadcn/ui New York, Zustand 5, TanStack Query v5 | component APIs, `create<T>()` patterns, `useQuery` v5 breaking changes |

**How to use it here.**
- Install: `npx ctx7 setup` (CLI+Skills mode), then just append **"use context7"** to any library task, or pin the ID for speed: `use library /vercel/next.js`, `/prisma/prisma`, `/tailwindlabs/tailwindcss`.
- Highest-value moments: adding API routes, editing `globals.css` theme tokens, wiring TanStack Query, Prisma schema changes.
- Prompt habits that matter: mention the **version** ("Next.js 16 proxy…") so Context7 matches the right docs.

**Expected payoff.** Fewer hallucinated/outdated APIs during feature work; zero code churn. It changes *inputs to the agent*, not the repo — cheapest of the four.

---

## 2. Impeccable — design review + slop detection for our TSX surfaces

**What it is.** pbakaus' design vocabulary for coding agents: 24 commands (`critique`, `audit`, `polish`, `harden`, `typeset`, …), `PRODUCT.md`/`DESIGN.md` context files (`/impeccable init`, `/impeccable document`), plus a **deterministic 62-rule slop detector** — no LLM, no API key:

```bash
npx impeccable detect src/                    # pattern rules on TSX/JSX
npx impeccable detect http://localhost:3000   # rendered-page rules (contrast, tiny text)
npx impeccable detect --github src/           # GitHub Actions annotations
npx impeccable detect --list-rules            # see all rules
```

Exit 2 = findings. Per-file opt-out via comment; global ignores via `ignores add-value`.

**Why it fits.** The UI *is* the product (bench, K-map lab, reference, inventory). Our stone/amber system is deliberate but exists only in plans and code — no `DESIGN.md` contract. And with **zero CI**, the detector CLI is the cheapest possible quality gate. The rendered-page scan covers what static rules can't: contrast and tiny text on the real rendered app (e.g., the 7 px `5161AS · CC` label and 10–11 px chip captions on the canvas).

**How to use it here.**
1. **Today, zero install:** run `detect src/` and `detect http://localhost:3000` (dev server) → triage findings into fix / ignore-with-reason (our canvas-art exceptions).
2. **Contract:** `/impeccable init` → `PRODUCT.md` ("LogicBench PH — breadboard planning lab for EE students; engine + ERC run fully client-side"); `/impeccable document` → `DESIGN.md` (stone/amber, shadcn New York, monospace hole labels, no indigo/blue rule). Every later command reads these.
3. **Targeted passes** (narrow targets beat whole-page sweeps):
   - `critique the Inspector panel` · `audit the K-map lab` · `harden InventoryTab` (empty/error states) · `polish` before a release.
4. **CI:** a first workflow — lint + `impeccable detect --github src/` — would simultaneously close the "no CI" gap.

**Caveats.** It is tuned for HTML/CSS surfaces; the breadboard canvas is custom SVG and deliberately "busy" (10-hole rows, rail art). Expect detector noise there → handle with scoped ignores and documented reasons, not rule-wide disables.

---

## 3. Ponytail — the reuse-first ladder, diff review, ranked audit

**What it is.** A single-prompt skill (`skills/ponytail/SKILL.md`, or `AGENTS.md` for rules-file agents; Claude Code plugin via marketplace). Core ideas:

- **The ladder before writing code:** 1 does this need to exist → 2 already in this codebase? → 3 standard library → 4 platform feature → 5 installed dependency → 6 one line → 7 only then, the minimum that works.
- **Never cut** validation, error handling, security, accessibility.
- **`/ponytail-review`** — reviews the change *and the code it touches* (bugs, security, real load, risky code without tests, what to cut), each finding: what it does / what goes wrong / the fix / cost of skipping.
- **`/ponytail-audit`** — same checks repo-wide, ranked, fix-first ordering.

**Why it fits.**
- The ladder targets real spots here: hand-rolled API validation where a tiny schema check belongs; components >1,000 lines that mix concerns; places a platform primitive already exists.
- `/ponytail-review`'s "read the code the change touches" is the **direct antidote to failure class 1** (Demo 3: `demo.ts` changed; an untouched-file review reads `AppShell.tsx` → finds no entry point).
- `/ponytail-audit`'s "risky logic without tests" is the direct antidote to class 2 — for us, the honest equivalent is promoting our **audit scripts from `~/.cache` (ephemeral) to a reproducible `bun run audit`** (the 7490 cascade bug would then be caught forever, not once).

**How to use it here.**
1. Install as skill/`AGENTS.md`; run `/ponytail-audit` once → expect a ranking like: (1) API input validation & error leaks, (2) engine paths without durable audits, (3) canvas/store coupling. Fix in that order.
2. Run `/ponytail-review` before each commit (fits the conventional-commit rhythm already in place).
3. Adopt the ladder as the default for new features (shadcn-first — mostly already our habit).

**Caveats.** Don't let it golf the engine: `geometry.ts`/`sim.ts`/`erc.ts` length is intrinsic (datasheet-derived tables, per-rule ERC checks). Its test emphasis maps to our *audit-script* convention rather than a test framework, per project rules.

---

## 4. OpenCodeReview — an independent, deterministic review gate

**What it is.** Alibaba's `ocr` CLI (internal tool open-sourced; npm `@alibaba-group/open-code-review`, git ≥ 2.41). Reads git diffs → deterministic engineering does the hard constraints (exact file selection, smart bundling, rule matching, comment positioning/reflection) → an agent with a tuned toolset produces line-precise comments. `ocr review` for diffs (staged / uncommitted / branch / PR), `ocr scan` for whole files/directories. Benchmark: higher precision & F1 than a general agent, ~⅑ tokens; recall deliberately lower (precision over noise).

**Why it fits.** We are a **single-developer, direct-to-`main` repo** — no PRs, no second reader. Failure class 1 and 2 both slipped through because nothing independent looks at a change. `ocr` adds that second pair of eyes with unusually stable file/line attribution, and `ocr scan src/app/api` would likely flag exactly the hand-rolled validation (`Number(body.qty ?? 1)` → NaN → 500; `String(e)` → error-string leak) and the unpaginated `GET /api/inventory`.

**How to use it here.**
1. `npm install -g @alibaba-group/open-code-review`; configure a model endpoint (OpenAI-compatible; any available LLM key works — this is the one tool that *needs* credentials).
2. Workflow: `ocr review` on staged changes as a **pre-push gate**; `ocr scan` on the API layer once now.
3. If the repo ever moves to PR flow, its GitHub Actions mode reviews PRs natively.

**Caveats.** Token cost per review; quality tracks the endpoint model; precision-over-recall means pair it with `/ponytail-review` (opposite bias) rather than replacing one with the other.

---

## How the four compose — a pipeline, not a pick-one

```
  Context7            Ponytail             Ponytail/OCR                Impeccable
  ────────            ────────             ────────────                ──────────
  correct APIs   →    minimal, reuse-  →   self-review +           →   UI critique/audit,
  in (prevent         first code           independent diff            detect gate in CI,
  hallucination)      (ladder)             gate (verify)               DESIGN.md contract
                      │                    │                           │
                      └── durable `bun run audit` for engine logic ────┘
```

- **Prevent** (Context7): right facts in, before code exists.
- **Write lean** (Ponytail): ladder + reuse-first while coding.
- **Verify** (Ponytail `/ponytail-review`, then OCR `ocr review`): two different biases on every diff; durable audit scripts as the regression net for engine logic.
- **Polish & guard** (Impeccable): detector in the repo's first CI workflow; `critique`/`harden`/`polish` per surface before releases.

## Concrete first week (if adopted)

| Day | Action | Closes |
|---|---|---|
| 1 | `npx ctx7 setup`; add "use context7" habit to feature prompts | drift-risk going forward |
| 1 | `npx impeccable detect src/` + `detect http://localhost:3000`; triage | today's UI debt |
| 2 | Install Ponytail skill; `/ponytail-audit`; write findings into an issue-list | repo-wide ranking |
| 2–3 | Fix audit top-3 (input validation, error leaks, pagination) | real defects |
| 3 | Promote audit scripts → `bun run audit` target | engine regression net |
| 4 | First GitHub Action: lint + `impeccable detect --github src/` | no-CI gap |
| 5 | Configure `ocr` endpoint; `ocr review` as pre-push gate | independent review |

*What this document deliberately does NOT do: install or run any of these tools. Each row above is a separate, reviewable change.*
