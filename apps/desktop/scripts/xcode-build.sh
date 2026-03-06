#!/bin/bash
# xcode-build.sh — Xcode External Build System wrapper for Tauri
# Called by Xcode's PBXLegacyTarget with ACTION passed as argument.
set -euo pipefail

# ── Extend PATH for Xcode's minimal environment ──
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"   # Homebrew (pnpm, node, bun)
export PATH="$HOME/.bun/bin:$PATH"                          # Bun
export PATH="$HOME/.cargo/bin:$PATH"                        # Cargo / rustup

# NVM（如果用了 nvm 管理 Node）
if [ -s "$HOME/.nvm/nvm.sh" ]; then
    export NVM_DIR="$HOME/.nvm"
    # shellcheck source=/dev/null
    source "$NVM_DIR/nvm.sh" --no-use
fi

# ── Verify required tools ──
for tool in node pnpm bun cargo; do
    if ! command -v "$tool" &>/dev/null; then
        echo "ERROR: '$tool' not found in PATH" >&2
        echo "PATH=$PATH" >&2
        exit 1
    fi
done

# ── Resolve project root (two levels up from apps/desktop/scripts/) ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$DESKTOP_DIR/../.." && pwd)"

# ── Redirect Cargo target to local APFS volume (avoids exFAT ._ files) ──
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-/private/tmp/routebox-target}"

# ── Clean ._ resource fork files that break Tauri/Cargo on exFAT ──
cleanup_dot_underscore() {
    find "$REPO_ROOT" \
        -path '*/node_modules' -prune -o \
        -path '*/.git' -prune -o \
        -name '._*' -print0 | xargs -0 rm -f 2>/dev/null || true
}

# ── Main ──
ACTION="${1:-build}"

echo "=== RouteBox Xcode Build ==="
echo "  ACTION:           $ACTION"
echo "  CARGO_TARGET_DIR: $CARGO_TARGET_DIR"
echo "  DESKTOP_DIR:      $DESKTOP_DIR"
echo "==="

cd "$DESKTOP_DIR"

case "$ACTION" in
    clean)
        echo "Cleaning Cargo target directory..."
        cargo clean --target-dir "$CARGO_TARGET_DIR" 2>/dev/null || true
        echo "Clean complete."
        ;;
    *)
        cleanup_dot_underscore
        echo "Building RouteBox with Tauri..."
        npx tauri build
        APP_PATH="$CARGO_TARGET_DIR/release/bundle/macos/RouteBox.app"
        if [ -d "$APP_PATH" ]; then
            echo "Build succeeded: $APP_PATH"
        else
            echo "Warning: Expected .app not found at $APP_PATH"
            echo "Checking for build output..."
            find "$CARGO_TARGET_DIR/release/bundle" -name "*.app" -maxdepth 3 2>/dev/null || true
        fi
        ;;
esac
