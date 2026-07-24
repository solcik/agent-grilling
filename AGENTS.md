# agent-grilling — architecture & build spec

`CLAUDE.md` is a symlink to this file.

**grill** is a local, always-on **agent-question inbox**. Any agent — in any project, any
harness — posts a *round*: a batch of questions, each a set of options with a recommended
pick, optionally carrying markdown / image / HTML context. The human answers every pending
round from **one browser panel** that lists them side by side. It replaces the slow "post a
message, wait for a reply" decision loop with a click-through UI.

## Non-negotiables

- **Nix-agnostic *product*.** The published npm package is a normal, MIT, `node`-run CLI that
  knows nothing about Nix. The repo does carry dev/ops files (`devenv.nix`, `.github/`,
  `Dockerfile`), but the `files` allowlist ships only `dist` + `bin`, so none of them reach the
  npm tarball. Primary distribution stays a thin Nix wrapper (fetch tarball, wrap the bin behind
  `nodejs_26`, run `grill serve` as a `systemd` user daemon) — the pattern used for
  `chrome-devtools-mcp` / `playwright-mcp`; the in-repo `Dockerfile` is a secondary vector.
- **Effect v4 + Effect Schema, everywhere.** `effect@4.0.0-beta.97` (barrel imports:
  `import { Schema, Effect } from 'effect'`; pinned to match Foldkit's peer dep). One Schema
  contract (`src/domain/contract.ts`) is shared by server, CLI, and UI. Decode is fail-loud at
  every boundary.
- **CLI only — no MCP.** Agents drive it with a small CLI that has real `--help` and worked
  examples on every subcommand.
- **Dark mode by default.**

## Stack

| Layer     | Choice                                                                            |
| --------- | --------------------------------------------------------------------------------- |
| Contracts | Effect **Schema** (`src/domain/contract.ts`)                                       |
| Server    | Effect **HttpApi** (`effect/unstable/httpapi`) with derived **OpenAPI**; serves the SPA |
| CLI       | Effect CLI over an `HttpApiClient` built from the same contract                    |
| Frontend  | **Foldkit** (`foldkit@0.131`, Elm architecture — Model *is* a Schema) + `@foldkit/devtools`, Vite 8 + Tailwind 4 |
| Rich text | **`@foldkit/markdown`** (build-time); runtime agent markdown via a small Foldkit-`Html` fold |
| Runtime   | **Node 26** (the shipped runtime); **bun** as the dev package manager — *not* the runtime |
| Types     | **TypeScript 7** (`tsc` + native `tsgo`); **`@effect/tsgo`** + **`@effect/language-service`** for Effect-aware diagnostics + editor LSP |
| Lint/fmt  | **oxlint** (type-aware, via `oxlint-tsgolint`) + **oxfmt** (configured to the Effect no-semi / single-quote style) |
| Tests     | **Vitest** + **`@effect/vitest`** (`it.effect`)                                    |
| Dev env   | **devenv** (`devenv.nix` + `.envrc`) → bun + `nodejs_26` + `typescript-go`         |

Pinned references (read these — they are ground truth at the revision in use):
- Effect v4 usage, HttpApi, Schema: `~/dev/vs-point/finvestor/finvestor-front/develop`
  (imports `Schema` from `'effect'`, HttpApi from `'effect/unstable/http'`), and the Effect
  source at `~/dev/ref/github/effect`.
- Foldkit framework, examples, markdown, vite-plugin: `~/dev/ref/github/foldkit/foldkit/main`
  (see `examples/form`, `examples/todo`, `packages/markdown`, `packages/typing-game/server`
  for an Effect HttpApi server in the same ecosystem).
- **The working UX prototype to port** (zero-dep Node, proves the inbox, dark-by-default,
  options-with-recommended, Accept-all-recommended, per-session isolation): `prototype/` in
  this repo (`node prototype/serve.mjs`) — reproduce its look and behavior in Foldkit; do not
  ship its Node server.

## Development

Toolchain comes from `devenv.nix` (via `.envrc` / direnv): **bun**, **Node 26**, **tsgo**.
`direnv allow` once, or run any command through `direnv exec . <cmd>`. Package manager is bun;
tests run via **vitest** (not `bun test`).

| Command | What |
| --- | --- |
| `bun install` | install deps (writes `bun.lock`) |
| `bun run dev` | Vite dev server for the SPA |
| `bun run typecheck` | `tsc --noEmit` (TypeScript 7) |
| `bun run check:effect` | `effect-tsgo diagnostics` — Effect-aware warnings/suggestions |
| `bun run lint` / `lint:fix` | oxlint (type-aware) |
| `bun run format` / `format:check` | oxfmt |
| `bun run test` | Vitest (+ `@effect/vitest`) |
| `bun run build` | `tsc` server/CLI → `dist` + `vite build` SPA |

CI (`.github/workflows/ci.yml`) runs the full gate on push/PR and builds the Docker image;
`release.yml` publishes to npm on a `v*` tag (needs the `NPM_TOKEN` secret).

> bun drops the exec bit on `@effect/tsgo`'s prebuilt platform binary; the devenv `enterShell`
> and the CI both restore it (`chmod +x node_modules/@effect/tsgo-*/lib/tsc`).

## The one binary: `grill`

Subcommands (each with `--help` + examples):

- `grill serve` — start the HttpApi server + serve the built Foldkit SPA. Env: `GRILL_PORT`
  (default 4100), `GRILL_HOST` (127.0.0.1), `GRILL_STATE` (state dir). Localhost-only, no auth.
- `grill ask` — post a round and **block** until the human answers, then print the answer
  JSON and exit 0. `--round <file>` (a `.ts`/`.json` round) or convenience flags for the
  simple case; `--session <task>` (project auto-derived); `--attach <img>` (uploads, see
  attachments); `--timeout <dur>` (default 30m). On timeout: exit non-zero printing a ticket.
- `grill await <session> [roundId]` — re-block for an answer (resume after a timeout; the
  round persists server-side, so a long human delay never drops the questions).
- `grill sessions` — print the inbox (debug). `grill reset <session>` — clear a session.

Agents run `grill ask` backgrounded and are re-invoked on exit. `grill ask` + `grill await`
together are the "blocking with resumable ticket" semantics.

## HTTP API (Effect HttpApi, OpenAPI-derived)

- `GET  /api/sessions` → `Inbox` (pending first).
- `GET  /api/round?session=<id>` → `Round` (404 if none).
- `POST /api/round` → `Round` body → persisted for its session. This is how `grill ask` posts;
  the CLI is a pure `HttpApiClient` and never touches `GRILL_STATE` — the server solely owns it.
- `POST /api/answer` → `Answer` body → persisted; validated against the contract.
- `GET  /api/answer?session=<id>` → last `Answer` (debug).
- `POST /api/attachments` (multipart) → `{ id }`; `GET /attachments/<id>` serves it.
- `GET  /api/health`, `GET /openapi.json` (+ a docs UI), `GET /` → the SPA.

Sessions are namespaced **`<project>/<task>`** — `project` auto-derived from the git remote /
cwd by the CLI (pure git, no Nix), `task` supplied by the agent. State lives under
`GRILL_STATE` (per-session subdirs). The filesystem is the message bus; the server holds no
in-memory state, so it survives restarts and parallel sessions never collide (the isolation
key is the session, same shape as a per-world mock store).

## Rich content rendering

Context blocks (`src/domain/contract.ts`) attach at three levels — round, question, and
per-option `preview`:
- `markdown` → `@foldkit/markdown`.
- `image` → `<img>`; `src` is an inline `data:` URI or `/attachments/<id>`.
- `html` → a **sandboxed** iframe (no access to the panel DOM). The agent is trusted and the
  server is localhost-only, but sandbox anyway.

Per-option `preview` is the comparison affordance: show two mockups, pick one.

## Distribution (NOT in this repo — documented here for context)

A Nix wrapper (in the user's `~/nixos`) will: `packages/grill.nix` fetch the published tarball
and wrap `grill` behind `nodejs_26`; `systemd.user.services.grill` run `grill serve` always-on;
add a shared block in `agent-bodies.nix` so every agent learns to reach for `grill` instead of
blocking in chat. None of that belongs here.

The in-repo **`Dockerfile`** is a secondary vector (for non-Nix hosts): `docker build -t grill .`
then `docker run -p 4100:4100 -v grill-state:/state grill` runs `grill serve` under Node 26
(`GRILL_HOST=0.0.0.0`, state on the `/state` volume).

## Layout (target)

```
src/
  domain/contract.ts   # the Schema contract (DONE — the anchor; build around it)
  server/              # grill serve: HttpApi, handlers, static SPA, OpenAPI
  cli/                 # grill ask/await/sessions/reset over an HttpApiClient
  ui/                  # the Foldkit app (Model=Schema, update, view) → built by Vite
bin/grill              # CLI entry
```

## Build order (first slice)

1. Project scaffold (Foldkit + Effect v4 + Vite 8 + Tailwind 4, per the `examples/form`
   shape), preserving `src/domain/contract.ts`.
2. `grill serve`: HttpApi with `sessions` / `round` / `answer` / `health` + static SPA + OpenAPI.
3. `grill ask` + `grill serve` CLI; then `await` / `sessions` / `reset`.
4. Foldkit UI: the inbox (sidebar of pending sessions) + a round view (options, recommended
   pre-selected, Accept-all-recommended, Other/Notes), dark-by-default with a light toggle —
   ported from the prototype.
5. Rich content (markdown/image/html + per-option preview) and attachments upload.
6. Tests (Vitest): contract round-trips, server handlers, CLI.

Effect API details (exact `Schema.optional` / `Schema.Record` / HttpApi builder spellings) must
be verified against the pinned Effect source, not guessed.
