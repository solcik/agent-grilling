# syntax=docker/dockerfile:1
#
# grill container — a second distribution vector alongside the Nix systemd user
# daemon (see AGENTS.md). Runs `grill serve` under Node 26. The image is optional:
# the product itself stays Nix-agnostic and is primarily distributed via npm.
#
#   docker build -t grill .
#   docker run --rm -p 4100:4100 -v grill-state:/state grill

# ── deps: resolve the full toolchain with bun (has the lockfile) ──────────────
FROM oven/bun:1.3.13 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ── build: compile the CLI/server (tsc, TS7) and the Foldkit SPA (vite) ────────
FROM oven/bun:1.3.13 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

# ── runtime: Node 26 (the runtime grill ships against), no bun ────────────────
FROM node:26-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    GRILL_HOST=0.0.0.0 \
    GRILL_PORT=4100 \
    GRILL_STATE=/state
# node_modules carries the server/CLI runtime deps (effect, @effect/platform-node);
# the SPA is prebuilt into dist and needs nothing at runtime.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY bin ./bin
VOLUME ["/state"]
EXPOSE 4100
ENTRYPOINT ["node", "bin/grill"]
CMD ["serve"]
