$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'release.ps1')
$projectRoot = Split-Path -Parent $PSScriptRoot
$testRelative = '.build/release-tests-' + [Guid]::NewGuid().ToString('N')
$fixture = Resolve-OutputPath $projectRoot $testRelative
$root = Join-Path $fixture 'workspace'
[void][IO.Directory]::CreateDirectory($root)
$script:checks = 0

function Assert-True {
    param([bool]$Value, [string]$Message)
    if (-not $Value) { throw "FAILED: $Message" }
    $script:checks++
    Write-Host "PASS: $Message"
}

function Assert-Throws {
    param([scriptblock]$Action, [string]$Message)
    $caught = $false
    try { & $Action | Out-Null } catch { $caught = $true }
    Assert-True $caught $Message
}

try {
    $exe = Join-Path $fixture 'fixture.exe'
    $installer = Join-Path $fixture 'fixture-setup.exe'
    Write-Utf8File $exe 'release-one-executable'
    Write-Utf8File $installer 'release-one-installer'
    $legacy = Join-Path $root 'dist/assets'
    [void][IO.Directory]::CreateDirectory($legacy)
    Write-Utf8File (Join-Path $root 'dist/index.html') '<html></html>'
    Write-Utf8File (Join-Path $legacy 'app-icon-6P-iO98E.svg') '<svg />'
    Assert-ReplaceableDist $root
    Assert-True $true 'Recognizes the old Vite output including its hashed SVG icon'
    Remove-OutputTree $root 'dist'
    New-ReleaseCandidate $root '1.0.0' $exe $installer
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $root 'dist'))) 'Staging does not publish files early'
    Publish-ReleaseCandidate $root '1.0.0'
    $manifest = Test-ReleaseDirectory $root 'dist' '1.0.0'
    Assert-True ($manifest.files.Count -eq 4) 'ZIP, extracted app and installer have matching checksums'
    $originalHash = Get-Sha256 (Join-Path $root 'dist/release.json')

    Write-Utf8File $exe 'release-two-executable'
    New-ReleaseCandidate $root '1.0.1' $exe $installer
    Assert-True ((Get-Sha256 (Join-Path $root 'dist/release.json')) -eq $originalHash) 'Existing release survives a new build'
    $candidateExe = Join-Path $root '.build/release-stage/candidate/ChatObsidian/chat-obsidian.exe'
    Write-Utf8File $candidateExe 'tampered'
    Assert-Throws { Publish-ReleaseCandidate $root '1.0.1' } 'Corrupt extracted application cannot be published'
    Assert-True ((Get-Sha256 (Join-Path $root 'dist/release.json')) -eq $originalHash) 'Validation failure preserves previous release'

    New-ReleaseCandidate $root '1.0.1' $exe $installer
    $zipPath = Join-Path $root '.build/release-stage/candidate/ChatObsidian-windows-x64.zip'
    [IO.File]::AppendAllText($zipPath, 'tampered')
    Assert-Throws { Publish-ReleaseCandidate $root '1.0.1' } 'Corrupt archive cannot be published'

    New-ReleaseCandidate $root '1.0.1' $exe $installer
    $originalMove = ${function:Move-OutputTree}
    try {
        function Move-OutputTree {
            param([string]$Root, [string]$From, [string]$To)
            if ($From -eq '.build/release-stage/candidate') { throw 'Injected second rename failure' }
            & $originalMove $Root $From $To
        }
        Assert-Throws { Publish-ReleaseCandidate $root '1.0.1' } 'A failed replacement propagates the error'
    } finally { ${function:Move-OutputTree} = $originalMove }
    Assert-True ((Get-Sha256 (Join-Path $root 'dist/release.json')) -eq $originalHash) 'A failed replacement rolls back the previous release'

    Move-OutputTree $root 'dist' '.build/previous-release'
    Restore-InterruptedRelease $root
    Assert-True ((Get-Sha256 (Join-Path $root 'dist/release.json')) -eq $originalHash) 'Next invocation recovers an interrupted rename'
    Publish-ReleaseCandidate $root '1.0.1'
    [void](Test-ReleaseDirectory $root 'dist' '1.0.1')
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $root '.build/previous-release'))) 'Successful release removes previous version'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $root '.build/release-stage'))) 'Successful release removes packaging intermediates'

    $lock = Enter-ReleaseLock $root
    try { Assert-Throws { $second = Enter-ReleaseLock $root; $second.Dispose() } 'Concurrent publishers cannot acquire the lock' }
    finally { $lock.Dispose() }
    $lock = Enter-ReleaseLock $root
    $lock.Dispose()
    Assert-True $true 'Lock can be acquired after the owning process releases it'
    Assert-Throws { Remove-OutputTree $root '../outside' } 'Cleanup refuses paths outside workspace'
    Assert-Throws { Remove-OutputTree $root '.build/../../outside' } 'Cleanup refuses parent traversal'
    Assert-Throws { Remove-OutputTree $root 'src' } 'Cleanup refuses source directories'
    Assert-Throws { Remove-OutputTree $root '.' } 'Cleanup refuses the workspace itself'

    $outside = Join-Path $fixture 'outside'
    [void][IO.Directory]::CreateDirectory($outside)
    $sentinel = Join-Path $outside 'keep.txt'
    Write-Utf8File $sentinel 'keep'
    $junction = Resolve-OutputPath $root '.build/linked-output'
    New-Item -ItemType Junction -Path $junction -Target $outside | Out-Null
    try { Assert-Throws { Remove-OutputTree $root '.build/linked-output' } 'Cleanup refuses a junction to another directory' }
    finally { [IO.Directory]::Delete($junction) }
    Assert-True (Test-Path -LiteralPath $sentinel) 'The external sentinel survives cleanup'

    $tree = Resolve-OutputPath $root '.build/nested-link'
    [void][IO.Directory]::CreateDirectory($tree)
    $junction = Join-Path $tree 'link'
    New-Item -ItemType Junction -Path $junction -Target $outside | Out-Null
    try { Assert-Throws { Remove-OutputTree $root '.build/nested-link' } 'Cleanup refuses nested junctions before deleting anything' }
    finally { [IO.Directory]::Delete($junction) }

    foreach ($name in @('target', 'target-v0.1.1', 'target-v0.1.2', 'target-validation', 'target-important')) {
        $directory = Join-Path $root "src-tauri/$name"
        [void][IO.Directory]::CreateDirectory($directory)
        Write-Utf8File (Join-Path $directory 'output.txt') $name
    }
    Remove-LegacyBuildOutputs $root
    $remaining = @(Get-ChildItem -LiteralPath (Join-Path $root 'src-tauri'))
    Assert-True ($remaining.Count -eq 1 -and $remaining[0].Name -eq 'target-important') 'Legacy cleanup only removes explicitly recognized build directories'

    $unknown = Join-Path $root 'dist/personal-note.txt'
    Write-Utf8File $unknown 'keep'
    Assert-Throws { Assert-ReplaceableDist $root } 'Unexpected files in dist prevent replacement'
    Assert-True (Test-Path -LiteralPath $unknown) 'Unknown files remain untouched'
    Write-Host "Release checks passed: $script:checks"
} finally {
    Remove-OutputTree $projectRoot $testRelative
}
