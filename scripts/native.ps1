param([ValidateSet('dev','build','test','check','fmt','core')][string]$Action='dev',[Parameter(ValueFromRemainingArguments=$true)][string[]]$NativeArgs)
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
        'test' { & $nativeCargo test --locked --workspace @NativeArgs }
        'check' { & $nativeCargo clippy --locked --workspace --all-targets -- -D warnings }
        'fmt' { & $nativeCargo fmt --all @NativeArgs }
        'core' { & $nativeCargo run --locked -p voxy-cli -- @NativeArgs }
    }
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally { Pop-Location }
