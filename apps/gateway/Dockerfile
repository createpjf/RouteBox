# Build context is the REPO ROOT (so packages/llm-core is available).
# CI: docker build -f apps/gateway/Dockerfile .

# ---- Build stage: bundle the gateway into one self-contained file ----
FROM oven/bun:1 AS build
WORKDIR /repo

# Gateway sources + its workspace dependency (resolved via tsconfig paths)
COPY apps/gateway/package.json apps/gateway/tsconfig.json apps/gateway/
COPY apps/gateway/src apps/gateway/src
COPY packages/llm-core packages/llm-core

# Install deps (hono) so the bundler can resolve them, then bundle.
# `bun build` inlines hono + @routebox/llm-core (via tsconfig paths) into one file,
# so the runtime image needs no node_modules and no packages/ layout — mirrors how
# the desktop app ships its gateway bundle.
RUN cd apps/gateway && bun install
RUN cd apps/gateway && bun build src/index.ts --target=bun --outfile /app/index.js

# ---- Runtime stage ----
FROM oven/bun:1-slim
WORKDIR /app

RUN mkdir -p /data && chown bun:bun /data

COPY --from=build /app/index.js ./index.js

ENV ROUTEBOX_DB_PATH=/data/routebox.db
# Bind all interfaces inside the container so the mapped port is reachable.
# (The desktop app leaves this unset → gateway defaults to 127.0.0.1.)
ENV ROUTEBOX_HOST=0.0.0.0

USER bun
EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD bun -e "fetch('http://localhost:3001/health').then(r=>{if(!r.ok)throw 1})" || exit 1

CMD ["bun", "run", "index.js"]
