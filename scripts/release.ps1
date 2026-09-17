# Shared release operations. Dot-source this file; no side effects on import.
Set-StrictMode -Version Latest
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Resolve-OutputPath {
    param([string]$Root, [string]$Relative)
    $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    $path = [IO.Path]::GetFullPath((Join-Path $rootPath $Relative))
    if (-not $path.StartsWith($rootPath + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Output path escapes workspace: $path"
    }
    $local = $path.Substring($rootPath.Length + 1).Replace('\', '/')
    if ($local -notmatch '^(dist(/.*)?|\.build/[^/]+(/.*)?|src-tauri/target(?:-v\d+\.\d+\.\d+|-validation)?|node_modules\.stale-after-relocation)$') {
        throw "Not a managed output path: $path"
    }
    # Refuse junctions/symlinks in every existing ancestor, including the root.
    $cursor = $path
    while ($cursor.Length -ge $rootPath.Length) {
        if (Test-Path -LiteralPath $cursor) {
            $entry = Get-Item -LiteralPath $cursor -Force
            if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Output path contains a reparse point: $cursor"
            }
        }
        $cursor = Split-Path -Parent $cursor
    }
    return $path
}

function Assert-PlainTree {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    $pending = New-Object 'Collections.Generic.Stack[string]'
    $pending.Push($Path)
    while ($pending.Count -gt 0) {
        $entry = Get-Item -LiteralPath $pending.Pop() -Force
        if ($entry.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Refusing to traverse a reparse point: $($entry.FullName)"
        }
        if ($entry.PSIsContainer) {
            foreach ($child in @(Get-ChildItem -LiteralPath $entry.FullName -Force)) {
                $pending.Push($child.FullName)
            }
        }
    }
}

function Remove-OutputTree {
    param([string]$Root, [string]$Relative)
    $path = Resolve-OutputPath $Root $Relative
    Assert-PlainTree $path
    if (Test-Path -LiteralPath $path) {
        Write-Host "Removing generated output: $path"
        Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop
    }
}

function Move-OutputTree {
    param([string]$Root, [string]$From, [string]$To)
    $source = Resolve-OutputPath $Root $From
    $destination = Resolve-OutputPath $Root $To
    Assert-PlainTree $source
    if (Test-Path -LiteralPath $destination) { throw "Destination already exists: $destination" }
    Move-Item -LiteralPath $source -Destination $destination -ErrorAction Stop
}

function Enter-ReleaseLock {
    param([string]$Root)
    $path = Resolve-OutputPath $Root '.build/release.lock'
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $path))
    try {
        return [IO.File]::Open($path, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    } catch {
        throw 'Another release/development script is using the build directory. Wait for it to exit.'
    }
}

function Write-Utf8File {
    param([string]$Path, [string]$Text)
    [IO.File]::WriteAllText($Path, $Text, (New-Object Text.UTF8Encoding($false)))
}

function Get-Sha256 {
    param([string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Test-ReleaseDirectory {
    param([string]$Root, [string]$Relative, [string]$ExpectedVersion)
    $directory = Resolve-OutputPath $Root $Relative
    Assert-PlainTree $directory
    $manifest = Get-Content -LiteralPath (Join-Path $directory 'release.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.schema -ne 1 -or $manifest.version -ne $ExpectedVersion) { throw 'Release manifest version mismatch.' }
    $expectedFiles = @('ChatObsidian/chat-obsidian.exe', 'ChatObsidian/README.txt', 'ChatObsidian-windows-x64.zip', 'ChatObsidian-latest-setup.exe')
    $actualFiles = @($manifest.files | ForEach-Object { $_.path })
    if (@(Compare-Object ($expectedFiles | Sort-Object) ($actualFiles | Sort-Object)).Count -ne 0) {
        throw 'Release manifest contains an unexpected file set.'
    }
    foreach ($record in $manifest.files) {
        $file = Join-Path $directory $record.path
        if ((Get-Sha256 $file) -ne $record.sha256) { throw "Release checksum mismatch: $($record.path)" }
    }
    $diskFiles = @(Get-ChildItem -LiteralPath $directory -File -Recurse -Force | ForEach-Object {
        $_.FullName.Substring($directory.Length + 1).Replace('\', '/')
    })
    if (@(Compare-Object (($expectedFiles + 'release.json') | Sort-Object) ($diskFiles | Sort-Object)).Count -ne 0) {
        throw 'Release directory contains unexpected files.'
    }
    $zip = [IO.Compression.ZipFile]::OpenRead((Join-Path $directory 'ChatObsidian-windows-x64.zip'))
    try {
        $expectedEntries = @('ChatObsidian/chat-obsidian.exe', 'ChatObsidian/README.txt')
        $entries = @($zip.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
        if (@(Compare-Object ($expectedEntries | Sort-Object) ($entries | Sort-Object)).Count -ne 0) {
            throw 'ZIP contains an unexpected file set.'
        }
        foreach ($entry in $zip.Entries) {
            $stream = $entry.Open()
            $sha = [Security.Cryptography.SHA256]::Create()
            try { $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
            finally { $sha.Dispose(); $stream.Dispose() }
            $record = $manifest.files | Where-Object { $_.path -eq $entry.FullName.Replace('\', '/') }
            if ($hash -ne $record.sha256) { throw "Extracted application differs from ZIP: $($entry.FullName)" }
        }
    } finally { $zip.Dispose() }
    return $manifest
}

function New-ReleaseCandidate {
    param([string]$Root, [string]$Version, [string]$Executable, [string]$Installer)
    Remove-OutputTree $Root '.build/release-stage'
    $stage = Resolve-OutputPath $Root '.build/release-stage'
    $payload = Join-Path $stage 'payload'
    $candidate = Join-Path $stage 'candidate'
    [void][IO.Directory]::CreateDirectory((Join-Path $payload 'ChatObsidian'))
    [void][IO.Directory]::CreateDirectory($candidate)
    Copy-Item -LiteralPath $Executable -Destination (Join-Path $payload 'ChatObsidian/chat-obsidian.exe')
    $readme = @"
ChatObsidian $Version - Windows 11 x64

Run chat-obsidian.exe. The UI and application code are included in this executable.
Requires the system Microsoft Edge WebView2 Runtime. If missing, use the companion
ChatObsidian-latest-setup.exe installer (its runtime bootstrap may need Internet).

Settings: %APPDATA%\ChatObsidian
Database and backups: %LOCALAPPDATA%\ChatObsidian
This is an unpacked application, not an isolated portable data profile.
Replacing this application folder does not delete your data or Obsidian vaults.

Use dist/ChatObsidian/chat-obsidian.exe for daily use. Development builds are in
.build and may be cleaned at any time. Do not store personal files inside dist.
"@
    Write-Utf8File (Join-Path $payload 'ChatObsidian/README.txt') $readme
    $archive = Join-Path $candidate 'ChatObsidian-windows-x64.zip'
    [IO.Compression.ZipFile]::CreateFromDirectory($payload, $archive, [IO.Compression.CompressionLevel]::Optimal, $false)
    # The published application MUST come from this ZIP, not a separate copy.
    [IO.Compression.ZipFile]::ExtractToDirectory($archive, $candidate)
    Copy-Item -LiteralPath $Installer -Destination (Join-Path $candidate 'ChatObsidian-latest-setup.exe')
    $records = @('ChatObsidian/chat-obsidian.exe', 'ChatObsidian/README.txt', 'ChatObsidian-windows-x64.zip', 'ChatObsidian-latest-setup.exe') | ForEach-Object {
        [ordered]@{ path = $_; sha256 = Get-Sha256 (Join-Path $candidate $_) }
    }
    $manifest = [ordered]@{ schema = 1; version = $Version; platform = 'windows-x64'; builtAt = [DateTime]::UtcNow.ToString('o'); files = @($records) }
    Write-Utf8File (Join-Path $candidate 'release.json') ($manifest | ConvertTo-Json -Depth 5)
    if ((Get-Sha256 $Executable) -ne (Get-Sha256 (Join-Path $candidate 'ChatObsidian/chat-obsidian.exe'))) {
        throw 'Packaged executable differs from the build output.'
    }
    if ((Get-Sha256 $Installer) -ne (Get-Sha256 (Join-Path $candidate 'ChatObsidian-latest-setup.exe'))) {
        throw 'Packaged installer differs from the build output.'
    }
    [void](Test-ReleaseDirectory $Root '.build/release-stage/candidate' $Version)
}

function Restore-InterruptedRelease {
    param([string]$Root)
    $dist = Resolve-OutputPath $Root 'dist'
    $previous = Resolve-OutputPath $Root '.build/previous-release'
    if (-not (Test-Path -LiteralPath $previous)) { return }
    if (-not (Test-Path -LiteralPath $dist)) {
        Move-OutputTree $Root '.build/previous-release' 'dist'
        Write-Host 'Restored the previous release after an interrupted publication.'
    } else {
        # A valid replacement proves the second rename finished before interruption.
        $manifest = Get-Content -LiteralPath (Join-Path $dist 'release.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        [void](Test-ReleaseDirectory $Root 'dist' $manifest.version)
        Remove-OutputTree $Root '.build/previous-release'
    }
}

function Assert-ReplaceableDist {
    param([string]$Root)
    $dist = Resolve-OutputPath $Root 'dist'
    if (-not (Test-Path -LiteralPath $dist)) { return }
    Assert-PlainTree $dist
    if (Test-Path -LiteralPath (Join-Path $dist 'release.json')) {
        $manifest = Get-Content -LiteralPath (Join-Path $dist 'release.json') -Raw -Encoding UTF8 | ConvertFrom-Json
        [void](Test-ReleaseDirectory $Root 'dist' $manifest.version)
    } else {
        # One-time migration of Vite's old output only; never silently erase unknown files.
        $files = @(Get-ChildItem -LiteralPath $dist -File -Recurse -Force)
        foreach ($file in $files) {
            $name = $file.FullName.Substring($dist.Length + 1).Replace('\', '/')
            if ($name -notmatch '^(index\.html|assets/[^/]+-[a-zA-Z0-9_-]{8}\.(js|css|svg))$') { throw "Unknown file in legacy dist: $name" }
        }
        if ($files.Count -gt 0 -and -not (Test-Path -LiteralPath (Join-Path $dist 'index.html'))) {
            throw 'Existing dist is not a recognized frontend build.'
        }
    }
}

function Publish-ReleaseCandidate {
    param([string]$Root, [string]$Version)
    Restore-InterruptedRelease $Root
    Assert-ReplaceableDist $Root
    [void](Test-ReleaseDirectory $Root '.build/release-stage/candidate' $Version)
    $dist = Resolve-OutputPath $Root 'dist'
    $hadPrevious = Test-Path -LiteralPath $dist
    if ($hadPrevious) { Move-OutputTree $Root 'dist' '.build/previous-release' }
    try {
        Move-OutputTree $Root '.build/release-stage/candidate' 'dist'
        [void](Test-ReleaseDirectory $Root 'dist' $Version)
    } catch {
        # Restore the known previous release if the second rename/verification fails.
        if (Test-Path -LiteralPath $dist) { Move-OutputTree $Root 'dist' '.build/release-stage/rejected' }
        if ($hadPrevious) { Move-OutputTree $Root '.build/previous-release' 'dist' }
        throw
    }
    Remove-OutputTree $Root '.build/previous-release'
    Remove-OutputTree $Root '.build/release-stage'
}

function Remove-LegacyBuildOutputs {
    param([string]$Root)
    $rustRoot = Join-Path $Root 'src-tauri'
    foreach ($entry in @(Get-ChildItem -LiteralPath $rustRoot -Directory -Force)) {
        if ($entry.Name -match '^target(?:-v\d+\.\d+\.\d+|-validation)?$') {
            Remove-OutputTree $Root ("src-tauri/" + $entry.Name)
        }
    }
}
