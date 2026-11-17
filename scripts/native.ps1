param([ValidateSet('dev','build','test','check','fmt','core')][string]$Action='dev',[Parameter(ValueFromRemainingArguments=$true)][string[]]$NativeArgs)
$ErrorActionPreference='Stop'
$nativeCargo=Join-Path $env:USERPROFILE '.cargo/bin/cargo.exe'
if (!(Test-Path -LiteralPath $nativeCargo)) { throw 'Instale Rust MSVC com rustup antes de executar o Voxy nativo.' }
# Refresh tool paths after installation without changing global process settings.
$env:PATH=[Environment]::GetEnvironmentVariable('Path','User')+';'+$env:PATH
$nativeCmake=Join-Path $env:LOCALAPPDATA 'Microsoft/WinGet/Packages/Kitware.CMake_Microsoft.Winget.Source_8wekyb3d8bbwe/cmake-4.4.4-windows-x86_64/bin'
if (Test-Path -LiteralPath $nativeCmake) { $env:PATH=$nativeCmake+';'+$env:PATH }
$nativeRoot=Join-Path $PSScriptRoot '../native'
Push-Location $nativeRoot
try {
    switch ($Action) {
        'dev' { & $nativeCargo build --locked --workspace; if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; & (Join-Path $nativeRoot 'target/debug/voxy-desktop.exe') @NativeArgs }
        'build' { & $nativeCargo build --locked --release --workspace @NativeArgs }
        'test' { & $nativeCargo test --locked --workspace @NativeArgs }
        'check' { & $nativeCargo clippy --locked --workspace --all-targets -- -D warnings }
        'fmt' { & $nativeCargo fmt --all @NativeArgs }
        'core' { & $nativeCargo run --locked -p voxy-cli -- @NativeArgs }
    }
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally { Pop-Location }
