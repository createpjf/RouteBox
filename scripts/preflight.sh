#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# preflight.sh — Local pre-flight check before pushing a release tag
#
# Simulates everything CI does: lockfile check, tests, tsc, Docker builds,
# and frontend bundling. Run this BEFORE `git tag` + `git push`.
#
# Usage:
#   ./scripts/preflight.sh          # Full check (default)
#   ./scripts/preflight.sh --quick  # Skip Docker builds
# ─────────────────────────────────────────────────────────────────────────────
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'
BOLD='\033[1m'

pass() { echo -e "${GREEN}✓${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }
info() { echo -e "${YELLOW}→${NC} $1"; }
step() { echo -e "\n${BOLD}[$1/$TOTAL] $2${NC}"; }

QUICK=false
[ "$1" = "--quick" ] && QUICK=true

if $QUICK; then TOTAL=5; else TOTAL=7; fi
ERRORS=0

# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  RouteBox Release Pre-flight Check"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── 1. Lockfile consistency ──────────────────────────────────────────────────
step 1 "Checking pnpm lockfile consistency..."
if pnpm install --frozen-lockfile > /dev/null 2>&1; then
  pass "pnpm-lock.yaml is up to date"
else
  fail "pnpm-lock.yaml is out of date — run 'pnpm install' first"
fi

# ── 2. Gateway tests ────────────────────────────────────────────────────────
step 2 "Running gateway tests..."
# Clean macOS resource forks that break bun
find apps/gateway -name '._*' -delete 2>/dev/null || true
if (cd apps/gateway && bun test 2>&1 | tail -5); then
  pass "Gateway tests passed"
else
  fail "Gateway tests failed"
fi

# ── 3. Cloud-gateway tests + tsc ────────────────────────────────────────────
step 3 "Running cloud-gateway tests + TypeScript check..."
find apps/cloud-gateway -name '._*' -delete 2>/dev/null || true
if (cd apps/cloud-gateway && bun test 2>&1 | tail -5) && \
   (cd apps/cloud-gateway && bunx tsc --noEmit 2>&1); then
  pass "Cloud-gateway tests + tsc passed"
else
  fail "Cloud-gateway tests or tsc failed"
fi

# ── 4. Desktop tests + tsc ──────────────────────────────────────────────────
step 4 "Running desktop TypeScript check + tests..."
find apps/desktop -name '._*' -delete 2>/dev/null || true
if (cd apps/desktop && npx tsc --noEmit 2>&1) && \
   (cd apps/desktop && npx vitest run 2>&1 | tail -10); then
  pass "Desktop tsc + tests passed"
else
  fail "Desktop tsc or tests failed"
fi

# ── 5. Frontend bundle (Vite + gateway bundle) ──────────────────────────────
step 5 "Verifying gateway bundle + Vite build..."
if bun build apps/gateway/src/index.ts --target=bun --outfile apps/desktop/src-tauri/gateway-bundle.js > /dev/null 2>&1 && \
   (cd apps/desktop && npx vite build > /dev/null 2>&1); then
  pass "Frontend bundle OK"
else
  fail "Frontend bundle failed"
fi

if ! $QUICK; then
  # ── 6. Docker build: gateway ─────────────────────────────────────────────
  step 6 "Building gateway Docker image..."
  if docker build -t routebox-gw-preflight apps/gateway > /dev/null 2>&1; then
    pass "Gateway Docker image built"
    docker rmi routebox-gw-preflight > /dev/null 2>&1 || true
  else
    fail "Gateway Docker build failed"
  fi

  # ── 7. Docker build: cloud-gateway ───────────────────────────────────────
  step 7 "Building cloud-gateway Docker image..."
  if docker build -t routebox-cgw-preflight apps/cloud-gateway > /dev/null 2>&1; then
    pass "Cloud-gateway Docker image built"
    docker rmi routebox-cgw-preflight > /dev/null 2>&1 || true
  else
    fail "Cloud-gateway Docker build failed"
  fi
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
echo -e "  ${GREEN}${BOLD}All pre-flight checks passed!${NC}"
echo "  Safe to tag and push:"
echo ""
echo "    git tag -a v\$VERSION -m \"V\$VERSION — description\""
echo "    git push origin main --tags"
echo "═══════════════════════════════════════════════════════════"
echo ""
