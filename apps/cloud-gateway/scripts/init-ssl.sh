#!/bin/sh
# ─────────────────────────────────────────────────────────────────────────────
# init-ssl.sh — First-time SSL certificate issuance via Let's Encrypt
#
# Prerequisites:
#   1. DNS A record for api.routebox.dev → server IP
#   2. Port 80 open and reachable
#   3. docker compose running with nginx-init.conf
#
# Usage:
#   ./scripts/init-ssl.sh your@email.com [domain]
# ─────────────────────────────────────────────────────────────────────────────
set -e

EMAIL="${1:?Usage: $0 <email> [domain]}"
DOMAIN="${2:-api.routebox.dev}"

echo "═══════════════════════════════════════════════════════════"
echo "  RouteBox SSL Certificate Issuance"
echo "  Domain: ${DOMAIN}"
echo "  Email:  ${EMAIL}"
echo "═══════════════════════════════════════════════════════════"

# Step 1: Verify nginx is running with HTTP config
echo ""
echo "→ Step 1: Checking nginx is running..."
if ! docker compose ps nginx | grep -q "Up"; then
  echo "ERROR: nginx is not running. Start services first:"
  echo "  docker compose up -d"
  exit 1
fi

# Step 2: Request certificate via certbot
echo "→ Step 2: Requesting SSL certificate..."
docker compose run --rm certbot certonly \
  --webroot \
  -w /var/lib/letsencrypt \
  -d "${DOMAIN}" \
  --email "${EMAIL}" \
  --agree-tos \
  --no-eff-email \
  --force-renewal

# Step 3: Switch to SSL nginx config
echo ""
echo "→ Step 3: Switching to SSL nginx config..."
docker compose cp nginx.conf nginx:/etc/nginx/conf.d/default.conf 2>/dev/null || true

# Alternatively, just restart with the correct volume mount
echo "→ Step 4: Restarting nginx with SSL config..."

# Update nginx volume mount to use SSL config
# The docker-compose.yml already mounts ./nginx.conf, so just restart
docker compose restart nginx

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  ✅ SSL certificate issued and nginx restarted!"
echo "  Test: curl https://${DOMAIN}/health"
echo "═══════════════════════════════════════════════════════════"
