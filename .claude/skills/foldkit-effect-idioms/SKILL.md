---
name: foldkit-effect-idioms
description: Where to find idiomatic Foldkit and Effect v4 patterns for the grill (agent-grilling) codebase, plus the house rules for both. Points at foldkit.dev, the pinned ref source trees, the `effect` skill, and the open refactor issues. Use whenever writing or refactoring any src/ code in this repo toward idiomatic Foldkit/Effect — UI, server, CLI, or contract.
---

# Foldkit + Effect idioms (for building & refactoring grill)

grill is **Effect v4 (beta)** + **Foldkit** (Elm architecture). Both are pre-1.0 and **NOT in
model training data** — never write their APIs from memory. Read the ground truth below first, then
apply the house rules.

## Where to look — ground truth

### Effect v4
- **The `effect` skill** — load it first for idiomatic Effect (core defaults + branch refs for
  Schema / Services+Layers / Config / Scheduling / Caching / Streams / HTTP clients / Testing).
- **Pinned source**: `~/dev/ref/github/effect/effect/main/packages/effect/src/` — real signatures.
  HttpApi server: `…/unstable/httpapi/`; low-level http: `…/unstable/http/`; Schema: `…/schema/`.
  Exact call shapes: `…/packages/effect/typetest/`. HttpApi+OpenAPI server example:
  `…/ai-docs/src/51_http-server/`.
- **Real-world v4 usage**: `~/dev/vs-point/finvestor/finvestor-front/develop/src/effect/` and its
  `@effect/vitest` (`it.effect`) tests.
- Pin: `effect@4.0.0-beta.97` — held there by Foldkit's peer dep; do not bump it alone.

### Foldkit
- **Docs — canonical patterns (foldkit.dev):**
  - Core: `/core/update`, `/core/view`, `/core/submodel`, `/core/http`, `/core/async-data`,
    `/core/custom-element`
  - Patterns: `/patterns/project-organization`, `/patterns/informing-submodels`
  - Best practices: `/best-practices/side-effects-and-purity`
  - UI: `/ui/overview` · Tooling: `/tooling/oxlint-plugin` · Releases: `github.com/foldkit/foldkit/releases`
- **Pinned source + examples**: `~/dev/ref/github/foldkit/foldkit/main/` — read `examples/form`,
  `examples/todo`, `examples/api-cache`, `examples/query-sync`, `examples/ui-showcase`,
  `examples/checkout-machine`; packages `foldkit`, `ui`, `markdown`, `devtools`, `vite-plugin`,
  `oxlint-plugin-foldkit`.
- Pins: `foldkit`/`@foldkit/ui`/`@foldkit/devtools` 0.131, `@foldkit/markdown` 0.1.1,
  `@foldkit/vite-plugin` 0.11.

## Effect house rules
- Compose with `Effect.gen`; public/non-trivial methods use `Effect.fn("Domain.op")` (spans).
- **No raw Promises.** `@effect/platform` `FileSystem` for fs; Effect `HttpClient` for http.
  `Effect.tryPromise`/`Effect.promise` are escape hatches — use ONLY when no Effect-native path exists.
- Decode untrusted boundaries with `Schema.decodeUnknownEffect`; `…Sync` only for trusted literals.
- Branch with **`Match`** (`Match.value(x).pipe(Match.when(...), Match.orElse(...))`,
  `Match.tagsExhaustive`) — not ternaries / `if` / `switch` (keep genuinely trivial one-liners).
- Model absence with `Option`, not `| undefined`. Poll/retry with `Schedule`
  (`Effect.repeat(Schedule.spaced(...))`), not hand-rolled loops.
- Services as `Context.Service` + `Layer.effect` returning `Service.of({...})`. Config via `Config`,
  not `process.env`. Typed errors via `Schema.TaggedErrorClass`.
- Never `as any` / non-null `!` / casts to silence types. Keep HTTP handlers thin (decode → service → map).

## Foldkit house rules
- Elm architecture: **Model IS a Schema** (`ts` / `S.Struct`); `update` returns
  `[Model, Command[]]` matched with `Match.tagsExhaustive`; `view` is `Model → Document`. Both **pure**.
- **Purity**: no `fetch`/`Date.now`/DOM/`Math.random` in update or view. Side effects only via the six
  points — Commands, Mount, Flags, Subscriptions, Resources, ManagedResources.
- HTTP: foldkit `Http.layer` + `HttpClient` + `HttpClientRequest` + `decodeUnknownEffect`, provided to
  the Command (not raw `fetch`).
- Loading state: `AsyncData<A,E>` (Idle/Loading/Refreshing/Failure/Stale/Success); `settle()` on
  `Effect.result`, render with `matchData()`.
- Structure per `/patterns/project-organization` (model/message/update/view + page submodels + domain).
  Compose with Submodels (`Submodel.defineView`, `h.submodel`, `Command.mapMessages`, `Got*Message`);
  cross-cutting changes via `inform*` helpers.
- Prefer `@foldkit/ui` headless components (ARIA + keyboard) over hand-rolled controls.
- Lint with `@foldkit/oxlint-plugin` (foldkit Message/Command/Submodel/purity rules).

## The refactor backlog
Open issues track the idiomatic refactor — read them before starting a change:
- #1 no-Promise / Effect FileSystem · #2 design patterns (Repository as a service) · #3 `Match` ·
  #4 Schedule / Option / Effect.fn / Config · #5 ecosystem versions · #6 Http + AsyncData ·
  #7 Submodels + project layout + purity · #8 `@foldkit/oxlint-plugin` + `@foldkit/ui`.

Verify every change against the full gate:
`bun run typecheck && bun run check:effect && bun run lint && bun run format:check && bun run test && bun run build`.
