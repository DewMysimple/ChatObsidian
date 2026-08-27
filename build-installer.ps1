[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

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
    $processes = Get-ChatObsidianProcesses
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
    $remaining = Get-ChatObsidianProcesses
    foreach ($process in $remaining) {
        Write-Host "ChatObsidian（PID $($process.Id)）仍在运行，执行强制结束。"
        try {
            Stop-Process -Id $process.Id -Force -ErrorAction Stop
        } catch {
            throw "无法结束 ChatObsidian（PID $($process.Id)）：$($_.Exception.Message)"
        }
    }

    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if ((Get-ChatObsidianProcesses).Count -eq 0) {
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

$version = Get-ProjectVersion
$releaseExe = Join-Path $PSScriptRoot 'src-tauri\target\release\chat-obsidian.exe'
$nsisDirectory = Join-Path $PSScriptRoot 'src-tauri\target\release\bundle\nsis'
$latestInstaller = Join-Path $nsisDirectory 'ChatObsidian-latest-setup.exe'

Write-Host "开始 ChatObsidian $version 发布构建。"
Invoke-CheckedCommand $pnpmCommand @('typecheck')
Invoke-CheckedCommand $pnpmCommand @('test')
Invoke-CheckedCommand $pnpmCommand @('test:e2e')
Invoke-CheckedCommand 'cargo' @('test', '--manifest-path', (Join-Path $PSScriptRoot 'src-tauri\Cargo.toml'))

Stop-ChatObsidianProcesses
$buildStartedAt = Get-Date
Invoke-CheckedCommand $pnpmCommand @('tauri:build')

if (-not (Test-Path -LiteralPath $releaseExe)) {
    throw "发布 exe 未生成：$releaseExe"
}
$exeInfo = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($releaseExe)
if ([string]$exeInfo.ProductVersion -notlike "$version*") {
    throw "发布 exe 版本不匹配：实际 $($exeInfo.ProductVersion)，预期 $version"
}

$versionedInstaller = Join-Path $nsisDirectory "ChatObsidian_${version}_x64-setup.exe"
if (-not (Test-Path -LiteralPath $versionedInstaller)) {
    throw "带版本号的 NSIS 安装包未生成：$versionedInstaller"
}
$versionedInstallerFile = Get-Item -LiteralPath $versionedInstaller
if ($versionedInstallerFile.LastWriteTime -lt $buildStartedAt.AddSeconds(-2)) {
    throw "NSIS 安装包时间早于本次构建，拒绝覆盖 latest 文件：$versionedInstaller"
}

Copy-Item -LiteralPath $versionedInstaller -Destination $latestInstaller -Force
$versionedHash = (Get-FileHash -LiteralPath $versionedInstaller -Algorithm SHA256).Hash
$latestHash = (Get-FileHash -LiteralPath $latestInstaller -Algorithm SHA256).Hash
if ($versionedHash -ne $latestHash) {
    throw '固定 NSIS 安装包与带版本号安装包哈希不一致。'
}

if (Test-ExistingChatObsidianInstallation) {
    Write-Host '检测到已有 ChatObsidian 安装，自动覆盖升级。'
    $installerProcess = Start-Process -FilePath $latestInstaller -ArgumentList @('/S') -Wait -PassThru
    if ($installerProcess.ExitCode -ne 0) {
        throw "自动升级安装版失败（退出码 $($installerProcess.ExitCode)）。"
    }
    Write-Host '已安装版本升级完成。'
} else {
    Write-Host '未检测到已有安装，跳过自动安装；固定安装包已生成。'
}

Write-Host ''
Write-Host '发布构建完成：'
Write-Host "  exe:       $releaseExe"
Write-Host "  installer: $versionedInstaller"
Write-Host "  latest:    $latestInstaller"
