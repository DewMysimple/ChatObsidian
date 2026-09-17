$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
. (Join-Path $PSScriptRoot 'scripts\release.ps1')
$buildLock = Enter-ReleaseLock $PSScriptRoot
$previousTarget = $env:CARGO_TARGET_DIR
try {
    $env:CARGO_TARGET_DIR = Resolve-OutputPath $PSScriptRoot '.build/cargo'
    & pnpm.cmd tauri dev
    if ($LASTEXITCODE -ne 0) { throw "Desktop development failed: $LASTEXITCODE" }
} finally {
    $env:CARGO_TARGET_DIR = $previousTarget
    $buildLock.Dispose()
}
