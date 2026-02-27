# ---- Build stage ----
FROM oven/bun:1 AS build
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

COPY src/ src/
COPY bunfig.toml ./

# ---- Runtime stage ----
FROM oven/bun:1-slim
WORKDIR /app

RUN mkdir -p /data && chown bun:bun /data

COPY --from=build /app/node_modules node_modules/
COPY --from=build /app/src src/
COPY --from=build /app/package.json ./

ENV ROUTEBOX_DB_PATH=/data/routebox.db

USER bun
EXPOSE 3001

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD bun -e "fetch('http://localhost:3001/health').then(r=>{if(!r.ok)throw 1})" || exit 1

CMD ["bun", "run", "src/index.ts"]
