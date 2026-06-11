# Build context is the REPO ROOT (so packages/llm-core is available).
# CI: docker build -f apps/cloud-gateway/Dockerfile .
# The monorepo layout is preserved in the image so the runtime resolves
# @routebox/llm-core via tsconfig paths (../../packages/llm-core/src).

FROM oven/bun:1-alpine

# Install curl for Docker health checks
RUN apk add --no-cache curl

# Create non-root user
RUN addgroup -g 1001 -S routebox && \
    adduser -S routebox -u 1001 -G routebox

WORKDIR /repo

# Install deps
COPY apps/cloud-gateway/package.json apps/cloud-gateway/bun.lock* apps/cloud-gateway/
RUN cd apps/cloud-gateway && bun install --frozen-lockfile --production

# Copy source + the shared workspace package (preserve relative layout)
COPY apps/cloud-gateway apps/cloud-gateway
COPY packages packages

# Fix permissions and switch to non-root user
RUN chown -R routebox:routebox /repo
USER routebox

WORKDIR /repo/apps/cloud-gateway
EXPOSE 3001

CMD ["bun", "run", "src/index.ts"]
