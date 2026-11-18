# Real NSIS installer checks on a disposable install root (test build of native/installer.nsi
# with /DVOXY_TEST_INSTALL_ROOT; release builds never define it). Run after scripts/package-native.ps1.
# Covers clean install, update, reinstall, uninstall, foreign folder refusal and interrupted install.
# Accents were checked visually (the NSIS header is compressed). Does not touch the real per-user installation, user data or 1.4.1.
$ErrorActionPreference = 'Stop'
$nsis = if ($env:VOXY_MAKENSIS) { $env:VOXY_MAKENSIS } else { (Get-ChildItem (Join-Path $env:LOCALAPPDATA "electron-builder/Cache") -Recurse -Filter makensis.exe | Select-Object -First 1).FullName }
$repo = Split-Path -Parent $PSScriptRoot; $Version = (Get-Content -Raw (Join-Path $repo "package.json") | ConvertFrom-Json).version; $core,$pre = $Version.Split("-",2); $Numeric = "$core." + $(if ($pre -match "(\d+)$") { $Matches[1] } else { "0" })
$stage = (Get-ChildItem (Join-Path $repo "release/$Version/native-experimental") -Directory -Filter "staging-*" | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
$icon = Join-Path $repo 'native/crates/voxy-desktop/assets/voxy.ico'
$script = Join-Path $repo 'native/installer.nsi'
$t = "$env:TEMP\voxy-installer-test-" + [guid]::NewGuid().ToString('N')
New-Item -ItemType Directory $t | Out-Null
$root = "$t\Root"; $exe = "$t\setup-test.exe"
& $nsis /V1 /INPUTCHARSET UTF8 "/DVOXY_VERSION=$Version" "/DVOXY_NUMERIC_VERSION=$Numeric" "/DVOXY_ICON=$icon" "/DVOXY_PAYLOAD=$stage" "/DVOXY_OUTPUT=$exe" "/DVOXY_TEST_INSTALL_ROOT=$root" $script | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'compile failed' }
$results = [ordered]@{}
$realStartMenu = Test-Path "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Voxy 2.0 Beta\Voxy 2.0 Beta.lnk"
function Run([string]$file, [string[]]$arguments) { (Start-Process $file -ArgumentList $arguments -PassThru -Wait).ExitCode }
function Payload { (Get-ChildItem $root -Recurse -File -Force | Where-Object { $_.Name -notin '.voxy-native-install.ini', 'Uninstall.exe' }).Count }
$results.expectedFiles = (Get-ChildItem "$stage\portable" -Recurse -File -Force).Count
# 1. Clean install (folder does not exist)
$results.clean = Run $exe @('/S')
$results.cleanFiles = Payload
$results.marker = ((Get-Content "$root\.voxy-native-install.ini") -join ' | ')
# 2. Update over an existing installation of an older version
(Get-Content "$root\.voxy-native-install.ini") -replace 'Version=.*', 'Version=2.0.0-beta.1' | Set-Content "$root\.voxy-native-install.ini"
$results.update = Run $exe @('/S')
$results.updatedVersion = (Select-String -Path "$root\.voxy-native-install.ini" -Pattern '^Version=').Line
$results.desktopVersion = (Get-Item "$root\voxy-desktop.exe").VersionInfo.FileVersion
# 3. Reinstall same version
$results.reinstall = Run $exe @('/S')
# 4. Uninstall (wait with _?=); folder emptied
$results.uninstall = Run "$root\Uninstall.exe" @('/S', "_?=$root")
Remove-Item "$root\Uninstall.exe" -ErrorAction SilentlyContinue
$results.afterUninstallFiles = if (Test-Path $root) { (Get-ChildItem $root -Recurse -File -Force).Count } else { 0 }
# 5. Foreign folder: unrelated content, no marker -> refused and preserved
Remove-Item -Recurse -Force $root -ErrorAction SilentlyContinue
New-Item -ItemType Directory $root | Out-Null
Set-Content "$root\notas-pessoais.txt" 'dados de outra aplicacao'
$results.foreign = Run $exe @('/S')
$results.foreignPreserved = (Test-Path "$root\notas-pessoais.txt") -and ((Get-ChildItem $root -Force).Count -eq 1)
# 6. Interrupted earlier install (marker present, partial files) -> completed
Remove-Item -Recurse -Force $root
New-Item -ItemType Directory $root | Out-Null
Set-Content "$root\.voxy-native-install.ini" "[Voxy]`r`nOwner=dev.voxy.native.experimental`r`nPath=$root"
Set-Content "$root\voxy-desktop.exe" 'parcial'
$results.interrupted = Run $exe @('/S')
$results.interruptedFiles = Payload
# 7. Update while the installed copy is running (core in the tray, isolated data folder).
#    The installer stops only processes from this installation; a core from another folder survives.
$data = "$t\data"; $decoyDir = "$t\OutraPasta"; $decoyData = "$t\decoy-data"
New-Item -ItemType Directory $data, $decoyDir, $decoyData | Out-Null
Copy-Item "$root\voxy-core.exe", "$root\vcruntime140.dll" $decoyDir
$env:VOXY_NATIVE_DATA_DIR = $decoyData
$decoy = Start-Process "$decoyDir\voxy-core.exe" -ArgumentList 'serve' -PassThru -WindowStyle Hidden
$env:VOXY_NATIVE_DATA_DIR = $data
$running = Start-Process "$root\voxy-core.exe" -ArgumentList 'serve' -PassThru -WindowStyle Hidden
for ($i = 0; $i -lt 50 -and -not (Test-Path "$data\session.json"); $i++) { Start-Sleep -Milliseconds 200 }
$results.runningBeforeUpdate = -not $running.HasExited
$results.updateWhileRunning = Run $exe @('/S')
Start-Sleep -Milliseconds 500
$results.installationCoreStopped = $running.HasExited
$results.coordinatedShutdown = (Test-Path "$data\logs\core.log") -and ((Get-Content "$data\logs\core.log" -Raw) -match 'shutdown requested')
$results.otherFolderCoreUntouched = -not $decoy.HasExited
$results.filesAfterRunningUpdate = Payload
Stop-Process -Id $decoy.Id -Force -ErrorAction SilentlyContinue
Remove-Item Env:VOXY_NATIVE_DATA_DIR
$null = Run "$root\Uninstall.exe" @('/S', "_?=$root")
$results.testKeyRemoved = -not (Test-Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\VoxyNativeInstallerTest')
$results.startMenuRemoved = -not (Test-Path "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Voxy Installer Test")
$results.realStartMenuUntouched = $realStartMenu -eq (Test-Path "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Voxy 2.0 Beta\Voxy 2.0 Beta.lnk")
$results | ConvertTo-Json
Remove-Item -Recurse -Force $t
