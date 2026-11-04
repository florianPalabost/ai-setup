# Install this AI setup on native Windows: make sure Git for Windows and Python
# exist, then run the same install.sh as everywhere else under Git Bash. It uses
# herdr's install.ps1 to install herdr.
#
# Usage: powershell -ExecutionPolicy Bypass -File .\install.ps1 [-Update] [-DryRun]

# CmdletBinding refuses unknown arguments. Without it, --dry-run would be ignored
# and this would be a real install.
[CmdletBinding()]
param(
  [switch]$DryRun,
  [switch]$Update
)

$ErrorActionPreference = 'Stop'

$EXIT_OK = 0
$EXIT_MISSING_PREREQUISITE = 1

$WINGET_GIT = 'Git.Git'
$WINGET_PYTHON = 'Python.Python.3.13'

# Git Bash is bin/bash.exe in Git's install folder. Not plain `bash`: that can be
# WSL's launcher, and usr/bin/bash.exe doesn't set up the PATH.
function Find-GitBash {
  $roots = @()
  $git = Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($git) {
    # <root>/cmd/git.exe or <root>/mingw64/bin/git.exe
    $dir = Split-Path -Parent $git.Source
    while ($dir) {
      $roots += $dir
      $dir = Split-Path -Parent $dir
    }
  }
  foreach ($base in @($env:ProgramFiles, $env:LOCALAPPDATA)) {
    if ($base) {
      $roots += (Join-Path $base 'Git')
      $roots += (Join-Path $base 'Programs/Git')
    }
  }
  foreach ($root in $roots) {
    $bash = Join-Path $root 'bin/bash.exe'
    if (Test-Path -LiteralPath $bash -PathType Leaf) {
      return $bash
    }
  }
  return $null
}

# It has to be run to tell: Windows puts a Store stub named python3 or python on
# PATH, and it only fails.
function Test-Python {
  foreach ($name in @('python3', 'python')) {
    if (Get-Command $name -CommandType Application -ErrorAction SilentlyContinue) {
      $previous = $ErrorActionPreference
      $ErrorActionPreference = 'Continue'
      & $name -c 'import sys; sys.exit(sys.version_info[0] != 3)' 2>$null | Out-Null
      $code = $LASTEXITCODE
      $ErrorActionPreference = $previous
      if ($code -eq 0) {
        return $true
      }
    }
  }
  return $false
}

# An install adds to PATH in the registry, which this session doesn't see.
function Update-SessionPath {
  $parts = @(
    [Environment]::GetEnvironmentVariable('Path', 'Machine'),
    [Environment]::GetEnvironmentVariable('Path', 'User'),
    $env:PATH
  ) | Where-Object { $_ }
  $env:PATH = $parts -join [IO.Path]::PathSeparator
}

function Install-WithWinget($id, $what, $url) {
  if (-not (Get-Command winget -CommandType Application -ErrorAction SilentlyContinue)) {
    Write-Host "!!  $what is missing and winget isn't available: install it from $url, then re-run"
    exit $EXIT_MISSING_PREREQUISITE
  }
  Write-Host "==> Installing $what with winget"
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & winget install --id $id --exact --silent --accept-package-agreements --accept-source-agreements
  $ErrorActionPreference = $previous
  Update-SessionPath
}

$bash = Find-GitBash
if (-not $bash) {
  if ($DryRun) {
    Write-Host "    [dry-run] would install Git for Windows with winget ($WINGET_GIT)"
    Write-Host '    [dry-run] would then run install.sh --dry-run under Git Bash'
    if (-not (Test-Python)) {
      Write-Host "    [dry-run] would install Python with winget ($WINGET_PYTHON)"
    }
    exit $EXIT_OK
  }
  Install-WithWinget $WINGET_GIT 'Git for Windows' 'https://git-scm.com/download/win'
  $bash = Find-GitBash
  if (-not $bash) {
    Write-Host '!!  Git Bash still not found after installing Git for Windows: open a new terminal and re-run'
    exit $EXIT_MISSING_PREREQUISITE
  }
}

if (-not (Test-Python)) {
  if ($DryRun) {
    Write-Host "    [dry-run] would install Python with winget ($WINGET_PYTHON)"
  } else {
    Install-WithWinget $WINGET_PYTHON 'Python' 'https://www.python.org/downloads/'
    if (-not (Test-Python)) {
      Write-Host '!!  Python still not found after installing it: open a new terminal and re-run'
      exit $EXIT_MISSING_PREREQUISITE
    }
  }
}

$installArgs = @()
if ($Update) { $installArgs += '--update' }
if ($DryRun) { $installArgs += '--dry-run' }

$installSh = (Join-Path $PSScriptRoot 'install.sh').Replace('\', '/')
$ErrorActionPreference = 'Continue'
& $bash $installSh @installArgs
exit $LASTEXITCODE
