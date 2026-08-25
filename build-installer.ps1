$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
corepack pnpm typecheck
corepack pnpm test
cargo test --manifest-path "$PSScriptRoot\src-tauri\Cargo.toml"
corepack pnpm tauri:build
