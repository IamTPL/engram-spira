# Tooling, CI, config and the docs pipeline

Bun workspaces monorepo (`apps/*`, `packages/*`). No bundler config beyond Vite for `apps/web`, no task runner beyond `bun run --filter`, and **no linter, formatter or git hook anywhere** — no eslint/prettier/biome/oxlint/husky/lefthook/`.editorconfig` file exists, `.git/hooks` holds only `*.sample`, and `core.hooksPath` is unset.

Formatting is convention only: 2-space indent, single quotes, semicolons, trailing commas in multiline literals. Match it by eye. Do not add lint/format tooling as a drive-by change — if asked to add one, add the config, the script **and** the CI step together.

| Tool | Version |
|---|---|
| Bun | 1.3.10 |
| Node | v22.22.2 |
| TypeScript | 5.9.3 (single resolved version) |
| Docker | 29.0.1 |
| `bun.lock` | lockfileVersion 1 |

There is no `engines` field and no `.bun-version` — the README's "Bun ≥ 1.3" is unenforced.

## Root scripts (all 16)

| Script | Actually runs | Notes |
|---|---|---|
| `dev:api` | `--filter @engram/api dev` → `bun run --watch src/index.ts` | port 3001 |
| `dev:web` | `--filter @engram/web dev` → `vite` | port 3002 |
| `dev` | `--filter '*' dev` | starts **three** watchers: api, web **and the browser-extension bundler** |
| `typecheck` | api `tsc --noEmit` **&&** web `tsc --noEmit` | the only CI gate; **currently fails** |
| `db:generate` / `db:migrate` / `db:push` / `db:drop` | `drizzle-kit <cmd>` in apps/api | need `apps/api/.env` |
| `db:reset` | `drizzle-kit drop && drizzle-kit push` | **destructive and misnamed** — see [database.md](database.md) |
| `db:seed` | `bun run src/db/seed.ts` | idempotent |
| `db:studio` | `drizzle-kit studio` | |
| `docs:c4` | `docker compose --profile docs up structurizr` | Structurizr Lite on :8080 |
| `docs:export` | `bun run scripts/docs-export.ts` | **Docker required** |
| `docs:erd` | `bun run scripts/erd-export.ts` | **network required**, no Docker |
| `docs:sync` | `bun run scripts/docs-sync.ts` | |
| `skills:update` | `bun run scripts/skills-update.ts` | Hashes `.agents/skills/*` into `skills-lock.json` — see below |

Add new root-level tasks as a `bun run` script delegating with `--filter @engram/<pkg>`; never document a bare `cd apps/x && …` as the canonical entry point.

`--filter '*'` never selects the root package, so no recursion — but it *does* select `packages/browser-extension`, which is why `bun run dev` spawns three watchers. If you add a workspace script named `dev`, root `bun run dev` will start it too.

Per-workspace: `apps/api` has 12 scripts (7 `db:*` + `dev`, `typecheck`, `test`, `test:coverage`, `test:watch`); `apps/web` has 4 (`dev`, `build`, `preview`, `typecheck` — **no `test`**); `packages/browser-extension` has `build` and `dev`; `packages/shared` has none.

### Odd root dependencies — the truth

- **`three@^0.183.2` and `three-stdlib@^2.36.1` are genuinely used** — but by exactly one file, `apps/web/src/components/focus/dodecahedron-dice.tsx:2-3`. `apps/web/package.json` does not declare them; the import resolves only via workspace hoisting. `@types/three` is likewise a root devDependency. Latent breakage — if you touch that file, move all three into `apps/web/package.json`.
- **`web@^0.0.2` is unused dead weight** — an unrelated 2012 Node HTTP library, zero import sites. Almost certainly a mistyped `bun add`. Safe to remove.

## CI — exactly what is and is not enforced

`.github/workflows/ci.yml` is the whole CI surface. `.github/` contains no other file — no CODEOWNERS, dependabot config, issue templates.

```
on: push [main, master], pull_request
job typecheck (ubuntu-latest):
  actions/checkout@v4
  oven-sh/setup-bun@v2   (bun-version: latest — UNPINNED)
  bun install --frozen-lockfile
  bun run typecheck
```

**Enforced:** `tsc --noEmit` for `@engram/api` and `@engram/web`; lockfile integrity.

**NOT enforced:** unit tests · `vite build` · lint · format · migration validity · typechecking of `scripts/`, `packages/shared` or `packages/browser-extension` (neither has a `typecheck` script) · extension build · dependency caching · concurrency cancellation.

A green CI badge means "two tsconfigs compiled", nothing more. And `bun-version: latest` means CI silently drifts with new Bun releases — it can break with no repo change.

**Current status: red.** See [known-issues.md](known-issues.md). Note `bun run build` for `apps/web` still succeeds (~11 s) because **Vite does not typecheck**.

Both tsconfigs include their test files, so a type error in a test breaks the only gate. Removing the root `bun-types` hoist would break the web typecheck, since `apps/web/tsconfig.json` sets `types: ['vite/client']` only and `bun:test` resolves via that hoist.

## Environment variables

Every knob across all workspaces. See [api-conventions.md](api-conventions.md) for the four-places rule when adding one.

| Variable | Default | Read by | Failure mode when wrong |
|---|---|---|---|
| `DATABASE_URL` | none — **the only required var** | `config/env.ts:2` | throws at import time, before Elysia or the logger exist → raw stack trace. **Presence only** is validated, so the API boots against a dead DB and floods `CONNECT_TIMEOUT localhost:5435` |
| `PORT` | `3001` | `config/env.ts:3` | — |
| `NODE_ENV` | `'development'` | many | must be exactly `'production'` to get the CORS allowlist and a `Secure` cookie. `'prod'`, `'staging'`, unset → permissive branch |
| `FRONTEND_URL` | `http://localhost:3002` | `shared/email.ts` | broken verification / reset links |
| `ALLOWED_ORIGINS` | `['http://localhost:3002']` | `index.ts:130` | in production, forgetting it silently rejects the real frontend origin |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | `''` | `shared/email.ts` | lazy plain `Error` at first send → opaque 500; feedback still returns `{success:true}` |
| `FEEDBACK_RECIPIENT` | a hardcoded personal address | `config/env.ts:18` | feedback goes to the wrong inbox |
| `GEMINI_API_KEY` | `''` | `config/ai.ts`, `embedding.service.ts` | lazy throw deep in a fire-and-forget path, logged as a warn |
| `GEMINI_MODEL` | `gemini-3-flash-preview` | `ai.service.ts` | — |
| `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-001` | `embedding.service.ts` | **must return 768 dims** or every vector write fails the `vector(768)` cast |
| `LOG_LEVEL` | `'debug'` dev / `'info'` prod | `shared/logger.ts:20` — **not in `ENV`** | — |
| `AVATARS_DIR` | resolves into `apps/web/public/ava_colect` | `users.service.ts:16` — **not in `ENV`, not in `.env.example`** | `GET /users/avatars` silently returns `{avatars: []}` |
| `SESSION_MAX_AGE_DAYS` | `30` | **nothing — dead key** | changing it does nothing; the live value is `SESSION.MAX_AGE_MS` |
| `SESSION_REFRESH_THRESHOLD_DAYS` | `15` | **nothing — dead key** | as above |
| `VITE_API_URL` | `http://localhost:3001` | `apps/web/src/api/client.ts:4` | the frontend talks to the wrong API |

`apps/api/.env.example` documents 11 variables; `apps/web/.env.example` documents `VITE_API_URL`.

> **`apps/api/.env.example:17` sets `GEMINI_EMBEDDING_MODEL=gemini-embedding-2-preview`, contradicting the code default `gemini-embedding-001`.** Copying the example — which the README tells you to do — silently switches models. Fix the example file; do not quote it as truth.

## Docker

```yaml
db:           pgvector/pgvector:pg15   5435:5432   flashcard_db   postgres/postgrespassword
              container flashcard_db_container, restart unless-stopped, volume flashcard_db_data
structurizr:  structurizr/lite         8080:8080   profiles: [docs]   mounts ./docs/c4
```

`docker compose up -d` starts **only `db`**. Structurizr lives behind the `docs` profile and starts only via `bun run docs:c4`. Point `DATABASE_URL` at **5435**, not 5432 — 5432 is the in-container port.

There are **no Dockerfiles anywhere** in the repo. Nothing sets `TZ`, which the streak/day-boundary math depends on (`TZ=UTC`).

## The docs pipeline

| Command | Input | Output | External requirement |
|---|---|---|---|
| `docs:sync` | `docs/srs/srs.md` (hard-coded `FILES` array) | `apps/web/public/docs/srs/srs.md` | none |
| `docs:export` | `docs/c4/workspace.dsl` | `apps/web/public/docs/c4/{01_context,02_container,03_component_api,04_component_spa}.svg` | **Docker** (`structurizr/cli`, `plantuml/plantuml:latest`, `alpine`) + network on first pull |
| `docs:erd` | `docs/erd/erd.mmd` | `docs/erd/erd.svg` → `apps/web/public/docs/erd/erd.svg` | **outbound HTTPS to kroki.io**, no Docker |
| `docs:c4` | `docs/c4/` (bind mount) | interactive Structurizr Lite on :8080 | Docker |

All generated artifacts under `apps/web/public/docs/` plus `docs/erd/erd.svg` are **committed**, and `apps/web/src/pages/docs.tsx` fetches them by fixed path.

Rules:

- **Regenerate diagrams through the scripts; never hand-edit an SVG.** Editing `workspace.dsl` or `erd.mmd` without re-running the exporter leaves the committed SVG stale and the in-app Docs page serving the old one.
- `docs:sync` copies **exactly one file**. A new doc that must be readable from the running app has to be added to the `FILES` array in `scripts/docs-sync.ts:20-27`.
- `docs/srs/srs.md` and its `public/` copy are currently byte-identical — any factual fix must be followed by `bun run docs:sync`.
- `docs:export` exits 1 unless all four SVGs land. It iterates **only** the keys of `SVG_MAP` (`scripts/docs-export.ts:33-38,75`), so a view absent from that map is never even looked at — adding a fifth view to `workspace.dsl` will not export it until you update the map. The `console.warn` skips (lines 79, 99) fire for a *mapped* view whose `.puml`/`.svg` is missing on disk. It also creates root-owned files in `docs/c4/.export_tmp`, which is why cleanup shells out to an `alpine` container.
- Keep `workspace.dsl` and `erd.mmd` in step when you add a module or a table. Both are already behind (15 modules / 16 tables; `dismissed_suggestions` missing).

`scripts/tsconfig.json` is **orphaned** — nothing references it, no command typechecks `scripts/`, and its `paths` mappings for `postgres`/`drizzle-orm` are vestigial (today's `erd-export.ts` imports neither). Type errors in the scripts are discovered only at runtime.

## `.gitignore` — consequences for authored docs

~68 lines. The notable entries:

| Line | Pattern | Effect |
|---|---|---|
| 64 | `/skills` | **root-anchored** — ignores only `<repo-root>/skills` (the vendored `ui-ux-pro-max` clone). Does **not** touch `.agents/skills/`, `.claude/skills/`, or `docs/skills/` |
| 65 | `docs/superpowers` | ignores that subtree (its 2 existing files stay tracked — gitignore is not retroactive) |
| 66 | `.gitnexus` | — |
| 67 | `.codegraph` | the local CodeGraph index |
| 69 | `**/.superpowers` | superpowers session state at any depth |

Until this pattern was narrowed from a bare `skills` (no leading slash) to `/skills`, it ignored *any* path segment named `skills` at any depth — which is why `.agents/skills/` was invisible to git for a period and its content had to be re-authored from scratch after being deleted. **Do not widen it back.** `.agents/skills/` is now the intended home for project skill packs (see below); the root `/skills` vendored clone is the only thing meant to stay ignored.

**Rule: never place authored documentation under the root `skills/` directory or under `docs/superpowers/`.** Safe homes: root `CLAUDE.md`/`AGENTS.md`, `docs/agents/`, `docs/<topic>/`, `.agents/workflows/`, `.agents/skills/`. Always confirm with `git check-ignore -v <path>` first.

Also: `dist/` and `build/` are directory-only patterns, so `git check-ignore apps/api/dist` reports "not ignored" purely because that directory does not exist yet — do not conclude api build output is tracked.

## Agent tooling surface — partly broken

- **`.agents/workflows/engram_workflow.md`** (99 lines) — a gated skill router with 4 task routes, a Gate Protocol, a Review Protocol and 6 Hard Gates. It mandates three domain skill packs: `solid-js-best-practices`, `elysiajs` (both present under `.agents/skills/`) and `supabase-postgres-best-practices` (still missing — `.agents/skills/*` was wiped in commit `73d1efd`; only the first two have been re-authored so far).
- **`skills-lock.json`** pins each installed skill's sha256 hash. `scripts/skills-update.ts` (`bun run skills:update`) walks `SKILLS_DIR = '.agents/skills'`, hashes each `<name>/SKILL.md` directory, and **merges** the result into the lock: it reads the existing JSON first, then only `lockData.skills[name] = {...}` for names it finds on disk — it never deletes an entry whose directory is missing. Two consequences: (1) editing a skill and forgetting to re-run the script leaves a stale hash — the lock is not auto-verified anywhere, so nothing catches this; (2) a skill removed from disk leaves a **permanently dangling entry**, since nothing ever deletes a lock key. This is exactly how the lock ended up with entries for skills that no longer exist on disk (`enhance-prompt`, `design-md`, `supabase-postgres-best-practices`, `brainstorming`, `systematic-debugging`, `writing-plans`, `executing-plans`) — their source directories were removed at some point and the lock was never hand-pruned to match. Don't treat a `skills-lock.json` entry as proof a skill exists; check `.agents/skills/<name>/` on disk instead. `source`/`sourceType` per entry are read from literal `source:`/`sourceType:` lines anywhere in the skill's `SKILL.md` (regex match), or default to the synthetic `"<name>/skills"` + `"github"` placeholder if absent — this is **not** a real fetch URL, just bookkeeping metadata.
- **`.claude/settings.local.json`** — the only Claude config in-repo: a single `skillOverrides: { graphify: "off" }`. No hooks, no permission allowlist, no committed `settings.json`.
- **`skills/ui-ux-pro-max`** at the repo root is a *different*, gitignored, vendored clone — unrelated to `.agents/skills/`. It does **not** carry its own `.git` (verified: `test -d skills/.git` fails), so it is inert vendored content, not a nested repository.

## `packages/shared` — shared with nobody

`package.json` points `main`/`types` straight at `src/index.ts` (no build step). It exports 7 const objects (`REVIEW_ACTIONS`, `FIELD_TYPES`, `FIELD_SIDES`, `PASSWORD`, `SYSTEM_TEMPLATES`, `NOTIFICATIONS`, `LINK_TYPES`) and 4 derived types.

**Nothing imports it.** `@engram/shared` appears only in its own two files and in `bun.lock`'s workspace map; no app declares it as a dependency; `node_modules/@engram/` is an **empty directory**. An `import { PASSWORD } from '@engram/shared'` would not resolve today — you would first have to add `"@engram/shared": "workspace:*"` to the consuming package and re-run `bun install`.

The claim in `docs/dev_prompt/project_report.md` §18 that editing these constants propagates to both tiers is **false**. The real duplicates live in `apps/api/src/shared/constants.ts` and `apps/web/src/constants/index.ts`.

## `packages/browser-extension`

Manifest V3, no bundler config — the entire build is:

```
bun build src/popup.ts src/content.ts src/background.ts --outdir=dist --target=browser --minify
```

(`dev` swaps `--minify` for `--watch`.) Only devDependency: `@types/chrome`. Storage keys: `engram_api_url`, `engram_deck_id` in `chrome.storage.local`.

**It is wired to the real API** — `popup.ts` calls `GET /health` and `GET /folders`; `background.ts` calls `POST /ai/generate` then `POST /ai/jobs/:jobId/save`. All four endpoints exist.

**But it cannot run today:**

1. `manifest.json` references `icons/icon16.png`, `icon48.png`, `icon128.png` — **no `icons/` directory exists**, so Chrome refuses to load the unpacked extension.
2. `popup.ts:125` calls `chrome.scripting.executeScript` while the manifest requests only `["contextMenus","storage","activeTab"]` — the **`scripting` permission is missing**.
3. `dist/` is gitignored while `manifest.json` and `popup.html` reference `dist/*.js` — a fresh clone must build first.
4. Requests use `credentials: 'include'` from a `chrome-extension://` origin, but the API's CORS allowlist is `ALLOWED_ORIGINS` plus `/^http:\/\/localhost:\d+$/` — **extension origins are never allowed**.
5. `host_permissions` is hardcoded to `http://localhost:3001/*`, so the popup's "connect to any API URL" field only works locally.

## Generated artifacts that are committed

`apps/web/public/docs/c4/{01_context,02_container,03_component_api,04_component_spa}.svg` · `apps/web/public/docs/erd/erd.svg` · `apps/web/public/docs/srs/srs.md` · `docs/erd/erd.svg` (336 KB of valid SVG — despite occasional claims that it is empty).
