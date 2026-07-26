# Agent documentation

On-demand reference for coding agents working on **engram-spira**. The always-loaded rules live in [`../../AGENTS.md`](../../AGENTS.md); everything here is deep detail you read only when your task touches the area.

## Verify, do not trust

Every file here was written against the code at commit `73d1efd` and carries file:line citations so you can check it. **When a doc disagrees with the code, the code wins** — fix the doc in the same change that discovers the drift.

Never re-derive a count from prose. `AGENTS.md` §1 lists the shell command that proves each one.

## Files

| File | Read it when |
|---|---|
| [orientation.md](orientation.md) | You are new to the repo: monorepo map, request lifecycle end to end, verified inventory |
| [api-conventions.md](api-conventions.md) | Adding or changing an API module — the module recipe, error contract, auth, rate limits, logging |
| [endpoints.md](endpoints.md) | You need an endpoint's exact method, path, auth, validation and response shape |
| [database.md](database.md) | Touching the schema, writing a migration, or working with pgvector |
| [srs-study.md](srs-study.md) | Anything about scheduling: SM-2, FSRS, reviews, streaks, forecast, retention |
| [ai-search.md](ai-search.md) | Gemini card generation, the job queue, embeddings, semantic search, duplicate detection, knowledge graph |
| [experience-bff.md](experience-bff.md) | The `experience` aggregate layer behind the command center |
| [frontend.md](frontend.md) | Any `apps/web` work: SolidJS rules, app shell, stores, query keys, design tokens |
| [testing.md](testing.md) | Writing or fixing a test; understanding the mocking strategy |
| [tooling-ci.md](tooling-ci.md) | Scripts, CI, environment variables, Docker, the docs pipeline, the browser extension |
| [known-issues.md](known-issues.md) | Before you assume a failure is yours, and before you "fix" something pre-existing |

## Documents that will mislead you

Kept for history, and because the in-app `/docs` page serves some of them. **Never cite these as specification.**

| Path | Status | Why |
|---|---|---|
| `README.md` | STALE | 15 modules, 16 tables, 198 tests, 12 pages, wrong embedding model — all incorrect |
| `docs/srs/srs.md` | STALE | SM-2 only (FSRS ships), wrong Gemini models, wrong endpoint paths, no `experience` scope, claims Resend email (it is Nodemailer/Gmail) |
| `docs/project_report.md` | STALE | 16 tables, 15 modules, 198 tests, 51 commits, "CI guarantees zero type errors" (CI is red) |
| `docs/dev_prompt/*` (12 files) | HISTORICAL | Superseded plans and audits. Contains **paste-ready code with the wrong embedding model** (`text-embedding-004`; the code uses `gemini-embedding-001`), and prose putting the vector column on the wrong table (`feature_roadmap_plan.md:264` says `card_concepts` — it actually lives on `card_field_values`). Never copy from here |
| `docs/ui/design.md` | STALE | Entire palette, radius and shadow tables predate the June 2026 shadcn/zinc rewrite. `apps/web/src/app.css` is the only source of truth |
| `docs/c4/workspace.dsl` | STALE | "15 feature modules", "16 table schemas", no `experience`, invents `/analytics` and `/search` routes that do not exist |
| `docs/erd/erd.mmd` + `erd.svg` | STALE | 17 entities (schema has 18 — `dismissed_suggestions` missing); `study_daily_logs` columns are wrong |
| `docs/superpowers/**` | HISTORICAL | Design spec and plan for the shipped command center. Several documented limits were **not** implemented as written — see [experience-bff.md](experience-bff.md). Every checkbox is still unchecked even for work that shipped; use `git log` for progress |

Regenerating the diagrams (`bun run docs:export`, `bun run docs:erd`) requires Docker and network respectively — see [tooling-ci.md](tooling-ci.md).
