# grill

`grill` is a localhost inbox for batches of agent questions. Agents post a *round*, a
human answers it from one browser panel, and the waiting agent receives JSON over the CLI.
The published package is ordinary npm software — a `node`-run CLI with no Nix,
authentication, or telemetry. (A Nix dev environment and an optional `Dockerfile` live in
the repo for development and self-hosting; neither ships in the npm tarball.)

## Use

```sh
bun install && bun run build   # from a clone
node bin/grill serve            # http://127.0.0.1:4100
```

In another terminal, post a round and block until it is answered:

```sh
node bin/grill ask --session design --question "Which API?" --option REST --option GraphQL
node bin/grill ask --round ./round.json --session design
```

Rounds use the Effect Schema contract in `src/domain/contract.ts`. A JSON round is a plain
object matching `Round`; a `.ts` round may use `export default { ... }` with the same
JSON-compatible shape. `grill ask` posts through the local HttpApi and polls for a matching
answer; on timeout it prints a `grill await <session> <roundId>` ticket to resume later.

The server defaults to `127.0.0.1:4100`, publishes `/openapi.json` (with a docs UI), and
serves the SPA at `/`. Sessions are namespaced `<project>/<task>` — the project is derived
from the git remote. Env: `GRILL_PORT`, `GRILL_HOST`, `GRILL_STATE`.

## Docker

```sh
docker build -t grill .
docker run -p 4100:4100 -v grill-state:/state grill
```

## Development

Requires [devenv](https://devenv.sh) + direnv (which provide bun, Node 26, and tsgo):

```sh
direnv allow
bun install
bun run typecheck     # tsc — TypeScript 7
bun run check:effect  # effect-tsgo — Effect-aware diagnostics
bun run lint          # oxlint (type-aware)
bun run format        # oxfmt
bun run test          # vitest + @effect/vitest
bun run build         # dist (server/CLI) + SPA
```

See [`AGENTS.md`](./AGENTS.md) for the full architecture and stack.
