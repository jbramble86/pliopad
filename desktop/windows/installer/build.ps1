# Builds the Windows app in Release and packages it into PlioPad-Setup-<version>.exe.
# Usage: .\build.ps1 [-OutDir <folder>]   (needs the .NET 8 SDK and Inno Setup 7)
param(
    [string]$OutDir = (Join-Path $PSScriptRoot "..\..\..\..\"),
    [string]$Dotnet = "C:\Users\jbram\family-manager-toolchain\dotnet\dotnet.exe",
    [string]$Iscc = "C:\Users\jbram\family-manager-toolchain\innosetup\ISCC.exe"
)
$ErrorActionPreference = "Stop"
$project = Join-Path $PSScriptRoot "..\Pliopad.Windows\Pliopad.Windows.csproj"
$version = ([xml](Get-Content $project)).Project.PropertyGroup.Version | Where-Object { $_ } | Select-Object -First 1
$env:DOTNET_CLI_TELEMETRY_OPTOUT = "1"; $env:DOTNET_NOLOGO = "1"

& $Dotnet build $project -c Release
if ($LASTEXITCODE -ne 0) { throw "Build failed" }

# Directory.Build.props puts build output under %LOCALAPPDATA%\PliopadBuild.
$source = Join-Path $env:LOCALAPPDATA "PliopadBuild\windows\bin\Pliopad.Windows\Release\net8.0-windows10.0.19041.0\win-x64"
if (-not (Test-Path (Join-Path $source "Pliopad.exe"))) { throw "Pliopad.exe not found in $source" }

& $Iscc "/DSourceDir=$source" "/DAppVersion=$version" "/O$((Resolve-Path $OutDir).Path)" (Join-Path $PSScriptRoot "PlioPad.iss")
if ($LASTEXITCODE -ne 0) { throw "Installer build failed" }
Write-Host "Built PlioPad-Setup-$version.exe in $((Resolve-Path $OutDir).Path)"
