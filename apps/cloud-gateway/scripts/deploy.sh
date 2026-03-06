#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# deploy.sh — RouteBox Cloud Gateway deployment script
#
# Handles:
#   1. First-time setup (DB init, SSL cert, all services)
#   2. Updates (pull, rebuild, migrate, restart)
#
# Usage:
#   First deploy:  ./scripts/deploy.sh init
#   Update:        ./scripts/deploy.sh update
#   Status:        ./scripts/deploy.sh status
# ─────────────────────────────────────────────────────────────────────────────
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

DOMAIN="${DOMAIN:-api.routebox.dev}"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo "${GREEN}→${NC} $1"; }
warn()  { echo "${YELLOW}⚠${NC} $1"; }
error() { echo "${RED}✗${NC} $1"; exit 1; }

# ─────────────────────────────────────────────────────────────────────────────
# Pre-flight checks
# ─────────────────────────────────────────────────────────────────────────────
preflight() {
  command -v docker >/dev/null 2>&1 || error "docker not found. Install Docker first."
  command -v docker compose >/dev/null 2>&1 || error "docker compose not found."
  [ -f .env ] || error ".env file not found. Copy from .env.example and fill in values."

  # Validate required env vars
  . ./.env
  [ -n "$DB_PASSWORD" ] || error ".env: DB_PASSWORD is empty"
  [ -n "$JWT_SECRET" ] || error ".env: JWT_SECRET is empty"
  [ -n "$POLAR_ACCESS_TOKEN" ] || error ".env: POLAR_ACCESS_TOKEN is empty"
  [ -n "$POLAR_WEBHOOK_SECRET" ] || error ".env: POLAR_WEBHOOK_SECRET is empty"

  info "Pre-flight checks passed"
}

# ─────────────────────────────────────────────────────────────────────────────
# Run database migrations
# ─────────────────────────────────────────────────────────────────────────────
run_migrations() {
  info "Running database migrations..."
  for f in migrations/*.sql; do
    if [ -f "$f" ]; then
      info "  Applying $(basename "$f")..."
      docker compose exec -T postgres psql -U routebox -d routebox < "$f" 2>&1 || true
    fi
  done
  info "Migrations complete"
}

# ─────────────────────────────────────────────────────────────────────────────
# INIT — First-time deployment
# ─────────────────────────────────────────────────────────────────────────────
cmd_init() {
  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  RouteBox Cloud Gateway — First-Time Deployment"
  echo "═══════════════════════════════════════════════════════════"
  echo ""

  preflight

  # Phase 1: Start with HTTP-only nginx for certificate issuance
  info "Phase 1: Starting services with HTTP-only nginx..."

  # Temporarily use nginx-init.conf
  if [ -f nginx-init.conf ]; then
    cp nginx.conf nginx-ssl.conf.bak
    cp nginx-init.conf nginx.conf
  fi

  # Build and start
  docker compose build gateway
  docker compose up -d postgres redis
  info "Waiting for PostgreSQL to be healthy..."
  sleep 5

  # Run migrations
  run_migrations

  # Start remaining services
  docker compose up -d

  info "Waiting for services to stabilize..."
  sleep 10

  # Health check
  info "Checking gateway health..."
  if docker compose exec gateway curl -sf http://localhost:3001/health > /dev/null 2>&1; then
    info "Gateway is healthy!"
  else
    warn "Gateway health check failed — check logs: docker compose logs gateway"
  fi

  # Phase 2: SSL certificate
  echo ""
  info "Phase 2: SSL Certificate"
  echo ""
  echo "  Before issuing SSL, ensure:"
  echo "    1. DNS A record: ${DOMAIN} → $(curl -s ifconfig.me 2>/dev/null || echo '<server-ip>')"
  echo "    2. Port 80 is reachable from the internet"
  echo ""
  echo "  Then run:"
  echo "    ./scripts/init-ssl.sh your@email.com ${DOMAIN}"
  echo ""

  # Restore SSL nginx config for when SSL is ready
  if [ -f nginx-ssl.conf.bak ]; then
    mv nginx-ssl.conf.bak nginx.conf
  fi

  echo "═══════════════════════════════════════════════════════════"
  echo "  Phase 1 Complete — Services running on HTTP"
  echo ""
  echo "  Next: Set up DNS and run init-ssl.sh"
  echo "═══════════════════════════════════════════════════════════"
}

# ─────────────────────────────────────────────────────────────────────────────
# UPDATE — Rebuild and restart (zero-downtime)
# ─────────────────────────────────────────────────────────────────────────────
cmd_update() {
  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  RouteBox Cloud Gateway — Update Deployment"
  echo "═══════════════════════════════════════════════════════════"
  echo ""

  preflight

  info "Pulling latest code..."
  git pull --ff-only 2>/dev/null || warn "Not a git repo or pull failed — using local files"

  info "Building new gateway image..."
  docker compose build gateway

  info "Running migrations..."
  run_migrations

  info "Restarting gateway (rolling)..."
  docker compose up -d --no-deps gateway

  info "Waiting for health check..."
  sleep 8

  if docker compose exec gateway curl -sf http://localhost:3001/health > /dev/null 2>&1; then
    info "✅ Update complete — gateway is healthy!"
  else
    warn "Health check failed — check logs: docker compose logs gateway --tail 50"
  fi

  echo ""
}

# ─────────────────────────────────────────────────────────────────────────────
# STATUS — Show service status
# ─────────────────────────────────────────────────────────────────────────────
cmd_status() {
  echo ""
  echo "═══════════════════════════════════════════════════════════"
  echo "  RouteBox Cloud Gateway — Status"
  echo "═══════════════════════════════════════════════════════════"
  echo ""
  docker compose ps
  echo ""

  # Health check
  if docker compose exec gateway curl -sf http://localhost:3001/health 2>/dev/null; then
    echo ""
  else
    warn "Gateway health check failed"
  fi

  # Disk usage
  echo ""
  info "Volume sizes:"
  docker system df -v 2>/dev/null | grep -E "^(VOLUME|pgdata|redis|grafana|prometheus|certbot|pgbackups)" || true
  echo ""
}

# ─────────────────────────────────────────────────────────────────────────────
# LOGS — Tail service logs
# ─────────────────────────────────────────────────────────────────────────────
cmd_logs() {
  SERVICE="${1:-gateway}"
  docker compose logs -f --tail 100 "$SERVICE"
}

# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
case "${1:-help}" in
  init)   cmd_init ;;
  update) cmd_update ;;
  status) cmd_status ;;
  logs)   cmd_logs "$2" ;;
  help|*)
    echo "Usage: $0 {init|update|status|logs [service]}"
    echo ""
    echo "  init    First-time deployment (build, migrate, start)"
    echo "  update  Pull, rebuild, migrate, restart gateway"
    echo "  status  Show service status and health"
    echo "  logs    Tail logs (default: gateway)"
    ;;
esac
