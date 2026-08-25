$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
corepack pnpm tauri:dev
