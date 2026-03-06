FROM oven/bun:1-alpine

# Install curl for Docker health checks
RUN apk add --no-cache curl

# Create non-root user
RUN addgroup -g 1001 -S routebox && \
    adduser -S routebox -u 1001 -G routebox

WORKDIR /app

# Install deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY . .

# Fix permissions and switch to non-root user
RUN chown -R routebox:routebox /app
USER routebox

EXPOSE 3001

CMD ["bun", "run", "src/index.ts"]
