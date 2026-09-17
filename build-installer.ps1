[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
. (Join-Path $PSScriptRoot 'scripts\release.ps1')

$pnpmCommandInfo = Get-Command pnpm.cmd -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $pnpmCommandInfo) {
    throw '未找到 pnpm.cmd，无法执行发布构建。'
}
$pnpmCommand = $pnpmCommandInfo.Source
$pnpmDirectory = Split-Path -Parent $pnpmCommand
# Tauri 的 beforeBuildCommand 也会继承此 PATH，避免落到旧的 Corepack pnpm。
$env:PATH = "$pnpmDirectory;$env:PATH"

function Invoke-CheckedCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [Parameter(Mandatory = $false)]
        [string[]]$ArgumentList = @()
    )

    Write-Host ("> {0} {1}" -f $FilePath, ($ArgumentList -join ' '))
    & $FilePath @ArgumentList
    if ($LASTEXITCODE -ne 0) {
        throw "命令失败（退出码 $LASTEXITCODE）：$FilePath $($ArgumentList -join ' ')"
    }
}

function Get-ProjectVersion {
    $packagePath = Join-Path $PSScriptRoot 'package.json'
    $tauriPath = Join-Path $PSScriptRoot 'src-tauri\tauri.conf.json'
    $utf8 = New-Object System.Text.UTF8Encoding($false)
    $package = [System.IO.File]::ReadAllText($packagePath, $utf8) | ConvertFrom-Json
    $tauri = [System.IO.File]::ReadAllText($tauriPath, $utf8) | ConvertFrom-Json
    $cargoMatch = Select-String -LiteralPath (Join-Path $PSScriptRoot 'src-tauri\Cargo.toml') -Pattern '^\s*version\s*=\s*"([^"]+)"' | Select-Object -First 1
    if ($null -eq $cargoMatch -or $cargoMatch.Matches.Count -eq 0) {
        throw '无法从 src-tauri/Cargo.toml 读取项目版本。'
    }

    $versions = @{
        package = [string]$package.version
        cargo = [string]$cargoMatch.Matches[0].Groups[1].Value
        tauri = [string]$tauri.version
    }
    $uniqueVersions = @($versions.Values | Select-Object -Unique)
    if ($uniqueVersions.Count -ne 1 -or [string]::IsNullOrWhiteSpace($uniqueVersions[0])) {
        throw "版本号不一致：package.json=$($versions.package)，Cargo.toml=$($versions.cargo)，tauri.conf.json=$($versions.tauri)"
    }
    return $uniqueVersions[0]
}

function Get-ChatObsidianProcesses {
    return @(Get-Process -Name 'chat-obsidian' -ErrorAction SilentlyContinue)
}

function Stop-ChatObsidianProcesses {
    $processes = @(Get-ChatObsidianProcesses)
    if ($processes.Count -eq 0) {
        Write-Host '未发现正在运行的 ChatObsidian。'
        return
    }

    foreach ($process in $processes) {
        Write-Host "正在请求关闭 ChatObsidian（PID $($process.Id)）..."
        try {
            if ($process.MainWindowHandle -ne 0) {
                [void]$process.CloseMainWindow()
            }
        } catch {
            Write-Host "无法发送正常关闭请求，将使用强制结束：$($_.Exception.Message)"
        }
    }

    Start-Sleep -Milliseconds 500
    $remaining = @(Get-ChatObsidianProcesses)
    foreach ($process in $remaining) {
        Write-Host "ChatObsidian（PID $($process.Id)）仍在运行，执行强制结束。"
        try {
            Stop-Process -Id $process.Id -Force -ErrorAction Stop
        } catch {
            throw "无法结束 ChatObsidian（PID $($process.Id)）：$($_.Exception.Message)"
        }
    }

    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if (@(Get-ChatObsidianProcesses).Count -eq 0) {
            Write-Host 'ChatObsidian 已完全退出。'
            return
        }
        Start-Sleep -Milliseconds 250
    }

    $pids = ((Get-ChatObsidianProcesses | Select-Object -ExpandProperty Id) -join ', ')
    throw "ChatObsidian 进程仍未退出（PID: $pids），已中止构建。"
}

function Test-ExistingChatObsidianInstallation {
    $uninstallRoots = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
    )

    foreach ($root in $uninstallRoots) {
        if (-not (Test-Path -LiteralPath $root)) {
            continue
        }
        foreach ($key in @(Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue)) {
            try {
                $entry = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction Stop
                if ([string]$entry.DisplayName -like 'ChatObsidian*' -or [string]$entry.DisplayName -like 'Chat Obsidian*') {
                    return $true
                }
            } catch {
                # 某些卸载项可能无法读取，继续检查其他位置。
            }
        }
    }

    $knownExecutablePaths = @(
        (Join-Path $env:LOCALAPPDATA 'ChatObsidian\chat-obsidian.exe'),
        (Join-Path $env:LOCALAPPDATA 'ChatObsidian\ChatObsidian.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\ChatObsidian\chat-obsidian.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\ChatObsidian\ChatObsidian.exe')
    )
    foreach ($path in $knownExecutablePaths) {
        if (Test-Path -LiteralPath $path) {
            return $true
        }
    }
    return $false
}

$releaseLock = Enter-ReleaseLock $PSScriptRoot
$previousTarget = $env:CARGO_TARGET_DIR
$previousNodeEnv = $env:NODE_ENV
try {
    $version = Get-ProjectVersion
    $env:CARGO_TARGET_DIR = Resolve-OutputPath $PSScriptRoot '.build/cargo'
    $env:NODE_ENV = 'production'
    $releaseExe = Join-Path $env:CARGO_TARGET_DIR 'release\chat-obsidian.exe'
    $versionedInstaller = Join-Path $env:CARGO_TARGET_DIR "release\bundle\nsis\ChatObsidian_${version}_x64-setup.exe"

    Restore-InterruptedRelease $PSScriptRoot
    Assert-ReplaceableDist $PSScriptRoot
    Write-Host "开始 ChatObsidian $version 发布构建；验证和打包期间不改动 dist。"
    Invoke-CheckedCommand 'python' @('wiki_memory/工具/memory_lint.py', 'check')
    Invoke-CheckedCommand $pnpmCommand @('test:release')
    Invoke-CheckedCommand $pnpmCommand @('typecheck')
    # Test tools need development React; production mode is set again for packaging.
    $env:NODE_ENV = 'test'
    Invoke-CheckedCommand $pnpmCommand @('test')
    $env:NODE_ENV = 'development'
    Invoke-CheckedCommand $pnpmCommand @('test:e2e')
    $env:NODE_ENV = 'production'

    # A release never reuses stale versioned Rust artifacts. Development uses the same fixed path.
    Remove-OutputTree $PSScriptRoot '.build/cargo'
    Invoke-CheckedCommand 'cargo' @('test', '--locked', '--manifest-path', (Join-Path $PSScriptRoot 'src-tauri\Cargo.toml'))
    $buildStartedAt = Get-Date
    Invoke-CheckedCommand $pnpmCommand @('tauri:build')

    $exeInfo = [Diagnostics.FileVersionInfo]::GetVersionInfo($releaseExe)
    if ([string]$exeInfo.ProductVersion -ne $version) {
        throw "发布 exe 版本不匹配：实际 $($exeInfo.ProductVersion)，预期 $version"
    }
    $installerFile = Get-Item -LiteralPath $versionedInstaller
    if ($installerFile.LastWriteTime -lt $buildStartedAt.AddSeconds(-2)) { throw 'NSIS 安装包不是本次构建产物。' }
    # This application currently embeds its frontend and has no external runtime resources.
    $tauri = Get-Content -LiteralPath 'src-tauri/tauri.conf.json' -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($field in @('resources', 'externalBin')) {
        if ($tauri.bundle.PSObject.Properties.Name -contains $field) { throw "新增 $field 后必须先扩展 ZIP 打包规则。" }
    }
    New-ReleaseCandidate $PSScriptRoot $version $releaseExe $versionedInstaller

    Write-Host '测试、构建、ZIP 解压及哈希验证通过，开始更新正式版。'
    Stop-ChatObsidianProcesses
    if (Test-ExistingChatObsidianInstallation) {
        $installer = Resolve-OutputPath $PSScriptRoot '.build/release-stage/candidate/ChatObsidian-latest-setup.exe'
        Write-Host '检测到已有安装，自动静默升级并保留应用数据。'
        $process = Start-Process -FilePath $installer -ArgumentList @('/S') -WindowStyle Hidden -Wait -PassThru
        if ($process.ExitCode -ne 0) { throw "自动升级失败（退出码 $($process.ExitCode)）；dist 保留旧版。" }
    } else {
        Write-Host '未检测到已有安装，跳过自动安装。'
    }
    Publish-ReleaseCandidate $PSScriptRoot $version

    # Keep the verified app/ZIP/installer in dist; reclaim compiler and historical output.
    Remove-OutputTree $PSScriptRoot '.build/cargo'
    Remove-LegacyBuildOutputs $PSScriptRoot
    Remove-OutputTree $PSScriptRoot 'node_modules.stale-after-relocation'
    [void](Test-ReleaseDirectory $PSScriptRoot 'dist' $version)
    Write-Host "发布完成：$PSScriptRoot\dist\ChatObsidian\chat-obsidian.exe"
    Write-Host "压缩包：$PSScriptRoot\dist\ChatObsidian-windows-x64.zip"
    Write-Host "安装包：$PSScriptRoot\dist\ChatObsidian-latest-setup.exe"
    Write-Host '仅保留最新正式产物和前端预览文件；未自动启动应用。'
} finally {
    $env:CARGO_TARGET_DIR = $previousTarget
    $env:NODE_ENV = $previousNodeEnv
    $releaseLock.Dispose()
}
