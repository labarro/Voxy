param([ValidateSet('dev','build','test','e2e','e2e-app','check','fmt','core')][string]$Action='dev',[Parameter(ValueFromRemainingArguments=$true)][string[]]$NativeArgs)
$ErrorActionPreference='Stop'
$nativeCargo=Join-Path $env:USERPROFILE '.cargo/bin/cargo.exe'
if (!(Test-Path -LiteralPath $nativeCargo)) { throw 'Instale Rust MSVC com rustup antes de executar o Voxy nativo.' }
# Refresh tool paths after installation without changing global process settings.
$env:PATH=[Environment]::GetEnvironmentVariable('Path','User')+';'+$env:PATH
$nativeCmake=Join-Path $env:LOCALAPPDATA 'Microsoft/WinGet/Packages/Kitware.CMake_Microsoft.Winget.Source_8wekyb3d8bbwe/cmake-4.4.4-windows-x86_64/bin'
if (Test-Path -LiteralPath $nativeCmake) { $env:PATH=$nativeCmake+';'+$env:PATH }
$nativeRoot=Join-Path $PSScriptRoot '../native'
function Copy-NativeWorldAssets([string]$Profile) {
    $assetSource=[IO.Path]::GetFullPath((Join-Path $nativeRoot 'world-assets'))
    $assetDestination=[IO.Path]::GetFullPath((Join-Path $nativeRoot "target/$Profile/world-assets"))
    $allowedDestination=[IO.Path]::GetFullPath((Join-Path $nativeRoot "target/$Profile"))
    if (![string]::Equals([IO.Path]::GetDirectoryName($assetDestination),$allowedDestination,[StringComparison]::OrdinalIgnoreCase)) { throw 'Destino de assets fora do build nativo.' }
    New-Item -ItemType Directory -Path $assetDestination -Force | Out-Null
    foreach($assetFile in Get-ChildItem -LiteralPath $assetSource -File) {
        if ($assetFile.Extension -notin '.json','.bin','.png','.txt') { throw "Tipo inesperado no catálogo nativo: $($assetFile.Name)" }
        Copy-Item -LiteralPath $assetFile.FullName -Destination (Join-Path $assetDestination $assetFile.Name) -Force
    }
}
Push-Location $nativeRoot
try {
    switch ($Action) {
        'dev' { & $nativeCargo build --locked --workspace; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; Copy-NativeWorldAssets 'debug'; & (Join-Path $nativeRoot 'target/debug/voxy-desktop.exe') @NativeArgs }
        'build' { & $nativeCargo build --locked --release --workspace @NativeArgs; if ($LASTEXITCODE -eq 0) { Copy-NativeWorldAssets 'release' } }
        'test' { & (Join-Path $PSScriptRoot 'native-test.ps1') @NativeArgs; exit $LASTEXITCODE }
        'e2e' { & (Join-Path $PSScriptRoot 'native-test.ps1') -OptIn @NativeArgs; exit $LASTEXITCODE }
        'e2e-app' {
            # Real multi-instance desktop E2E: native.ps1 e2e-app [voice-2|voice-3|screen-2] [release|debug] [wss://... | ws://127.0.0.1:8787]
            # Each click injects physical mouse input briefly; do not use the mouse during the run.
            $scenario = if ($NativeArgs.Count -gt 0) { $NativeArgs[0] } else { 'voice-2' }
            $buildProfile = if ($NativeArgs.Count -gt 1) { $NativeArgs[1] } else { 'release' }
            $signal = if ($NativeArgs.Count -gt 2) { $NativeArgs[2] } else { 'wss://voxy.devbarros.com' }
            if ($buildProfile -notin 'debug','release') { throw 'Perfil deve ser debug ou release' }
            $flags = if ($buildProfile -eq 'release') { @('--release') } else { @() }
            & $nativeCargo build --locked @flags -p voxy-desktop -p voxy-cli -p voxy-e2e
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
            $evidence = Join-Path $PSScriptRoot ("../evidence/native-2.0/e2e/$scenario-$buildProfile-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
            $binaries = Join-Path $nativeRoot "target/$buildProfile"
            & (Join-Path $binaries 'voxy-e2e.exe') --bin $binaries --signal $signal --scenario $scenario --evidence $evidence
            exit $LASTEXITCODE
        }
        'check' { & $nativeCargo clippy --locked --workspace --all-targets -- -D warnings }
        'fmt' { & $nativeCargo fmt --all @NativeArgs }
        'core' { & $nativeCargo run --locked -p voxy-cli -- @NativeArgs }
    }
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally { Pop-Location }
