<#
.SYNOPSIS
    Downloads a static FFmpeg build into rust/.tools/ffmpeg.

.DESCRIPTION
    The workspace does not link FFmpeg, so *building* it needs nothing but rustc — there is no
    libclang, no FFmpeg development package and no pkg-config step. This script exists for the two
    things that genuinely need an executable:

      1. running the ignored render tests on a machine with no FFmpeg installed, and
      2. producing the copy a release bundles.

    For ordinary development, an FFmpeg already on PATH is enough: `img2sketch doctor` will tell
    you which copy the app would use.

    The build downloaded here is a **GPL** build, because it carries libx264 — the encoder the
    product writes with. Whether a release ships this binary, downloads it at first run, or asks
    the user for one is a distribution decision with a licence attached; see
    docs/rust-architecture.md#the-encoder-decision.

.PARAMETER Destination
    Directory to put ffmpeg.exe in. Defaults to rust/.tools/ffmpeg.

.PARAMETER Url
    The archive to fetch. Defaults to BtbN's win64 GPL build.

.EXAMPLE
    ./scripts/fetch-ffmpeg.ps1
#>
[CmdletBinding()]
param(
    [string] $Destination,
    [string] $Url = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'
)

$ErrorActionPreference = 'Stop'

# Resolved here rather than as a parameter default: `$PSScriptRoot` is not reliably bound while
# parameters are still being evaluated, and a null path fails later in a confusing place.
if (-not $Destination) {
    $Destination = Join-Path $PSScriptRoot '..\.tools\ffmpeg'
}

$destination = New-Object System.IO.DirectoryInfo ([System.IO.Path]::GetFullPath($Destination))
$target = Join-Path $destination.FullName 'ffmpeg.exe'

if (Test-Path $target) {
    Write-Host "Already present: $target"
    & $target -version | Select-Object -First 1
    exit 0
}

$scratch = Join-Path ([System.IO.Path]::GetTempPath()) ("ffmpeg-fetch-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch -Force | Out-Null

try {
    $archive = Join-Path $scratch 'ffmpeg.zip'
    Write-Host "Downloading $Url"
    Invoke-WebRequest -Uri $Url -OutFile $archive -UseBasicParsing

    Write-Host 'Unpacking...'
    Expand-Archive -Path $archive -DestinationPath (Join-Path $scratch 'unpacked') -Force

    # The archive wraps everything in a build-named directory, so the binary is found rather than
    # assumed to be at a fixed depth.
    $found = Get-ChildItem -Path (Join-Path $scratch 'unpacked') -Recurse -Filter 'ffmpeg.exe' |
        Where-Object { $_.Directory.Name -eq 'bin' } |
        Select-Object -First 1

    if (-not $found) {
        throw "The archive does not contain a bin/ffmpeg.exe: $Url"
    }

    New-Item -ItemType Directory -Path $destination.FullName -Force | Out-Null
    Copy-Item -Path $found.FullName -Destination $target -Force

    Write-Host "Installed: $target"
    & $target -version | Select-Object -First 1
    Write-Host ''
    Write-Host 'Point the engine at this copy with:'
    Write-Host "  `$env:IMG2SKETCH_FFMPEG = '$target'"
}
finally {
    Remove-Item -Path $scratch -Recurse -Force -ErrorAction SilentlyContinue
}
