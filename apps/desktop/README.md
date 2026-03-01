# RouteBox Desktop

See the [project README](../../README.md) for setup and usage.

## Dev Commands

```bash
pnpm tauri dev          # Development mode (hot reload)
pnpm tauri build        # Build .app + .dmg
pnpm build              # Build frontend only (tsc + vite)
```

## Build with Signing

```bash
TAURI_SIGNING_PRIVATE_KEY="$(cat src-tauri/routebox-signer.key)" \
TAURI_SIGNING_PRIVATE_KEY_PASSWORD="routebox" \
CARGO_TARGET_DIR=/tmp/routebox-target \
pnpm tauri build
```

## Signing Keys

- **Private key**: `src-tauri/routebox-signer.key` (gitignored)
- **Public key**: Embedded in `tauri.conf.json` → `plugins.updater.pubkey`
- **Password**: Set via `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

Regenerate: `pnpm tauri signer generate -w src-tauri/routebox-signer.key`

## CI/CD Secrets

| Secret | Description |
|--------|-------------|
| `APPLE_CERTIFICATE` | Base64 .p12 certificate |
| `APPLE_CERTIFICATE_PASSWORD` | Certificate password |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID` | Apple ID for notarization |
| `APPLE_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | Developer Team ID |
| `TAURI_SIGNING_PRIVATE_KEY` | Content of `routebox-signer.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Key password |

## Release Checklist

1. Bump version in `package.json`, `Cargo.toml`, `tauri.conf.json`
2. Build with signing (see above)
3. Create GitHub release with `.dmg`, `.app.tar.gz`, `.sig`, and `latest.json`
