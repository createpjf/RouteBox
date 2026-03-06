#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# setup-secrets.sh — Interactive guide to configure GitHub Secrets
#                    for Apple code signing and Tauri updater
#
# Prerequisites:
#   1. gh CLI authenticated (gh auth login)
#   2. Developer ID Application certificate in Keychain
#   3. Apple ID with app-specific password
#   4. Tauri signer key pair (tauri signer generate)
#
# Usage:
#   ./scripts/setup-secrets.sh
# ─────────────────────────────────────────────────────────────────────────────
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

info()  { echo -e "${GREEN}→${NC} $1"; }
warn()  { echo -e "${YELLOW}!${NC} $1"; }
ask()   { echo -e "${CYAN}?${NC} $1"; }
step()  { echo -e "\n${BOLD}── Step $1 ──${NC}"; }

REPO="createpjf/RouteBox"

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  RouteBox — GitHub Secrets Setup for Code Signing"
echo "═══════════════════════════════════════════════════════════"
echo ""

# Check gh is authenticated
if ! gh auth status > /dev/null 2>&1; then
  echo -e "${RED}✗${NC} gh CLI not authenticated. Run: gh auth login"
  exit 1
fi
info "gh CLI authenticated"

# Show current secrets
echo ""
info "Current secrets:"
EXISTING=$(gh secret list --repo "$REPO" 2>&1)
if [ -z "$EXISTING" ]; then
  warn "No secrets configured yet"
else
  echo "$EXISTING"
fi

# ── Step 1: Apple Certificate ───────────────────────────────────────────────
step "1/6: APPLE_CERTIFICATE"
echo ""
echo "  Export your Developer ID Application certificate as .p12:"
echo ""
echo "  1. Open Keychain Access"
echo "  2. Find your 'Developer ID Application' certificate"
echo "  3. Right-click → Export Items → Save as .p12"
echo "  4. Set an export password (you'll need it in Step 2)"
echo ""
ask "Path to exported .p12 file (or 'skip'):"
read -r P12_PATH

if [ "$P12_PATH" != "skip" ] && [ -f "$P12_PATH" ]; then
  base64 -i "$P12_PATH" | gh secret set APPLE_CERTIFICATE --repo "$REPO"
  info "APPLE_CERTIFICATE set!"
else
  warn "Skipped APPLE_CERTIFICATE"
fi

# ── Step 2: Certificate Password ────────────────────────────────────────────
step "2/6: APPLE_CERTIFICATE_PASSWORD"
ask "Enter the .p12 export password (or 'skip'):"
read -rs CERT_PASS
echo ""

if [ "$CERT_PASS" != "skip" ] && [ -n "$CERT_PASS" ]; then
  echo "$CERT_PASS" | gh secret set APPLE_CERTIFICATE_PASSWORD --repo "$REPO"
  info "APPLE_CERTIFICATE_PASSWORD set!"
else
  warn "Skipped APPLE_CERTIFICATE_PASSWORD"
fi

# ── Step 3: Apple ID + Team ─────────────────────────────────────────────────
step "3/6: APPLE_SIGNING_IDENTITY + APPLE_TEAM_ID"

ask "Signing identity (e.g. 'Developer ID Application: Your Name (TEAMID)'):"
read -r SIGNING_IDENTITY

if [ "$SIGNING_IDENTITY" != "skip" ] && [ -n "$SIGNING_IDENTITY" ]; then
  echo "$SIGNING_IDENTITY" | gh secret set APPLE_SIGNING_IDENTITY --repo "$REPO"
  info "APPLE_SIGNING_IDENTITY set!"
else
  warn "Skipped APPLE_SIGNING_IDENTITY"
fi

ask "Apple Team ID (10-character string, or 'skip'):"
read -r TEAM_ID

if [ "$TEAM_ID" != "skip" ] && [ -n "$TEAM_ID" ]; then
  echo "$TEAM_ID" | gh secret set APPLE_TEAM_ID --repo "$REPO"
  info "APPLE_TEAM_ID set!"
else
  warn "Skipped APPLE_TEAM_ID"
fi

# ── Step 4: Apple ID for Notarization ───────────────────────────────────────
step "4/6: APPLE_ID + APPLE_PASSWORD (for notarization)"
echo ""
echo "  APPLE_ID: Your Apple ID email address"
echo "  APPLE_PASSWORD: App-specific password from https://appleid.apple.com"
echo "    → Sign In → App-Specific Passwords → Generate"
echo ""

ask "Apple ID email (or 'skip'):"
read -r APPLE_ID_VAL

if [ "$APPLE_ID_VAL" != "skip" ] && [ -n "$APPLE_ID_VAL" ]; then
  echo "$APPLE_ID_VAL" | gh secret set APPLE_ID --repo "$REPO"
  info "APPLE_ID set!"

  ask "App-specific password:"
  read -rs APP_PASS
  echo ""
  if [ -n "$APP_PASS" ]; then
    echo "$APP_PASS" | gh secret set APPLE_PASSWORD --repo "$REPO"
    info "APPLE_PASSWORD set!"
  fi
else
  warn "Skipped Apple ID + Password"
fi

# ── Step 5: Tauri Signing Key ───────────────────────────────────────────────
step "5/6: TAURI_SIGNING_PRIVATE_KEY"
echo ""
echo "  This is the Tauri updater signing key (minisign format)."
echo "  If you don't have one, generate with: npx tauri signer generate"
echo ""
ask "Path to Tauri private key file (or 'skip'):"
read -r TAURI_KEY_PATH

if [ "$TAURI_KEY_PATH" != "skip" ] && [ -f "$TAURI_KEY_PATH" ]; then
  gh secret set TAURI_SIGNING_PRIVATE_KEY --repo "$REPO" < "$TAURI_KEY_PATH"
  info "TAURI_SIGNING_PRIVATE_KEY set!"
else
  warn "Skipped TAURI_SIGNING_PRIVATE_KEY"
fi

# ── Step 6: Tauri Key Password ──────────────────────────────────────────────
step "6/6: TAURI_SIGNING_PRIVATE_KEY_PASSWORD"
ask "Tauri signing key password (or 'skip'):"
read -rs TAURI_PASS
echo ""

if [ "$TAURI_PASS" != "skip" ] && [ -n "$TAURI_PASS" ]; then
  echo "$TAURI_PASS" | gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo "$REPO"
  info "TAURI_SIGNING_PRIVATE_KEY_PASSWORD set!"
else
  warn "Skipped TAURI_SIGNING_PRIVATE_KEY_PASSWORD"
fi

# ── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Setup Complete!"
echo "═══════════════════════════════════════════════════════════"
echo ""
info "Configured secrets:"
gh secret list --repo "$REPO"
echo ""
echo "  Next: push a v* tag to trigger Build & Release workflow"
echo ""
